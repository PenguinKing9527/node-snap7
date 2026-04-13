import { Socket } from "node:net";
import { connect as tlsConnect, type ConnectionOptions, TLSSocket } from "node:tls";

import { Snap7ConnectionError, Snap7ProtocolError } from "../errors/index.js";
import { decodeCotpConnectionConfirm, encodeCotpConnectionRequest } from "./cotp.js";
import { decodeTpktHeader, encodeTpkt, TPKT_VERSION } from "./tpkt.js";
import type {
  SocketFactory,
  SocketLike,
  TransportConnectOptions,
  TransportRequestOptions,
  TransportState,
  TransportTlsOptions
} from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_LOCAL_TSAP = 0x0100;
const DEFAULT_REMOTE_TSAP = 0x0102;

type PendingFrame = {
  resolve: (payload: Uint8Array) => void;
  reject: (error: Error) => void;
};

const withOptionalSignal = (timeoutMs: number, signal: AbortSignal | undefined): TransportRequestOptions =>
  signal === undefined ? { timeoutMs } : { timeoutMs, signal };

const asConnectionError = (error: unknown, fallback: string): Snap7ConnectionError => {
  if (error instanceof Snap7ConnectionError) {
    return error;
  }
  if (error instanceof Error) {
    return new Snap7ConnectionError(error.message);
  }
  return new Snap7ConnectionError(fallback);
};

const asProtocolError = (error: unknown, fallback: string): Snap7ProtocolError => {
  if (error instanceof Snap7ProtocolError) {
    return error;
  }
  if (error instanceof Error) {
    return new Snap7ProtocolError(error.message);
  }
  return new Snap7ProtocolError(fallback);
};

/**
 * Async ISO-on-TCP transport (TCP + TPKT + COTP handshake).
 *
 * Responsibilities:
 * - establish TCP socket
 * - run COTP CR/CC handshake
 * - segment incoming stream into complete TPKT frames
 * - expose async request/response API with timeout and cancellation support
 */
export class AsyncIsoTransport {
  private readonly socketFactory: SocketFactory;

  private socket: SocketLike | null = null;
  private stateValue: TransportState = "idle";
  private rxBuffer = new Uint8Array(0);
  private frameQueue: Uint8Array[] = [];
  private pending: PendingFrame[] = [];
  private readonly onSocketData = (chunk: Buffer | Uint8Array): void => {
    try {
      this.onData(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    } catch (error) {
      const protocolError = asProtocolError(error, "Failed to parse incoming frame");
      this.rejectPending(protocolError);
      this.stateValue = "closed";
      this.socket?.destroy(protocolError);
    }
  };
  private readonly onSocketError = (error: Error): void => {
    this.stateValue = "closed";
    this.rejectPending(asConnectionError(error, "Socket error"));
  };
  private readonly onSocketClose = (): void => {
    if (this.stateValue !== "closed") {
      this.stateValue = "closed";
    }
    this.rejectPending(new Snap7ConnectionError("Socket closed"));
  };

  public constructor(socketFactory?: SocketFactory) {
    this.socketFactory = socketFactory ?? (() => new Socket());
  }

  /**
   * Current transport state.
   */
  public get state(): TransportState {
    return this.stateValue;
  }

  /**
   * Opens TCP socket and performs COTP connect handshake.
   */
  public async connect(options: TransportConnectOptions): Promise<void> {
    if (this.stateValue === "connected") {
      return;
    }
    if (this.stateValue === "connecting") {
      throw new Snap7ConnectionError("Transport is already connecting");
    }

    this.stateValue = "connecting";
    this.socket = this.socketFactory();
    this.socket.setNoDelay(true);
    this.attachSocketHandlers(this.socket);

    try {
      await this.awaitSocketConnect(
        this.socket,
        options.host,
        options.port,
        options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        options.signal
      );

      const cr = encodeCotpConnectionRequest(options.localTsap ?? DEFAULT_LOCAL_TSAP, options.remoteTsap ?? DEFAULT_REMOTE_TSAP);
      this.writeFrame(encodeTpkt(cr));
      const ccPayload = await this.readFrame(
        withOptionalSignal(options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, options.signal)
      );
      decodeCotpConnectionConfirm(ccPayload);

      this.stateValue = "connected";
    } catch (error) {
      this.disconnect();
      if (error instanceof Snap7ProtocolError || error instanceof Snap7ConnectionError) {
        throw error;
      }
      throw asConnectionError(error, "Failed to connect transport");
    }
  }

  /**
   * Sends payload as TPKT and waits for next full frame payload.
   */
  public async request(payload: Uint8Array, options: TransportRequestOptions = {}): Promise<Uint8Array> {
    if (this.stateValue !== "connected" || this.socket === null) {
      throw new Snap7ConnectionError("Transport is not connected");
    }

    this.writeFrame(encodeTpkt(payload));
    return this.readFrame(withOptionalSignal(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, options.signal));
  }

  /**
   * Upgrades an established TCP socket to TLS.
   *
   * This is used by S7CommPlus after InitSSL and before CreateObject.
   */
  public async activateTls(options: TransportTlsOptions): Promise<void> {
    if (this.stateValue !== "connected" || this.socket === null) {
      throw new Snap7ConnectionError("Transport is not connected");
    }
    if (!(this.socket instanceof Socket)) {
      throw new Snap7ConnectionError("TLS upgrade requires a real net.Socket transport");
    }

    const previousSocket = this.socket;
    this.detachSocketHandlers(previousSocket);

    try {
      const tlsSocket = await this.awaitTlsConnect(previousSocket, options.tlsOptions, options.timeoutMs, options.signal);
      this.socket = tlsSocket;
      this.attachSocketHandlers(tlsSocket);
    } catch (error) {
      this.socket = previousSocket;
      this.attachSocketHandlers(previousSocket);
      throw asConnectionError(error, "Failed to activate TLS");
    }
  }

  /**
   * Export TLS keying material when current socket is TLS-enabled.
   */
  public getTlsExporterSecret(label: string, length: number): Uint8Array | null {
    if (!(this.socket instanceof TLSSocket)) {
      return null;
    }
    try {
      const out = this.socket.exportKeyingMaterial(length, label, Buffer.alloc(0));
      return new Uint8Array(out);
    } catch {
      return null;
    }
  }

  /**
   * Closes socket and fails all pending requests.
   */
  public disconnect(): void {
    const existing = this.socket;
    this.socket = null;
    this.stateValue = "closed";

    if (existing !== null) {
      this.detachSocketHandlers(existing);
      existing.end();
      existing.destroy();
    }

    this.rxBuffer = new Uint8Array(0);
    this.frameQueue = [];
    this.rejectPending(new Snap7ConnectionError("Transport disconnected"));
  }

  private attachSocketHandlers(socket: SocketLike): void {
    socket.on("data", this.onSocketData);
    socket.on("error", this.onSocketError);
    socket.on("close", this.onSocketClose);
  }

  private detachSocketHandlers(socket: SocketLike): void {
    socket.off("data", this.onSocketData);
    socket.off("error", this.onSocketError);
    socket.off("close", this.onSocketClose);
  }

  private onData(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.rxBuffer.length + chunk.length);
    merged.set(this.rxBuffer, 0);
    merged.set(chunk, this.rxBuffer.length);
    this.rxBuffer = merged;

    while (this.rxBuffer.length >= 4) {
      const [version, totalLength] = decodeTpktHeader(this.rxBuffer);
      if (version !== TPKT_VERSION) {
        throw new Snap7ProtocolError(`Invalid TPKT version: ${version}`);
      }
      if (totalLength < 4) {
        throw new Snap7ProtocolError(`Invalid TPKT length: ${totalLength}`);
      }
      if (this.rxBuffer.length < totalLength) {
        break;
      }

      const payload = this.rxBuffer.slice(4, totalLength);
      this.rxBuffer = this.rxBuffer.slice(totalLength);
      this.pushFrame(payload);
    }
  }

