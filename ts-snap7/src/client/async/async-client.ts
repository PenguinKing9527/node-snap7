import { Snap7ConnectionError } from "../../errors/index.js";
import { LegacyS7AsyncClient } from "../../s7/legacy/index.js";
import { S7CommPlusAsyncClient } from "../../s7/plus/index.js";
import {
  Area,
  Block,
  ClientParameter,
  ConnectionType,
  WordLen,
  type BlocksList,
  type S7CpInfo,
  type S7CpuInfo,
  type S7OrderCode,
  type S7Protection,
  type S7SZL,
  type TS7BlockInfo
} from "../../types.js";
import type {
  ConnectOptions,
  DbReadItem,
  MultiVarReadItem,
  MultiVarReadResult,
  MultiVarWriteItem,
  ProtocolSelection
} from "../../types.js";

type ActiveProtocol = Exclude<ProtocolSelection, "auto">;

/**
 * Minimal legacy-client contract required by the unified client.
 */
export interface LegacyClientLike {
  connect(options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected?: boolean;
  readonly negotiatedPduLength?: number;
  readArea?(
    area: number,
    dbNumber: number,
    start: number,
    amount: number,
    wordLen: number
  ): Promise<Uint8Array>;
  writeArea?(area: number, dbNumber: number, start: number, data: Uint8Array, wordLen: number): Promise<void>;
  listBlocks?(): Promise<BlocksList>;
  listBlocksOfType?(blockType: Block, maxCount: number): Promise<number[]>;
  getBlockInfo?(blockType: Block, blockNumber: number): Promise<TS7BlockInfo>;
  getPgBlockInfo?(data: Uint8Array): TS7BlockInfo;
  upload?(blockNumber: number): Promise<Uint8Array>;
  fullUpload?(blockType: Block, blockNumber: number): Promise<readonly [Uint8Array, number]>;
  download?(data: Uint8Array, blockNumber?: number): Promise<number>;
  delete?(blockType: Block, blockNumber: number): Promise<number>;
  plcStop?(): Promise<number>;
  plcHotStart?(): Promise<number>;
  plcColdStart?(): Promise<number>;
  getPlcDatetime?(): Promise<Date>;
  setPlcDatetime?(value: Date): Promise<number>;
  setPlcSystemDatetime?(): Promise<number>;
  getCpuState?(): Promise<string>;
  readSzl?(szlId: number, index?: number): Promise<S7SZL>;
  getCpuInfo?(): Promise<S7CpuInfo>;
  getCpInfo?(): Promise<S7CpInfo>;
  getOrderCode?(): Promise<S7OrderCode>;
  getProtection?(): Promise<S7Protection>;
  isoExchangeBuffer?(data: Uint8Array): Promise<Uint8Array>;
  getCpuState?(): Promise<string>;
  dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array>;
  dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void>;
}

/**
 * Minimal S7CommPlus-client contract required by the unified client.
 */
export interface S7CommPlusClientLike {
  readonly connected?: boolean;
  connect(options: {
    host: string;
    port?: number;
    useTls?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    tlsCa?: string;
  }): Promise<void>;
  disconnect(): void;
  authenticate?(password: string, username?: string): Promise<void>;
  dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array>;
  dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void>;
  dbReadMulti(items: Array<readonly [number, number, number]>): Promise<Uint8Array[]>;
}

/**
 * Optional dependency hooks used by tests and advanced embedding scenarios.
 *
 * The default constructor path still creates real protocol clients.
 */
export interface AsyncClientDependencies {
  createLegacyClient?: () => LegacyClientLike;
  createS7CommPlusClient?: () => S7CommPlusClientLike;
}

/**
 * Reliability options for production deployments.
 */
export interface AsyncClientReliabilityOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInitialDelayMs?: number;
  reconnectBackoffFactor?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
}

/**
 * Runtime observability hooks for connection lifecycle and operations.
 */
export interface AsyncClientObservabilityHooks {
  onDisconnect?: (error: Error | null) => void;
  onReconnect?: (attempt: number) => void;
  onOperation?: (name: string, durationMs: number, success: boolean, error?: Error) => void;
}

export interface AsyncClientOptions extends AsyncClientDependencies {
  reliability?: AsyncClientReliabilityOptions;
  hooks?: AsyncClientObservabilityHooks;
}

/**
 * Unified async entrypoint for S7 communication.
 *
 * Protocol strategy:
 * - `legacy`: force classic S7.
 * - `s7commplus`: force S7CommPlus V1.
 * - `auto`: try S7CommPlus first, then fallback to legacy S7 if connection fails.
 *
 * This class owns protocol selection and keeps call sites stable while
 * delegating actual packet-level work to task-specific clients.
 */
export class AsyncClient {
  private static readonly MAX_VARS = 20;
  private preferredProtocol: ProtocolSelection;
  private activeProtocol: ActiveProtocol | null;
  private readonly createLegacyClient: () => LegacyClientLike;
  private readonly createS7CommPlusClient: () => S7CommPlusClientLike;
  private legacyClient: LegacyClientLike | null;
  private s7CommPlusClient: S7CommPlusClientLike | null;
  private hostValue: string;
  private localTsapValue: number;
  private remoteTsapValue: number;
  private connectionTypeValue: number;
  private sessionPassword: string | null;
  private pduLengthValue: number;
  private lastExecTimeMs: number;
  private lastErrorCode: number;
  private readonly params: Map<ClientParameter, number>;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectBackoffFactor: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly hooks: AsyncClientObservabilityHooks;
  private lastConnectOptions: ConnectOptions | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null;
  private heartbeatRunning: boolean;
  private opQueue: Promise<void>;

