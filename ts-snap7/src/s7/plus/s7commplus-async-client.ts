import { DataType, FunctionCode, LegitimationId, decodeUint32Vlq, decodeUint64Vlq, encodeUint32, encodeUint32Vlq } from "../../core/index.js";
import { Snap7ConnectionError } from "../../errors/index.js";
import { S7CommPlusConnection } from "./connection.js";
import { buildLegacyResponse, buildNewResponse } from "./legitimation.js";
import { buildReadPayload, buildWritePayload, parseReadResponse, parseWriteResponse } from "./payload.js";

export interface S7CommPlusConnectionLike {
  connected: boolean;
  sessionSetupOk: boolean;
  sessionId: number;
  protocolVersion: number;
  tlsActive?: boolean;
  omsSecret?: Uint8Array | null;
  connect(options: {
    host: string;
    port?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    useTls?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): Promise<void>;
  disconnect(): void;
  sendRequest(functionCode: number, payload?: Uint8Array): Promise<Uint8Array>;
}

/**
 * Async S7CommPlus client (no legacy fallback).
 *
 * Use unified client in later tasks for automatic fallback behavior.
 */
export class S7CommPlusAsyncClient {
  private readonly connection: S7CommPlusConnectionLike;

  public constructor(connection?: S7CommPlusConnectionLike) {
    this.connection = connection ?? new S7CommPlusConnection();
  }

  public get connected(): boolean {
    return this.connection.connected;
  }

  public get sessionSetupOk(): boolean {
    return this.connection.sessionSetupOk;
  }

  public get sessionId(): number {
    return this.connection.sessionId;
  }

  public get protocolVersion(): number {
    return this.connection.protocolVersion;
  }

  public get tlsActive(): boolean {
    return this.connection.tlsActive ?? false;
  }

  public get omsSecret(): Uint8Array | null {
    const value = this.connection.omsSecret;
    return value === undefined || value === null ? null : value.slice();
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
    await this.connection.connect(options);
  }

  public disconnect(): void {
    this.connection.disconnect();
  }

  public async dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    this.ensureConnected();
    const payload = buildReadPayload([[dbNumber, start, size]]);
    const response = await this.connection.sendRequest(FunctionCode.GET_MULTI_VARIABLES, payload);
    const results = parseReadResponse(response);
    const first = results[0];
    if (first === undefined || first === null) {
      throw new Snap7ConnectionError("S7CommPlus dbRead returned no data");
    }
    return first;
  }

  public async dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    this.ensureConnected();
    const payload = buildWritePayload([[dbNumber, start, data]]);
    const response = await this.connection.sendRequest(FunctionCode.SET_MULTI_VARIABLES, payload);
    parseWriteResponse(response);
  }

  public async dbReadMulti(items: Array<readonly [number, number, number]>): Promise<Uint8Array[]> {
    this.ensureConnected();
    const payload = buildReadPayload(items);
    const response = await this.connection.sendRequest(FunctionCode.GET_MULTI_VARIABLES, payload);
    const parsed = parseReadResponse(response);
    return parsed.map((item) => item ?? new Uint8Array(0));
  }

  /**
   * Browse PLC object tree (S7CommPlus only).
   */
  public async explore(): Promise<Uint8Array> {
    this.ensureConnected();
    return this.connection.sendRequest(FunctionCode.EXPLORE, new Uint8Array(0));
  }

  /**
   * Perform PLC password authentication (legitimation).
   *
   * Requirements:
   * - active S7CommPlus connection
   * - TLS active with available OMS exporter secret
   */
  public async authenticate(password: string, username = ""): Promise<void> {
    this.ensureConnected();
    if (!this.tlsActive || this.omsSecret === null) {
      throw new Snap7ConnectionError("Legitimation requires TLS. Connect with useTls/use_tls enabled.");
    }

    const challenge = await this.getLegitimationChallenge();
    if (username.length > 0) {
      await this.sendLegitimationNew(buildNewResponse(password, challenge, this.omsSecret, username));
      return;
    }

    try {
      await this.sendLegitimationNew(buildNewResponse(password, challenge, this.omsSecret, ""));
    } catch (newStyleError) {
      void newStyleError;
      await this.sendLegitimationLegacy(buildLegacyResponse(password, challenge));
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Snap7ConnectionError("S7CommPlus client is not connected");
    }
  }

  private async getLegitimationChallenge(): Promise<Uint8Array> {
    const payload = concat(
      encodeUint32(this.sessionId),
      encodeUint32Vlq(1),
      encodeUint32Vlq(1),
      encodeUint32Vlq(LegitimationId.SERVER_SESSION_REQUEST),
      encodeUint32(0)
    );
    const response = await this.connection.sendRequest(FunctionCode.GET_VAR_SUBSTREAMED, payload);

    let offset = 0;
    const [returnValue, consumed] = decodeUint64Vlq(response, offset);
    offset += consumed;
    if (returnValue !== 0n) {
      throw new Snap7ConnectionError(`GetVarSubStreamed for challenge failed: return_value=${returnValue.toString()}`);
    }

    if (offset + 2 > response.length) {
      throw new Snap7ConnectionError("Challenge response too short");
    }
    // flags byte is currently not used but retained for wire compatibility parsing.
    offset += 1;
    const datatype = response[offset] ?? 0;
    offset += 1;

    const [length, used] = decodeUint32Vlq(response, offset);
    offset += used;
    if (offset + length > response.length) {
      throw new Snap7ConnectionError("Challenge response length exceeds payload");
    }
    if (datatype !== Number(DataType.BLOB) && datatype !== Number(DataType.USINT)) {
      throw new Snap7ConnectionError(`Unexpected challenge datatype: 0x${datatype.toString(16).padStart(2, "0")}`);
    }
    return response.slice(offset, offset + length);
  }

  private async sendLegitimationNew(encryptedResponse: Uint8Array): Promise<void> {
    const payload = concat(
      encodeUint32(this.sessionId),
      encodeUint32Vlq(1),
      encodeUint32Vlq(LegitimationId.LEGITIMATE),
      Uint8Array.of(0x00, DataType.BLOB),
      encodeUint32Vlq(encryptedResponse.length),
      encryptedResponse,
      encodeUint32(0)
    );
    const response = await this.connection.sendRequest(FunctionCode.SET_VARIABLE, payload);
    if (response.length > 0) {
      const [returnValue] = decodeUint64Vlq(response, 0);
      if (returnValue < 0n) {
        throw new Snap7ConnectionError(`Legitimation rejected by PLC: return_value=${returnValue.toString()}`);
      }
    }
  }

  private async sendLegitimationLegacy(legacyResponse: Uint8Array): Promise<void> {
    const payload = concat(
      encodeUint32(this.sessionId),
      encodeUint32Vlq(1),
      encodeUint32Vlq(LegitimationId.SERVER_SESSION_RESPONSE),
      Uint8Array.of(0x10, DataType.USINT),
      encodeUint32Vlq(legacyResponse.length),
      legacyResponse,
      encodeUint32(0)
    );
    const response = await this.connection.sendRequest(FunctionCode.SET_VARIABLE, payload);
    if (response.length > 0) {
      const [returnValue] = decodeUint64Vlq(response, 0);
      if (returnValue < 0n) {
        throw new Snap7ConnectionError(`Legacy legitimation rejected by PLC: return_value=${returnValue.toString()}`);
      }
    }
  }
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
