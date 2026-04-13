import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

import {
  DataType,
  ElementID,
  FunctionCode,
  ObjectId,
  READ_FUNCTION_CODES,
  decodeUint32Vlq,
  decodeUint64Vlq,
  S7COMMPLUS_LOCAL_TSAP,
  S7COMMPLUS_REMOTE_TSAP,
  decodeHeader,
  encodeHeader,
  encodeObjectQualifier,
  encodeRequestHeader,
  encodeUint32,
  encodeUint32Vlq
} from "../../core/index.js";
import { Snap7ConnectionError, Snap7ProtocolError } from "../../errors/index.js";
import { AsyncIsoTransport } from "../../transport/index.js";
import type { TransportConnectOptions, TransportRequestOptions, TransportTlsOptions } from "../../transport/types.js";
import { buildCreateSessionPayload } from "./payload.js";

export interface PlusTransport {
  connect(options: TransportConnectOptions): Promise<void>;
  request(payload: Uint8Array, options?: TransportRequestOptions): Promise<Uint8Array>;
  activateTls?(options: TransportTlsOptions): Promise<void>;
  getTlsExporterSecret?(label: string, length: number): Uint8Array | null;
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
  private tlsActiveValue = false;
  private omsSecretValue: Uint8Array | null = null;
  private serverSessionVersion: number | null = null;
  private withIntegrityId = false;
  private integrityIdRead = 0;
  private integrityIdWrite = 0;

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

  public get tlsActive(): boolean {
    return this.tlsActiveValue;
  }

  public get omsSecret(): Uint8Array | null {
    return this.omsSecretValue === null ? null : this.omsSecretValue.slice();
  }