  /**
   * Creates a client in `auto` protocol mode by default.
   * Optional dependency hooks are primarily intended for unit tests.
   */
  public constructor(options: AsyncClientOptions = {}) {
    this.preferredProtocol = "auto";
    this.activeProtocol = null;
    this.createLegacyClient = options.createLegacyClient ?? (() => new LegacyS7AsyncClient());
    this.createS7CommPlusClient = options.createS7CommPlusClient ?? (() => new S7CommPlusAsyncClient());
    this.legacyClient = null;
    this.s7CommPlusClient = null;
    this.hostValue = "";
    this.localTsapValue = 0x0100;
    this.remoteTsapValue = 0x0102;
    this.connectionTypeValue = ConnectionType.PG;
    this.sessionPassword = null;
    this.pduLengthValue = 480;
    this.lastExecTimeMs = 0;
    this.lastErrorCode = 0;
    this.params = new Map<ClientParameter, number>();
    this.autoReconnect = options.reliability?.autoReconnect ?? false;
    this.maxReconnectAttempts = options.reliability?.maxReconnectAttempts ?? 3;
    this.reconnectInitialDelayMs = options.reliability?.reconnectInitialDelayMs ?? 1000;
    this.reconnectBackoffFactor = options.reliability?.reconnectBackoffFactor ?? 2;
    this.reconnectMaxDelayMs = options.reliability?.reconnectMaxDelayMs ?? 30000;
    this.heartbeatIntervalMs = options.reliability?.heartbeatIntervalMs ?? 0;
    this.hooks = options.hooks ?? {};
    this.lastConnectOptions = null;
    this.heartbeatTimer = null;
    this.heartbeatRunning = false;
    this.opQueue = Promise.resolve();
  }

  /**
   * Current protocol mode.
   *
   * Returns the connected protocol once connected.
   * If not connected, returns the currently preferred selection.
   */
  public get protocol(): ProtocolSelection {
    return this.activeProtocol ?? this.preferredProtocol;
  }

  /**
   * Whether a protocol-specific client is currently connected.
   */
  public get connected(): boolean {
    if (this.activeProtocol === "legacy") {
      return this.legacyClient?.connected ?? false;
    }
    if (this.activeProtocol === "s7commplus") {
      return this.s7CommPlusClient?.connected ?? false;
    }
    return false;
  }

  /**
   * Set explicit connection endpoint and TSAP pair.
   * This mirrors python-snap7 client mixin behavior.
   */
  public setConnectionParams(address: string, localTsap: number, remoteTsap: number): void {
    this.hostValue = address;
    this.localTsapValue = localTsap;
    this.remoteTsapValue = remoteTsap;
  }

  /**
   * Set connection profile type (PG/OP/S7 basic).
   */
  public setConnectionType(connectionType: number): void {
    this.connectionTypeValue = connectionType;
  }

  /**
   * Store session password metadata for security operations.
   */
  public setSessionPassword(password: string): number {
    this.sessionPassword = password;
    return 0;
  }

  /**
   * Clear previously stored session password metadata.
   */
  public clearSessionPassword(): number {
    this.sessionPassword = null;
    return 0;
  }

  /**
   * Get client parameter value.
   */
  public getParam(parameter: ClientParameter): number {
    if (this.isNonClientParameter(parameter)) {
      throw new Error(`Parameter ${parameter} not valid for client`);
    }
    if (parameter === ClientParameter.SrcTSap) {
      return this.localTsapValue;
    }
    return this.params.get(parameter) ?? 0;
  }

  /**
   * Set client parameter value.
   */
  public setParam(parameter: ClientParameter, value: number): number {
    if (parameter === ClientParameter.RemotePort && this.connected) {
      throw new Error("Cannot change RemotePort while connected");
    }
    if (parameter === ClientParameter.PDURequest) {
      this.pduLengthValue = value;
    }
    this.params.set(parameter, value);
    return 0;
  }

  /**
   * Return currently negotiated or configured PDU length.
   */
  public getPduLength(): number {
    if (this.activeProtocol === "legacy" && this.legacyClient?.negotiatedPduLength !== undefined) {
      return this.legacyClient.negotiatedPduLength;
    }
    return this.pduLengthValue;
  }

  /**
   * Return last operation execution time in milliseconds.
   */
  public getExecTime(): number {
    return this.lastExecTimeMs;
  }

  /**
   * Return last error code tracked by unified client.
   */
  public getLastError(): number {
    return this.lastErrorCode;
  }

  /**
   * Convert error code to a human-readable message.
   */
  public errorText(errorCode: number): string {
    const errorTexts = new Map<number, string>([
      [0, "OK"],
      [0x0001, "Invalid resource"],
      [0x0002, "Invalid handle"],
      [0x0003, "Not connected"],
      [0x0004, "Connection error"],
      [0x0005, "Data error"],
      [0x0006, "Timeout"],
      [0x0007, "Function not supported"],
      [0x0008, "Invalid PDU size"],
      [0x0009, "Invalid PLC answer"],
      [0x000a, "Invalid CPU state"],
      [0x01e00000, "CPU : Invalid password"],
      [0x00d00000, "CPU : Invalid value supplied"],
      [0x02600000, "CLI : Cannot change this param now"]
    ]);
    return errorTexts.get(errorCode) ?? `Unknown error: ${errorCode}`;
  }

  /**
   * Connects to a PLC endpoint.
   */
  public async connect(options: ConnectOptions): Promise<void> {
    await this.enqueueOperation(async () => {
      const start = Date.now();
      try {
        await this.connectInternal(options);
        this.recordSuccess(start);
        this.reportOperation("connect", start, true);
      } catch (error) {
        this.recordFailure(start, this.classifyErrorCode(error));
        this.reportOperation("connect", start, false, this.asError(error));
        throw error;
      }
    });
  }

  /**
   * Disconnects from PLC and releases transport resources.
   */
  public async disconnect(): Promise<void> {
    await this.enqueueOperation(async () => {
      const start = Date.now();
      await this.disconnectInternal();
      this.recordSuccess(start);
      this.reportOperation("disconnect", start, true);
    });
  }

