import {
  FunctionCode,
  S7COMMPLUS_LOCAL_TSAP,
  S7COMMPLUS_REMOTE_TSAP,
  decodeHeader,
  encodeHeader,
  encodeRequestHeader
} from "../../core/index.js";
import { Snap7ConnectionError, Snap7ProtocolError } from "../../errors/index.js";
import { AsyncIsoTransport } from "../../transport/index.js";
import type { TransportConnectOptions, TransportRequestOptions } from "../../transport/types.js";
import { buildCreateSessionPayload } from "./payload.js";

export interface PlusTransport {
  connect(options: TransportConnectOptions): Promise<void>;
  request(payload: Uint8Array, options?: TransportRequestOptions): Promise<Uint8Array>;
  disconnect(): void;
}

const withOptionalRequestFields = (
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined
): TransportRequestOptions => {
  const out: TransportRequestOptions = {};
  if (timeoutMs !== undefined) {
    out.timeoutMs = timeoutMs;
  }
  if (signal !== undefined) {
    out.signal = signal;
  }
  return out;
};

const wrapCotpDt = (payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(3 + payload.length);
  out.set([0x02, 0xf0, 0x80], 0);
  out.set(payload, 3);
  return out;
};

const unwrapCotpDt = (payload: Uint8Array): Uint8Array => {
  if (payload.length < 3) {
    throw new Snap7ProtocolError("COTP DT payload too short");
  }
  const pduType = payload[1] ?? 0;
  if (pduType !== 0xf0) {
    throw new Snap7ProtocolError(`Expected COTP DT, got 0x${pduType.toString(16).padStart(2, "0")}`);
  }
  return payload.slice(3);
};

/**
 * S7CommPlus V1 connection/session manager.
 *
 * Handles:
 * - ISO transport connect
 * - InitSSL request (unencrypted handshake preamble)
 * - CreateObject session setup
 * - framed request/response exchange for data functions
 */
export class S7CommPlusConnection {
  private readonly transport: PlusTransport;
  private sequence = 0;
  private connectedValue = false;
  private sessionSetupOkValue = false;
  private sessionIdValue = 0;
  private protocolVersionValue = 1;

  public constructor(transport?: PlusTransport) {
    this.transport = transport ?? new AsyncIsoTransport();
  }

  public get connected(): boolean {
    return this.connectedValue;
  }

  public get sessionSetupOk(): boolean {
    return this.sessionSetupOkValue;
  }

  public get sessionId(): number {
    return this.sessionIdValue;
  }

  public get protocolVersion(): number {
    return this.protocolVersionValue;
  }

  public async connect(options: {
    host: string;
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const connectOptions: TransportConnectOptions = {
      host: options.host,
      port: options.port ?? 102,
      localTsap: S7COMMPLUS_LOCAL_TSAP,
      remoteTsap: S7COMMPLUS_REMOTE_TSAP
    };
    if (options.timeoutMs !== undefined) {
      connectOptions.timeoutMs = options.timeoutMs;
    }
    if (options.signal !== undefined) {
      connectOptions.signal = options.signal;
    }

    try {
      await this.transport.connect(connectOptions);
      await this.sendInitSsl(options.timeoutMs, options.signal);
      await this.createSession(options.timeoutMs, options.signal);
      this.connectedValue = true;
    } catch (error) {
      this.disconnect();
      if (error instanceof Snap7ConnectionError || error instanceof Snap7ProtocolError) {
        throw error;
      }
      throw new Snap7ConnectionError(error instanceof Error ? error.message : "S7CommPlus connect failed");
    }
  }

  public disconnect(): void {
    this.transport.disconnect();
    this.connectedValue = false;
    this.sessionSetupOkValue = false;
    this.sessionIdValue = 0;
    this.sequence = 0;
    this.protocolVersionValue = 1;
  }

  public async sendRequest(
    functionCode: number,
    payload: Uint8Array = new Uint8Array(0),
    options: TransportRequestOptions = {}
  ): Promise<Uint8Array> {
    if (!this.connectedValue) {
      throw new Snap7ConnectionError("Not connected");
    }

    const requestHeader = encodeRequestHeader(functionCode, this.nextSequence(), this.sessionIdValue, 0x36);
    const requestData = this.concat(requestHeader, payload);
    const frame = this.withTrailer(encodeHeader(this.protocolVersionValue, requestData.length), requestData, this.protocolVersionValue);
    const responseFrame = await this.exchangeFrame(frame, options);
    return this.parseResponsePayload(responseFrame);
  }

  private async sendInitSsl(timeoutMs?: number, signal?: AbortSignal): Promise<void> {
    const requestHeader = encodeRequestHeader(FunctionCode.INIT_SSL, this.nextSequence(), 0, 0x30);
    const requestData = this.concat(requestHeader, new Uint8Array([0x00, 0x00, 0x00, 0x00]));
    const frame = this.withTrailer(encodeHeader(1, requestData.length), requestData, 1);
    const responseFrame = await this.exchangeFrame(frame, withOptionalRequestFields(timeoutMs, signal));
    const [version, dataLength, consumed] = decodeHeader(responseFrame);
    if (dataLength < 14 || consumed + dataLength > responseFrame.length) {
      throw new Snap7ProtocolError("InitSSL response too short");
    }
    this.protocolVersionValue = version;
  }

  private async createSession(timeoutMs?: number, signal?: AbortSignal): Promise<void> {
    const requestHeader = encodeRequestHeader(
      FunctionCode.CREATE_OBJECT,
      this.nextSequence(),
      288, // OBJECT_NULL_SERVER_SESSION
      0x36
    );
    const requestData = this.concat(requestHeader, buildCreateSessionPayload());
    const frame = this.withTrailer(encodeHeader(1, requestData.length), requestData, 1);
    const responseFrame = await this.exchangeFrame(frame, withOptionalRequestFields(timeoutMs, signal));

    const [version, dataLength, consumed] = decodeHeader(responseFrame);
    if (dataLength < 14 || consumed + dataLength > responseFrame.length) {
      throw new Snap7ProtocolError("CreateObject response too short");
    }
    const response = responseFrame.slice(consumed, consumed + dataLength);
    const rv = new DataView(response.buffer, response.byteOffset, response.length);
    this.sessionIdValue = rv.getUint32(9, false);
    this.protocolVersionValue = version;
    this.sessionSetupOkValue = this.sessionIdValue !== 0;
    if (!this.sessionSetupOkValue) {
      throw new Snap7ProtocolError("CreateObject failed: PLC did not assign session ID");
    }
  }

  private async exchangeFrame(frame: Uint8Array, options: TransportRequestOptions): Promise<Uint8Array> {
    const response = await this.transport.request(wrapCotpDt(frame), options);
    return unwrapCotpDt(response);
  }

  private parseResponsePayload(responseFrame: Uint8Array): Uint8Array {
    const [_version, dataLength, consumed] = decodeHeader(responseFrame);
    void _version;
    if (dataLength < 14 || consumed + dataLength > responseFrame.length) {
      throw new Snap7ProtocolError("S7CommPlus response too short");
    }
    const response = responseFrame.slice(consumed, consumed + dataLength);
    return response.slice(14);
  }

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) & 0xffff;
    return this.sequence;
  }

  private withTrailer(header: Uint8Array, body: Uint8Array, version: number): Uint8Array {
    return this.concat(header, body, Uint8Array.of(0x72, version & 0xff, 0x00, 0x00));
  }

  private concat(...chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}