  private pushFrame(payload: Uint8Array): void {
    const waiters = this.pending.shift();
    if (waiters !== undefined) {
      waiters.resolve(payload);
      return;
    }
    this.frameQueue.push(payload);
  }

  private readFrame(options: TransportRequestOptions): Promise<Uint8Array> {
    if (this.frameQueue.length > 0) {
      return Promise.resolve(this.frameQueue.shift()!);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const pending: PendingFrame = { resolve, reject };
      this.pending.push(pending);

      const cleanup = (): void => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        if (options.signal !== undefined) {
          options.signal.removeEventListener("abort", onAbort);
        }
      };

      const onAbort = (): void => {
        cleanup();
        this.removePending(pending);
        reject(new Snap7ConnectionError("Operation aborted"));
      };

      const timer =
        options.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              cleanup();
              this.removePending(pending);
              reject(new Snap7ConnectionError(`Operation timed out after ${options.timeoutMs}ms`));
            }, options.timeoutMs);

      if (options.signal !== undefined) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private removePending(target: PendingFrame): void {
    const idx = this.pending.indexOf(target);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
    }
  }

  private rejectPending(error: Error): void {
    const all = this.pending.splice(0, this.pending.length);
    for (const pending of all) {
      pending.reject(error);
    }
  }

  private writeFrame(frame: Uint8Array): void {
    if (this.socket === null) {
      throw new Snap7ConnectionError("Socket is not available");
    }
    this.socket.write(Buffer.from(frame));
  }

  private awaitSocketConnect(
    socket: SocketLike,
    host: string,
    port: number,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };

      const onConnect = (): void => {
        cleanup();
        resolve();
      };

      const onError = (error: Error): void => {
        cleanup();
        reject(asConnectionError(error, "Socket connection error"));
      };

      const onAbort = (): void => {
        cleanup();
        reject(new Snap7ConnectionError("Connection aborted"));
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Snap7ConnectionError(`Connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once("connect", onConnect);
      socket.once("error", onError);

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      socket.connect(port, host);
    });
  }

  private awaitTlsConnect(
    socket: Socket,
    tlsOptions: ConnectionOptions,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<TLSSocket> {
    return new Promise<TLSSocket>((resolve, reject) => {
      const tlsSocket = tlsConnect({
        ...tlsOptions,
        socket
      });

      const effectiveTimeoutMs = timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const cleanup = (): void => {
        clearTimeout(timer);
        tlsSocket.off("secureConnect", onSecureConnect);
        tlsSocket.off("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };

      const onSecureConnect = (): void => {
        cleanup();
        resolve(tlsSocket);
      };

      const onError = (error: Error): void => {
        cleanup();
        reject(asConnectionError(error, "TLS handshake error"));
      };

      const onAbort = (): void => {
        cleanup();
        tlsSocket.destroy();
        reject(new Snap7ConnectionError("TLS handshake aborted"));
      };

      const timer = setTimeout(() => {
        cleanup();
        tlsSocket.destroy();
        reject(new Snap7ConnectionError(`TLS handshake timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      tlsSocket.once("secureConnect", onSecureConnect);
      tlsSocket.once("error", onError);

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}