  public async connect(options: {
    host: string;
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    useTls?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
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
      if (options.useTls === true) {
        await this.activateTls(options);
      }
      await this.createSession(options.timeoutMs, options.signal);
      this.connectedValue = true;
      if (this.protocolVersionValue === 2 && !this.tlsActiveValue) {
        throw new Snap7ConnectionError("PLC reports V2 protocol but TLS is not active. V2 requires TLS.");
      }
      this.withIntegrityId = this.protocolVersionValue >= 2;
      this.integrityIdRead = 0;
      this.integrityIdWrite = 0;

      if (this.serverSessionVersion !== null) {
        this.sessionSetupOkValue = await this.setupSession(options.timeoutMs, options.signal);
      } else {
        this.sessionSetupOkValue = false;
      }
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
    this.tlsActiveValue = false;
    this.omsSecretValue = null;
    this.serverSessionVersion = null;
    this.withIntegrityId = false;
    this.integrityIdRead = 0;
    this.integrityIdWrite = 0;
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
    let integrityPart = new Uint8Array(0);
    if (this.withIntegrityId && this.protocolVersionValue >= 2) {
      const isRead = READ_FUNCTION_CODES.has(functionCode);
      const integrity = isRead ? this.integrityIdRead : this.integrityIdWrite;
      integrityPart = new Uint8Array(encodeUint32Vlq(integrity >>> 0));
      if (isRead) {
        this.integrityIdRead = (this.integrityIdRead + 1) >>> 0;
      } else {
        this.integrityIdWrite = (this.integrityIdWrite + 1) >>> 0;
      }
    }
    const requestData = this.concat(requestHeader, integrityPart, payload);
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
    const requestHeader = encodeRequestHeader(FunctionCode.CREATE_OBJECT, this.nextSequence(), ObjectId.OBJECT_NULL_SERVER_SESSION, 0x36);
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
    if (this.sessionIdValue === 0) {
      throw new Snap7ProtocolError("CreateObject failed: PLC did not assign session ID");
    }
    this.serverSessionVersion = this.parseCreateObjectResponse(response.slice(14));
  }

  private async activateTls(options: {
    host: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): Promise<void> {
    if (this.transport.activateTls === undefined) {
      throw new Snap7ConnectionError("Transport does not support TLS activation");
    }

    const tlsOptions = this.buildTlsOptions(options);
    const activateOptions: TransportTlsOptions = { tlsOptions };
    if (options.timeoutMs !== undefined) {
      activateOptions.timeoutMs = options.timeoutMs;
    }
    if (options.signal !== undefined) {
      activateOptions.signal = options.signal;
    }
    await this.transport.activateTls(activateOptions);
    this.tlsActiveValue = true;
    this.omsSecretValue = this.transport.getTlsExporterSecret?.("EXPERIMENTAL_OMS", 32) ?? null;
  }

  private async exchangeFrame(frame: Uint8Array, options: TransportRequestOptions): Promise<Uint8Array> {
    const response = await this.transport.request(wrapCotpDt(frame), options);
    return unwrapCotpDt(response);
  }

  private async setupSession(timeoutMs?: number, signal?: AbortSignal): Promise<boolean> {
    if (this.serverSessionVersion === null) {
      return false;
    }

    const payload = this.concat(
      encodeUint32(this.sessionIdValue),
      encodeUint32Vlq(1),
      encodeUint32Vlq(1),
      encodeUint32Vlq(ObjectId.SERVER_SESSION_VERSION),
      encodeUint32Vlq(1),
      Uint8Array.of(0x00, DataType.UDINT),
      encodeUint32Vlq(this.serverSessionVersion),
      Uint8Array.of(0x00),
      encodeObjectQualifier(),
      encodeUint32(0)
    );

    try {
      const response = await this.sendRequest(FunctionCode.SET_MULTI_VARIABLES, payload, withOptionalRequestFields(timeoutMs, signal));
      if (response.length === 0) {
        return false;
      }
      const [returnValue] = decodeUint64Vlq(response, 0);
      return returnValue === 0n;
    } catch {
      return false;
    }
  }

  private parseCreateObjectResponse(payload: Uint8Array): number | null {
    let offset = 0;
    while (offset < payload.length) {
      const tag = payload[offset] ?? 0;
      if (tag === Number(ElementID.ATTRIBUTE)) {
        offset += 1;
        const [attributeId, attrUsed] = decodeUint32Vlq(payload, offset);
        offset += attrUsed;
        if (offset + 2 > payload.length) {
          return null;
        }
        offset += 1; // flags
        const datatype = payload[offset] ?? 0;
        offset += 1;

        const [value, valueUsed] = decodeUint32Vlq(payload, offset);
        offset += valueUsed;
        if (
          attributeId === Number(ObjectId.SERVER_SESSION_VERSION) &&
          (datatype === Number(DataType.UDINT) || datatype === Number(DataType.DWORD))
        ) {
          return value;
        }
        continue;
      }

      if (tag === Number(ElementID.START_OF_OBJECT)) {
        offset += 1;
        if (offset + 4 > payload.length) {
          return null;
        }
        offset += 4;
        const [, c1] = decodeUint32Vlq(payload, offset);
        offset += c1;
        const [, c2] = decodeUint32Vlq(payload, offset);
        offset += c2;
        const [, c3] = decodeUint32Vlq(payload, offset);
        offset += c3;
        continue;
      }

      if (tag === Number(ElementID.TERMINATING_OBJECT) || tag === 0x00) {
        offset += 1;
        continue;
      }

      offset += 1;
    }
    return null;
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

  private buildTlsOptions(options: {
    host: string;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): ConnectionOptions {
    const out: ConnectionOptions = {
      minVersion: "TLSv1.3",
      servername: options.host
    };

    if (options.tlsCert !== undefined && options.tlsKey !== undefined) {
      out.cert = readFileSync(options.tlsCert);
      out.key = readFileSync(options.tlsKey);
    }

    if (options.tlsCa !== undefined) {
      out.ca = readFileSync(options.tlsCa);
      out.rejectUnauthorized = true;
    } else {
      out.rejectUnauthorized = false;
    }

    return out;
  }

}
