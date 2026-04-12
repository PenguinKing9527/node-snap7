import { FunctionCode } from "../../core/index.js";
import { Snap7ConnectionError } from "../../errors/index.js";
import { S7CommPlusConnection } from "./connection.js";
import { buildReadPayload, buildWritePayload, parseReadResponse, parseWriteResponse } from "./payload.js";

export interface S7CommPlusConnectionLike {
  connected: boolean;
  sessionSetupOk: boolean;
  sessionId: number;
  protocolVersion: number;
  connect(options: { host: string; port?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<void>;
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

  public async connect(options: { host: string; port?: number; timeoutMs?: number; signal?: AbortSignal }): Promise<void> {
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

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Snap7ConnectionError("S7CommPlus client is not connected");
    }
  }
}
