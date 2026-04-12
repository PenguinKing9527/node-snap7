import { Snap7ConnectionError, Snap7ProtocolError } from "../../errors/index.js";
import { AsyncIsoTransport } from "../../transport/index.js";
import type { TransportConnectOptions, TransportRequestOptions } from "../../transport/types.js";
import { LegacyS7Protocol } from "./protocol.js";

const LOCAL_TSAP = 0x0100;

const wrapCotpDt = (pdu: Uint8Array): Uint8Array => {
  const out = new Uint8Array(3 + pdu.length);
  out[0] = 0x02; // COTP header length
  out[1] = 0xf0; // DT
  out[2] = 0x80; // EOT
  out.set(pdu, 3);
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

const withOptionalConnectFields = (
  base: Omit<TransportConnectOptions, "timeoutMs" | "signal">,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined
): TransportConnectOptions => {
  const out: TransportConnectOptions = { ...base };
  if (timeoutMs !== undefined) {
    out.timeoutMs = timeoutMs;
  }
  if (signal !== undefined) {
    out.signal = signal;
  }
  return out;
};

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

export interface LegacyTransport {
  connect(options: TransportConnectOptions): Promise<void>;
  request(payload: Uint8Array, options?: TransportRequestOptions): Promise<Uint8Array>;
  disconnect(): void;
}

/**
 * Async legacy S7 client (minimal DB read/write path).
 *
 * Current scope:
 * - connect/disconnect
 * - setup communication
 * - dbRead/dbWrite on DB area
 */
export class LegacyS7AsyncClient {
  private readonly transport: LegacyTransport;
  private readonly protocol = new LegacyS7Protocol();
  private connectedValue = false;
  private pduLength = 480;

  public constructor(transport?: LegacyTransport) {
    this.transport = transport ?? new AsyncIsoTransport();
  }

  /**
   * Whether setup communication has completed successfully.
   */
  public get connected(): boolean {
    return this.connectedValue;
  }

  /**
   * Negotiated PDU length from setup communication response.
   */
  public get negotiatedPduLength(): number {
    return this.pduLength;
  }

  /**
   * Connects via ISO transport and negotiates S7 communication.
   */
  public async connect(options: {
    address: string;
    rack?: number;
    slot?: number;
    tcpPort?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const rack = options.rack ?? 0;
    const slot = options.slot ?? 1;
    const remoteTsap = 0x0100 | (rack << 5) | slot;

    const connectOptions: TransportConnectOptions = withOptionalConnectFields(
      {
        host: options.address,
        port: options.tcpPort ?? 102,
        localTsap: LOCAL_TSAP,
        remoteTsap
      },
      options.timeoutMs,
      options.signal
    );

    try {
      await this.transport.connect(connectOptions);
      const setupRequest = this.protocol.buildSetupCommunicationRequest(1, 1, this.pduLength);
      const setupResponse = await this.exchange(setupRequest, withOptionalRequestFields(options.timeoutMs, options.signal));
      const parsed = this.protocol.parseResponse(setupResponse);
      if (parsed.parameters?.pduLength !== undefined) {
        this.pduLength = parsed.parameters.pduLength;
      }
      this.connectedValue = true;
    } catch (error) {
      this.connectedValue = false;
      this.transport.disconnect();
      if (error instanceof Snap7ConnectionError || error instanceof Snap7ProtocolError) {
        throw error;
      }
      throw new Snap7ConnectionError(error instanceof Error ? error.message : "Legacy connect failed");
    }
  }

  /**
   * Disconnects transport.
   */
  public disconnect(): Promise<void> {
    this.transport.disconnect();
    this.connectedValue = false;
    return Promise.resolve();
  }

  /**
   * Reads bytes from DB area.
   */
  public async dbRead(
    dbNumber: number,
    start: number,
    size: number,
    options: TransportRequestOptions = {}
  ): Promise<Uint8Array> {
    this.ensureConnected();

    const request = this.protocol.buildReadDbRequest(dbNumber, start, size);
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    return this.protocol.extractReadBytes(parsed);
  }

  /**
   * Writes bytes into DB area.
   */
  public async dbWrite(
    dbNumber: number,
    start: number,
    data: Uint8Array,
    options: TransportRequestOptions = {}
  ): Promise<void> {
    this.ensureConnected();

    const request = this.protocol.buildWriteDbRequest(dbNumber, start, data);
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    this.protocol.checkWriteResponse(parsed);
  }

  private ensureConnected(): void {
    if (!this.connectedValue) {
      throw new Snap7ConnectionError("Legacy S7 client is not connected");
    }
  }

  private async exchange(pdu: Uint8Array, options: TransportRequestOptions): Promise<Uint8Array> {
    const wrapped = wrapCotpDt(pdu);
    const responsePayload = await this.transport.request(wrapped, options);
    return unwrapCotpDt(responsePayload);
  }
}