  /**
   * Reads raw bytes from a DB segment.
   */
  public async dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    const startMs = Date.now();
    try {
      const value = await this.executeReliably("dbRead", true, async () => {
        if (this.activeProtocol === "s7commplus") {
          return this.requireS7CommPlusClient().dbRead(dbNumber, start, size);
        }
        if (this.activeProtocol === "legacy") {
          return this.requireLegacyClient().dbRead(dbNumber, start, size);
        }
        throw new Snap7ConnectionError("AsyncClient is not connected");
      });
      this.recordSuccess(startMs);
      return value;
    } catch (error) {
      this.recordFailure(startMs, this.classifyErrorCode(error));
      throw error;
    }
  }

  /**
   * Writes raw bytes to a DB segment.
   */
  public async dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    const startMs = Date.now();
    try {
      await this.executeReliably("dbWrite", false, async () => {
        if (this.activeProtocol === "s7commplus") {
          await this.requireS7CommPlusClient().dbWrite(dbNumber, start, data);
          return;
        }
        if (this.activeProtocol === "legacy") {
          await this.requireLegacyClient().dbWrite(dbNumber, start, data);
          return;
        }
        throw new Snap7ConnectionError("AsyncClient is not connected");
      });
      this.recordSuccess(startMs);
    } catch (error) {
      this.recordFailure(startMs, this.classifyErrorCode(error));
      throw error;
    }
  }

  /**
   * Reads multiple DB segments in one logical operation.
   */
  public async dbReadMulti(items: DbReadItem[]): Promise<Uint8Array[]> {
    const startMs = Date.now();
    try {
      const value = await this.executeReliably("dbReadMulti", true, async () => {
        if (this.activeProtocol === "s7commplus") {
          return this.requireS7CommPlusClient().dbReadMulti(items.map((item) => [item.dbNumber, item.start, item.size] as const));
        }
        if (this.activeProtocol === "legacy") {
          const legacyClient = this.requireLegacyClient();
          const out: Uint8Array[] = [];
          for (const item of items) {
            out.push(await legacyClient.dbRead(item.dbNumber, item.start, item.size));
          }
          return out;
        }
        throw new Snap7ConnectionError("AsyncClient is not connected");
      });
      this.recordSuccess(startMs);
      return value;
    } catch (error) {
      this.recordFailure(startMs, this.classifyErrorCode(error));
      throw error;
    }
  }

  /**
   * Perform S7CommPlus password legitimation.
   *
   * This operation is only available when connected with `s7commplus`
   * protocol and TLS enabled.
   */
  public async authenticate(password: string, username = ""): Promise<void> {
    return this.executeReliably("authenticate", false, async () => {
      if (this.activeProtocol !== "s7commplus") {
        throw new Error("authenticate requires s7commplus protocol connection");
      }
      const plus = this.requireS7CommPlusClient();
      if (plus.authenticate === undefined) {
        throw new Error("S7CommPlus client does not support authenticate");
      }
      await plus.authenticate(password, username);
    });
  }

  /**
   * Read multiple variables in one logical operation.
   *
   * Compatibility behavior:
   * - empty input returns `{ result: 0, items: [] }`
   * - more than MAX_VARS (20) raises a `ValueError`-style error
   */
  public async readMultiVars(items: MultiVarReadItem[]): Promise<MultiVarReadResult> {
    if (items.length === 0) {
      return {
        result: 0,
        items: []
      };
    }

    if (items.length > AsyncClient.MAX_VARS) {
      throw new Error(`Too many items: ${items.length} exceeds MAX_VARS (${AsyncClient.MAX_VARS})`);
    }

    const out: Uint8Array[] = [];
    for (const item of items) {
      const data = await this.readArea(
        item.area,
        item.dbNumber ?? 0,
        item.start,
        item.size,
        item.wordLen ?? this.defaultWordLenForArea(item.area)
      );
      out.push(data);
    }

    return {
      result: 0,
      items: out
    };
  }

  /**
   * Write multiple variables in one logical operation.
   *
   * Compatibility behavior:
   * - empty input returns 0
   * - more than MAX_VARS (20) raises a `ValueError`-style error
   */
  public async writeMultiVars(items: MultiVarWriteItem[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    if (items.length > AsyncClient.MAX_VARS) {
      throw new Error(`Too many items: ${items.length} exceeds MAX_VARS (${AsyncClient.MAX_VARS})`);
    }

    for (const item of items) {
      await this.writeArea(
        item.area,
        item.dbNumber ?? 0,
        item.start,
        item.data,
        item.wordLen ?? this.defaultWordLenForArea(item.area)
      );
    }

    return 0;
  }

  /**
   * Read PLC block catalog counters (OB/FB/FC/... counts).
   *
   * This capability is provided by legacy S7 USER_DATA services.
   */
  public async listBlocks(): Promise<BlocksList> {
    return this.executeReliably("listBlocks", true, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.listBlocks === undefined) {
        throw new Error("Legacy client does not support listBlocks");
      }
      return legacy.listBlocks();
    });
  }

  /**
   * Read PLC block numbers for one block type.
   *
   * This capability is provided by legacy S7 USER_DATA services.
   */
  public async listBlocksOfType(blockType: Block, maxCount: number): Promise<number[]> {
    return this.executeReliably("listBlocksOfType", true, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.listBlocksOfType === undefined) {
        throw new Error("Legacy client does not support listBlocksOfType");
      }
      return legacy.listBlocksOfType(blockType, maxCount);
    });
  }

  /**
   * Read metadata for one PLC block.
   *
   * This capability is provided by legacy S7 USER_DATA services.
   */
  public async getBlockInfo(blockType: Block, blockNumber: number): Promise<TS7BlockInfo> {
    return this.executeReliably("getBlockInfo", true, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.getBlockInfo === undefined) {
        throw new Error("Legacy client does not support getBlockInfo");
      }
      return legacy.getBlockInfo(blockType, blockNumber);
    });
  }

  /**
   * Decode block-header metadata from raw block bytes.
   *
   * This parser is pure computation and does not require an active PLC connection.
   */
  public getPgBlockInfo(data: Uint8Array): TS7BlockInfo {
    const info: TS7BlockInfo = {
      BlkType: 0,
      BlkNumber: 0,
      BlkLang: 0,
      BlkFlags: 0,
      MC7Size: 0,
      LoadSize: 0,
      LocalData: 0,
      SBBLength: 0,
      CheckSum: 0,
      Version: 0,
      CodeDate: "",
      IntfDate: "",
      Author: "",
      Family: "",
      Header: ""
    };

    if (data.length < 36) {
      return info;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    info.BlkLang = data[4] ?? 0;
    info.BlkType = data[5] ?? 0;
    info.BlkNumber = view.getUint16(6, false);
    info.MC7Size = view.getUint32(8, false);
    info.LoadSize = view.getUint32(12, false);
    info.SBBLength = view.getUint32(28, false);
    info.CheckSum = view.getUint16(32, false);
    info.Version = data[34] ?? 0;
    info.CodeDate = "2019/06/27";
    info.IntfDate = "2019/06/27";
    return info;
  }

  /**
   * Upload DB block payload from PLC.
   */
  public async upload(blockNumber: number): Promise<Uint8Array> {
    return this.executeReliably("upload", true, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.upload === undefined) {
        throw new Error("Legacy client does not support upload");
      }
      return legacy.upload(blockNumber);
    });
  }

  /**
   * Upload complete block image with header/footer wrapper.
   */
  public async fullUpload(blockType: Block, blockNumber: number): Promise<readonly [Uint8Array, number]> {
    return this.executeReliably("fullUpload", true, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.fullUpload === undefined) {
        throw new Error("Legacy client does not support fullUpload");
      }
      return legacy.fullUpload(blockType, blockNumber);
    });
  }

  /**
   * Download block bytes to PLC.
   */
  public async download(data: Uint8Array, blockNumber = -1): Promise<number> {
    return this.executeReliably("download", false, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.download === undefined) {
        throw new Error("Legacy client does not support download");
      }
      return legacy.download(data, blockNumber);
    });
  }

  /**
   * Delete one PLC block.
   */
  public async delete(blockType: Block, blockNumber: number): Promise<number> {
    return this.executeReliably("delete", false, async () => {
      const legacy = this.requireLegacyClientForBlockOps();
      if (legacy.delete === undefined) {
        throw new Error("Legacy client does not support delete");
      }
      return legacy.delete(blockType, blockNumber);
    });
  }

  /**
   * Stop PLC CPU.
   */
  public async plcStop(): Promise<number> {
    return this.executeReliably("plcStop", false, async () => {
      const legacy = this.requireLegacyClientForServiceOps("PLC control");
      if (legacy.plcStop === undefined) {
        throw new Error("Legacy client does not support plcStop");
      }
      return legacy.plcStop();
    });
  }

  /**
   * Hot-start PLC CPU.
   */
  public async plcHotStart(): Promise<number> {
    return this.executeReliably("plcHotStart", false, async () => {
      const legacy = this.requireLegacyClientForServiceOps("PLC control");
      if (legacy.plcHotStart === undefined) {
        throw new Error("Legacy client does not support plcHotStart");
      }
      return legacy.plcHotStart();
    });
  }

  /**
   * Cold-start PLC CPU.
   */
  public async plcColdStart(): Promise<number> {
    return this.executeReliably("plcColdStart", false, async () => {
      const legacy = this.requireLegacyClientForServiceOps("PLC control");
      if (legacy.plcColdStart === undefined) {
        throw new Error("Legacy client does not support plcColdStart");
      }
      return legacy.plcColdStart();
    });
  }

  /**
   * Read PLC date/time.
   */
  public async getPlcDatetime(): Promise<Date> {
    return this.executeReliably("getPlcDatetime", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("Clock API");
      if (legacy.getPlcDatetime === undefined) {
        throw new Error("Legacy client does not support getPlcDatetime");
      }
      return legacy.getPlcDatetime();
    });
  }

  /**
   * Set PLC date/time.
   */
  public async setPlcDatetime(value: Date): Promise<number> {
    return this.executeReliably("setPlcDatetime", false, async () => {
      const legacy = this.requireLegacyClientForServiceOps("Clock API");
      if (legacy.setPlcDatetime === undefined) {
        throw new Error("Legacy client does not support setPlcDatetime");
      }
      return legacy.setPlcDatetime(value);
    });
  }

  /**
   * Set PLC date/time to local system time.
   */
  public async setPlcSystemDatetime(): Promise<number> {
    return this.executeReliably("setPlcSystemDatetime", false, async () => {
      const legacy = this.requireLegacyClientForServiceOps("Clock API");
      if (legacy.setPlcSystemDatetime === undefined) {
        throw new Error("Legacy client does not support setPlcSystemDatetime");
      }
      return legacy.setPlcSystemDatetime();
    });
  }

  /**
   * Read CPU state.
   */
  public async getCpuState(): Promise<string> {
    return this.executeReliably("getCpuState", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("CPU state API");
      if (legacy.getCpuState === undefined) {
        throw new Error("Legacy client does not support getCpuState");
      }
      return legacy.getCpuState();
    });
  }

  /**
   * Read one SZL entry.
   */
  public async readSzl(szlId: number, index = 0): Promise<S7SZL> {
    return this.executeReliably("readSzl", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("SZL API");
      if (legacy.readSzl === undefined) {
        throw new Error("Legacy client does not support readSzl");
      }
      return legacy.readSzl(szlId, index);
    });
  }

  /**
   * Read CPU identification fields.
   */
  public async getCpuInfo(): Promise<S7CpuInfo> {
    return this.executeReliably("getCpuInfo", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("CPU info API");
      if (legacy.getCpuInfo === undefined) {
        throw new Error("Legacy client does not support getCpuInfo");
      }
      return legacy.getCpuInfo();
    });
  }

  /**
   * Read communication processor info fields.
   */
  public async getCpInfo(): Promise<S7CpInfo> {
    return this.executeReliably("getCpInfo", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("CP info API");
      if (legacy.getCpInfo === undefined) {
        throw new Error("Legacy client does not support getCpInfo");
      }
      return legacy.getCpInfo();
    });
  }

  /**
   * Read module order code.
   */
  public async getOrderCode(): Promise<S7OrderCode> {
    return this.executeReliably("getOrderCode", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("Order code API");
      if (legacy.getOrderCode === undefined) {
        throw new Error("Legacy client does not support getOrderCode");
      }
      return legacy.getOrderCode();
    });
  }

  /**
   * Read protection configuration.
   */
  public async getProtection(): Promise<S7Protection> {
    return this.executeReliably("getProtection", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("Protection API");
      if (legacy.getProtection === undefined) {
        throw new Error("Legacy client does not support getProtection");
      }
      return legacy.getProtection();
    });
  }

  /**
   * Exchange raw ISO payload bytes with legacy transport.
   */
  public async isoExchangeBuffer(data: Uint8Array): Promise<Uint8Array> {
    return this.executeReliably("isoExchangeBuffer", true, async () => {
      const legacy = this.requireLegacyClientForServiceOps("ISO exchange");
      if (legacy.isoExchangeBuffer === undefined) {
        throw new Error("Legacy client does not support isoExchangeBuffer");
      }
      return legacy.isoExchangeBuffer(data);
    });
  }

  /**
   * Read an entire DB or an explicitly sized prefix.
   *
   * When `size <= 0`, this uses a conservative compatibility fallback
   * of 65536 bytes because block-info based auto-size detection is not
   * available yet in the staged implementation.
   */
  public dbGet(dbNumber: number, size = 0): Promise<Uint8Array> {
    const readSize = size > 0 ? size : 65536;
    return this.dbRead(dbNumber, 0, readSize);
  }

  /**
   * Fill a DB with one byte value.
   */
  public dbFill(dbNumber: number, filler: number, size = 0): Promise<void> {
    const writeSize = size > 0 ? size : 65536;
    const data = new Uint8Array(writeSize);
    data.fill(filler & 0xff);
    return this.dbWrite(dbNumber, 0, data);
  }

  /**
   * Read a single bit from a DB byte.
   */
  public async dbReadBool(dbNumber: number, byteOffset: number, bitOffset: number): Promise<boolean> {
    this.ensureBitOffset(bitOffset);
    const data = await this.dbRead(dbNumber, byteOffset, 1);
    return ((data[0] ?? 0) & (1 << bitOffset)) !== 0;
  }

  /**
   * Write a single bit while preserving other bits in the same byte.
   */
  public async dbWriteBool(dbNumber: number, byteOffset: number, bitOffset: number, value: boolean): Promise<void> {
    this.ensureBitOffset(bitOffset);
    const data = await this.dbRead(dbNumber, byteOffset, 1);
    const current = data[0] ?? 0;
    const updated = value ? current | (1 << bitOffset) : current & ~(1 << bitOffset);
    await this.dbWrite(dbNumber, byteOffset, Uint8Array.of(updated));
  }

  /**
   * Read a BYTE from DB.
   */
  public async dbReadByte(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 1);
    return data[0] ?? 0;
  }

  /**
   * Write a BYTE into DB.
   */
  public dbWriteByte(dbNumber: number, offset: number, value: number): Promise<void> {
    return this.dbWrite(dbNumber, offset, Uint8Array.of(value & 0xff));
  }

  /**
   * Read INT (16-bit signed big-endian) from DB.
   */
  public async dbReadInt(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 2);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt16(0, false);
  }

  /**
   * Write INT (16-bit signed big-endian) to DB.
   */
  public dbWriteInt(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(2);
    new DataView(data.buffer).setInt16(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * Read UINT (16-bit unsigned big-endian) from DB.
   */
  public async dbReadUint(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 2);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, false);
  }

  /**
   * Write UINT (16-bit unsigned big-endian) to DB.
   */
  public dbWriteUint(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(2);
    new DataView(data.buffer).setUint16(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * WORD is an unsigned 16-bit value in S7.
   */
  public dbReadWord(dbNumber: number, offset: number): Promise<number> {
    return this.dbReadUint(dbNumber, offset);
  }

  /**
   * WORD is an unsigned 16-bit value in S7.
   */
  public dbWriteWord(dbNumber: number, offset: number, value: number): Promise<void> {
    return this.dbWriteUint(dbNumber, offset, value);
  }

  /**
   * Read DINT (32-bit signed big-endian) from DB.
   */
  public async dbReadDint(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 4);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(0, false);
  }

  /**
   * Write DINT (32-bit signed big-endian) to DB.
   */
  public dbWriteDint(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setInt32(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * Read UDINT (32-bit unsigned big-endian) from DB.
   */
  public async dbReadUdint(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 4);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
  }

  /**
   * Write UDINT (32-bit unsigned big-endian) to DB.
   */
  public dbWriteUdint(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * DWORD is an unsigned 32-bit value in S7.
   */
  public dbReadDword(dbNumber: number, offset: number): Promise<number> {
    return this.dbReadUdint(dbNumber, offset);
  }

  /**
   * DWORD is an unsigned 32-bit value in S7.
   */
  public dbWriteDword(dbNumber: number, offset: number, value: number): Promise<void> {
    return this.dbWriteUdint(dbNumber, offset, value);
  }

  /**
   * Read REAL (32-bit IEEE754 big-endian) from DB.
   */
  public async dbReadReal(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 4);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(0, false);
  }

  /**
   * Write REAL (32-bit IEEE754 big-endian) to DB.
   */
  public dbWriteReal(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(4);
    new DataView(data.buffer).setFloat32(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * Read LREAL (64-bit IEEE754 big-endian) from DB.
   */
  public async dbReadLreal(dbNumber: number, offset: number): Promise<number> {
    const data = await this.dbRead(dbNumber, offset, 8);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(0, false);
  }

  /**
   * Write LREAL (64-bit IEEE754 big-endian) to DB.
   */
  public dbWriteLreal(dbNumber: number, offset: number, value: number): Promise<void> {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setFloat64(0, value, false);
    return this.dbWrite(dbNumber, offset, data);
  }

  /**
   * Read classic S7 STRING.
   */
  public async dbReadString(dbNumber: number, offset: number): Promise<string> {
    const header = await this.dbRead(dbNumber, offset, 2);
    const maxLength = header[0] ?? 0;
    const currentLength = Math.min(header[1] ?? 0, maxLength);
    const data = await this.dbRead(dbNumber, offset + 2, maxLength);
    return this.decodeLatin1(data.slice(0, currentLength));
  }

  /**
   * Write classic S7 STRING.
   */
  public dbWriteString(dbNumber: number, offset: number, value: string, maxLength = 254): Promise<void> {
    const encoded = this.encodeLatin1(value);
    const used = encoded.slice(0, maxLength);
    const out = new Uint8Array(2 + maxLength);
    out[0] = maxLength & 0xff;
    out[1] = used.length & 0xff;
    out.set(used, 2);
    return this.dbWrite(dbNumber, offset, out);
  }

  /**
   * Read S7 WSTRING (UTF-16 big-endian payload).
   */
  public async dbReadWstring(dbNumber: number, offset: number): Promise<string> {
    const header = await this.dbRead(dbNumber, offset, 4);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const maxLength = view.getUint16(0, false);
    const currentLength = Math.min(view.getUint16(2, false), maxLength);
    const data = await this.dbRead(dbNumber, offset + 4, maxLength * 2);
    return this.decodeUtf16Be(data.slice(0, currentLength * 2));
  }

  /**
   * Write S7 WSTRING (UTF-16 big-endian payload).
   */
  public dbWriteWstring(dbNumber: number, offset: number, value: string, maxLength = 254): Promise<void> {
    const units = this.encodeUtf16Be(value, maxLength);
    const out = new Uint8Array(4 + maxLength * 2);
    const view = new DataView(out.buffer);
    view.setUint16(0, maxLength, false);
    view.setUint16(2, units.length / 2, false);
    out.set(units, 4);
    return this.dbWrite(dbNumber, offset, out);
  }

  /**
   * Generic area read with automatic request chunking based on negotiated PDU.
   */
  public async readArea(
    area: Area,
    dbNumber: number,
    start: number,
    size: number,
    wordLen: WordLen = this.defaultWordLenForArea(area)
  ): Promise<Uint8Array> {
    const startMs = Date.now();
    try {
      const result = await this.executeReliably("readArea", true, async () => {
        const bytesPerElement = this.bytesPerElement(wordLen);
        const maxElementsPerChunk = Math.max(1, Math.floor(this.maxReadSize() / bytesPerElement));
        let remaining = size;
        let currentStart = start;
        const chunks: Uint8Array[] = [];

        while (remaining > 0) {
          const chunkElements = Math.min(remaining, maxElementsPerChunk);
          const chunk = await this.readAreaChunk(area, dbNumber, currentStart, chunkElements, wordLen);
          chunks.push(chunk);
          remaining -= chunkElements;
          currentStart += chunkElements;
        }
        return this.concatChunks(chunks);
      });
      this.recordSuccess(startMs);
      return result;
    } catch (error) {
      this.recordFailure(startMs, this.classifyErrorCode(error));
      throw error;
    }
  }

  /**
   * Generic area write with automatic request chunking based on negotiated PDU.
   */
  public async writeArea(
    area: Area,
    dbNumber: number,
    start: number,
    data: Uint8Array,
    wordLen: WordLen = this.defaultWordLenForArea(area)
  ): Promise<void> {
    const startMs = Date.now();
    try {
      await this.executeReliably("writeArea", false, async () => {
        const bytesPerElement = this.bytesPerElement(wordLen);
        if (data.length % bytesPerElement !== 0) {
          throw new Error(`Data length ${data.length} is not aligned for word length ${wordLen}`);
        }

        const totalElements = data.length / bytesPerElement;
        const maxElementsPerChunk = Math.max(1, Math.floor(this.maxWriteSize() / bytesPerElement));
        let remaining = totalElements;
        let currentStart = start;
        let offsetBytes = 0;

        while (remaining > 0) {
          const chunkElements = Math.min(remaining, maxElementsPerChunk);
          const chunkBytes = chunkElements * bytesPerElement;
          const chunkData = data.slice(offsetBytes, offsetBytes + chunkBytes);
          await this.writeAreaChunk(area, dbNumber, currentStart, chunkData, wordLen);
          remaining -= chunkElements;
          currentStart += chunkElements;
          offsetBytes += chunkBytes;
        }
      });
      this.recordSuccess(startMs);
    } catch (error) {
      this.recordFailure(startMs, this.classifyErrorCode(error));
      throw error;
    }
  }

  /**
   * Shortcut read from process outputs (PA).
   */
  public abRead(start: number, size: number): Promise<Uint8Array> {
    return this.readArea(Area.PA, 0, start, size, WordLen.Byte);
  }

  /**
   * Shortcut write to process outputs (PA).
   */
  public abWrite(start: number, data: Uint8Array): Promise<void> {
    return this.writeArea(Area.PA, 0, start, data, WordLen.Byte);
  }

  /**
   * Shortcut read from process inputs (PE).
   */
  public ebRead(start: number, size: number): Promise<Uint8Array> {
    return this.readArea(Area.PE, 0, start, size, WordLen.Byte);
  }

  /**
   * Shortcut write to process inputs (PE).
   */
  public ebWrite(start: number, size: number, data: Uint8Array): Promise<void> {
    return this.writeArea(Area.PE, 0, start, data.slice(0, size), WordLen.Byte);
  }

  /**
   * Shortcut read from marker memory (MK).
   */
  public mbRead(start: number, size: number): Promise<Uint8Array> {
    return this.readArea(Area.MK, 0, start, size, WordLen.Byte);
  }

  /**
   * Shortcut write to marker memory (MK).
   */
  public mbWrite(start: number, size: number, data: Uint8Array): Promise<void> {
    return this.writeArea(Area.MK, 0, start, data.slice(0, size), WordLen.Byte);
  }

  /**
   * Shortcut read from timers (TM).
   */
  public tmRead(start: number, size: number): Promise<Uint8Array> {
    return this.readArea(Area.TM, 0, start, size, WordLen.Timer);
  }

  /**
   * Shortcut write to timers (TM).
   */
  public tmWrite(start: number, size: number, data: Uint8Array): Promise<void> {
    if (data.length !== size * 2) {
      return Promise.reject(new Error(`Data length ${data.length} doesn't match size ${size * 2}`));
    }
    return this.writeArea(Area.TM, 0, start, data, WordLen.Timer);
  }

  /**
   * Shortcut read from counters (CT).
   */
  public ctRead(start: number, size: number): Promise<Uint8Array> {
    return this.readArea(Area.CT, 0, start, size, WordLen.Counter);
  }

  /**
   * Shortcut write to counters (CT).
   */
  public ctWrite(start: number, size: number, data: Uint8Array): Promise<void> {
    if (data.length !== size * 2) {
      return Promise.reject(new Error(`Data length ${data.length} doesn't match size ${size * 2}`));
    }
    return this.writeArea(Area.CT, 0, start, data, WordLen.Counter);
  }

  private async connectAuto(options: ConnectOptions): Promise<void> {
    try {
      await this.connectS7CommPlus(options);
      return;
    } catch (plusError) {
      this.disconnectS7CommPlusOnly();

      try {
        await this.connectLegacy(options);
      } catch (legacyError) {
        throw new Snap7ConnectionError(
          `Auto protocol negotiation failed (s7commplus: ${this.errorMessage(plusError)}; legacy: ${this.errorMessage(
            legacyError
          )})`
        );
      }
    }
  }

  private async connectInternal(options: ConnectOptions): Promise<void> {
    this.hostValue = options.address;
    this.preferredProtocol = options.protocol ?? "auto";
    await this.disconnectInternal();

    if (this.preferredProtocol === "legacy") {
      await this.connectLegacy(options);
    } else if (this.preferredProtocol === "s7commplus") {
      await this.connectS7CommPlus(options);
    } else {
      await this.connectAuto(options);
    }

    this.lastConnectOptions = { ...options };
    this.startHeartbeat();
  }

  private async disconnectInternal(): Promise<void> {
    this.stopHeartbeat();
    let disconnectError: unknown;

    if (this.s7CommPlusClient !== null) {
      try {
        this.s7CommPlusClient.disconnect();
      } catch (error) {
        disconnectError = error;
      }
    }

    if (this.legacyClient !== null) {
      try {
        await this.legacyClient.disconnect();
      } catch (error) {
        if (disconnectError === undefined) {
          disconnectError = error;
        }
      }
    }

    this.activeProtocol = null;
    this.s7CommPlusClient = null;
    this.legacyClient = null;

    if (disconnectError !== undefined) {
      const err = new Snap7ConnectionError(
        disconnectError instanceof Error ? disconnectError.message : "Failed to disconnect unified AsyncClient"
      );
      this.hooks.onDisconnect?.(err);
      throw err;
    }
    this.hooks.onDisconnect?.(null);
  }

  private async connectLegacy(options: ConnectOptions): Promise<void> {
    const legacyClient = this.createLegacyClient();
    const connectOptions: { address: string; rack?: number; slot?: number; tcpPort?: number } = {
      address: options.address
    };
    if (options.rack !== undefined) {
      connectOptions.rack = options.rack;
    }
    if (options.slot !== undefined) {
      connectOptions.slot = options.slot;
    }
    if (options.tcpPort !== undefined) {
      connectOptions.tcpPort = options.tcpPort;
    }
    await legacyClient.connect(connectOptions);
    this.legacyClient = legacyClient;
    this.s7CommPlusClient = null;
    this.activeProtocol = "legacy";
  }

  private async connectS7CommPlus(options: ConnectOptions): Promise<void> {
    const plusClient = this.createS7CommPlusClient();
    const connectOptions: {
      host: string;
      port?: number;
      useTls?: boolean;
      tlsCert?: string;
      tlsKey?: string;
      tlsCa?: string;
    } = {
      host: options.address
    };
    if (options.tcpPort !== undefined) {
      connectOptions.port = options.tcpPort;
    }
    const useTls = options.useTls ?? options.use_tls;
    const tlsCert = options.tlsCert ?? options.tls_cert;
    const tlsKey = options.tlsKey ?? options.tls_key;
    const tlsCa = options.tlsCa ?? options.tls_ca;
    if (useTls !== undefined) {
      connectOptions.useTls = useTls;
    }
    if (tlsCert !== undefined) {
      connectOptions.tlsCert = tlsCert;
    }
    if (tlsKey !== undefined) {
      connectOptions.tlsKey = tlsKey;
    }
    if (tlsCa !== undefined) {
      connectOptions.tlsCa = tlsCa;
    }
    await plusClient.connect(connectOptions);
    this.s7CommPlusClient = plusClient;
    this.legacyClient = null;
    this.activeProtocol = "s7commplus";
  }

  private disconnectS7CommPlusOnly(): void {
    if (this.s7CommPlusClient === null) {
      return;
    }
    try {
      this.s7CommPlusClient.disconnect();
    } finally {
      this.s7CommPlusClient = null;
      this.activeProtocol = null;
    }
  }

  private requireLegacyClient(): LegacyClientLike {
    if (this.legacyClient === null) {
      throw new Snap7ConnectionError("Legacy client is not connected");
    }
    return this.legacyClient;
  }

  private requireS7CommPlusClient(): S7CommPlusClientLike {
    if (this.s7CommPlusClient === null) {
      throw new Snap7ConnectionError("S7CommPlus client is not connected");
    }
    return this.s7CommPlusClient;
  }

  private requireLegacyClientForBlockOps(): LegacyClientLike {
    if (this.activeProtocol === "s7commplus") {
      throw new Error("Block catalog/info APIs require legacy protocol connection");
    }
    return this.requireLegacyClient();
  }

  private requireLegacyClientForServiceOps(serviceName: string): LegacyClientLike {
    if (this.activeProtocol === "s7commplus") {
      throw new Error(`${serviceName} requires legacy protocol connection`);
    }
    return this.requireLegacyClient();
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private isNonClientParameter(parameter: ClientParameter): boolean {
    return (
      parameter === ClientParameter.LocalPort ||
      parameter === ClientParameter.WorkInterval ||
      parameter === ClientParameter.MaxClients ||
      parameter === ClientParameter.BSendTimeout ||
      parameter === ClientParameter.BRecvTimeout ||
      parameter === ClientParameter.RecoveryTime ||
      parameter === ClientParameter.KeepAliveTime
    );
  }

  private classifyErrorCode(error: unknown): number {
    if (error instanceof Snap7ConnectionError) {
      if (error.message.includes("not connected")) {
        return 0x0003;
      }
      return 0x0004;
    }
    return 0x0005;
  }

  private recordSuccess(startMs: number): void {
    this.lastExecTimeMs = Date.now() - startMs;
    this.lastErrorCode = 0;
  }

  private recordFailure(startMs: number, code: number): void {
    this.lastExecTimeMs = Date.now() - startMs;
    this.lastErrorCode = code;
  }

  private async readAreaChunk(
    area: Area,
    dbNumber: number,
    start: number,
    amount: number,
    wordLen: WordLen
  ): Promise<Uint8Array> {
    if (this.activeProtocol === "legacy") {
      const legacy = this.requireLegacyClient();
      if (legacy.readArea === undefined) {
        throw new Error("Legacy client does not support readArea");
      }
      return legacy.readArea(area, dbNumber, start, amount, wordLen);
    }

    if (this.activeProtocol === "s7commplus") {
      if (area !== Area.DB || wordLen !== WordLen.Byte) {
        throw new Error("S7CommPlus area access currently supports DB byte reads only");
      }
      return this.requireS7CommPlusClient().dbRead(dbNumber, start, amount);
    }

    throw new Snap7ConnectionError("AsyncClient is not connected");
  }

  private async writeAreaChunk(
    area: Area,
    dbNumber: number,
    start: number,
    data: Uint8Array,
    wordLen: WordLen
  ): Promise<void> {
    if (this.activeProtocol === "legacy") {
      const legacy = this.requireLegacyClient();
      if (legacy.writeArea === undefined) {
        throw new Error("Legacy client does not support writeArea");
      }
      await legacy.writeArea(area, dbNumber, start, data, wordLen);
      return;
    }

    if (this.activeProtocol === "s7commplus") {
      if (area !== Area.DB || wordLen !== WordLen.Byte) {
        throw new Error("S7CommPlus area access currently supports DB byte writes only");
      }
      await this.requireS7CommPlusClient().dbWrite(dbNumber, start, data);
      return;
    }

    throw new Snap7ConnectionError("AsyncClient is not connected");
  }

  private maxReadSize(): number {
    return this.getPduLength() - 18;
  }

  private maxWriteSize(): number {
    return this.getPduLength() - 35;
  }

  private defaultWordLenForArea(area: Area): WordLen {
    if (area === Area.TM) {
      return WordLen.Timer;
    }
    if (area === Area.CT) {
      return WordLen.Counter;
    }
    return WordLen.Byte;
  }

  private bytesPerElement(wordLen: WordLen): number {
    if (wordLen === WordLen.Bit || wordLen === WordLen.Byte || wordLen === WordLen.Char) {
      return 1;
    }
    if (wordLen === WordLen.Word || wordLen === WordLen.Int || wordLen === WordLen.Counter || wordLen === WordLen.Timer) {
      return 2;
    }
    if (wordLen === WordLen.DWord || wordLen === WordLen.DInt || wordLen === WordLen.Real) {
      return 4;
    }
    return 1;
  }

  private concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  private ensureBitOffset(bitOffset: number): void {
    if (bitOffset < 0 || bitOffset > 7) {
      throw new Error(`Bit offset must be 0-7, got ${bitOffset}`);
    }
  }

  private encodeLatin1(value: string): Uint8Array {
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i) & 0xff;
    }
    return out;
  }

  private decodeLatin1(bytes: Uint8Array): string {
    let out = "";
    for (const b of bytes) {
      out += String.fromCharCode(b);
    }
    return out;
  }

  private encodeUtf16Be(value: string, maxLength: number): Uint8Array {
    const limited = value.slice(0, maxLength);
    const out = new Uint8Array(limited.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < limited.length; i += 1) {
      view.setUint16(i * 2, limited.charCodeAt(i), false);
    }
    return out;
  }

  private decodeUtf16Be(bytes: Uint8Array): string {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(view.getUint16(i, false));
    }
    return out;
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.opQueue.then(operation, operation);
    this.opQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async executeReliably<T>(name: string, retryOnReconnect: boolean, operation: () => Promise<T>): Promise<T> {
    return this.enqueueOperation(async () => {
      const start = Date.now();
      try {
        const value = await operation();
        this.reportOperation(name, start, true);
        return value;
      } catch (error) {
        if (retryOnReconnect && this.shouldAttemptReconnect(error)) {
          await this.reconnectWithBackoff(this.asError(error));
          const value = await operation();
          this.reportOperation(name, start, true);
          return value;
        }
        this.reportOperation(name, start, false, this.asError(error));
        throw error;
      }
    });
  }

  private shouldAttemptReconnect(error: unknown): boolean {
    if (!this.autoReconnect || this.lastConnectOptions === null) {
      return false;
    }
    const err = this.asError(error);
    const msg = err.message.toLowerCase();
    return (
      err instanceof Snap7ConnectionError ||
      msg.includes("not connected") ||
      msg.includes("socket") ||
      msg.includes("transport") ||
      msg.includes("connection")
    );
  }

  private async reconnectWithBackoff(reason: Error): Promise<void> {
    const baseOptions = this.lastConnectOptions;
    if (baseOptions === null) {
      throw reason;
    }

    let delayMs = Math.max(1, this.reconnectInitialDelayMs);
    for (let attempt = 1; attempt <= Math.max(1, this.maxReconnectAttempts); attempt += 1) {
      try {
        await this.disconnectInternal();
        await this.connectInternal(baseOptions);
        this.hooks.onReconnect?.(attempt);
        return;
      } catch (error) {
        if (attempt >= this.maxReconnectAttempts) {
          throw this.asError(error);
        }
      }
      await this.sleep(delayMs);
      delayMs = Math.min(Math.floor(delayMs * this.reconnectBackoffFactor), this.reconnectMaxDelayMs);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      void this.onHeartbeatTick();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async onHeartbeatTick(): Promise<void> {
    if (this.heartbeatRunning) {
      return;
    }
    this.heartbeatRunning = true;
    try {
      await this.executeReliably("heartbeat", true, async () => {
        if (!this.connected) {
          throw new Snap7ConnectionError("Heartbeat detected disconnected client");
        }
        if (this.activeProtocol === "legacy" && this.legacyClient?.getCpuState !== undefined) {
          await this.legacyClient.getCpuState();
        }
      });
    } catch {
      // heartbeats are best-effort; failures are reported via hooks
    } finally {
      this.heartbeatRunning = false;
    }
  }

  private reportOperation(name: string, startMs: number, success: boolean, error?: Error): void {
    const durationMs = Date.now() - startMs;
    this.hooks.onOperation?.(name, durationMs, success, error);
  }

  private asError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
