import { Snap7ConnectionError, Snap7ProtocolError } from "../../errors/index.js";
import { Block, type BlocksList, type TS7BlockInfo } from "../../types.js";
import { AsyncIsoTransport } from "../../transport/index.js";
import type { TransportConnectOptions, TransportRequestOptions } from "../../transport/types.js";
import { LegacyS7Protocol, S7Area, S7WordLen } from "./protocol.js";

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
    return this.readArea(S7Area.DB, dbNumber, start, size, S7WordLen.BYTE, options);
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
    await this.writeArea(S7Area.DB, dbNumber, start, data, S7WordLen.BYTE, options);
  }

  /**
   * Reads bytes from any classic S7 area.
   */
  public async readArea(
    area: S7Area,
    dbNumber: number,
    start: number,
    amount: number,
    wordLen: S7WordLen,
    options: TransportRequestOptions = {}
  ): Promise<Uint8Array> {
    this.ensureConnected();

    const request = this.protocol.buildReadAreaRequest(area, dbNumber, start, amount, wordLen);
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    return this.protocol.extractReadBytes(parsed);
  }

  /**
   * Writes bytes to any classic S7 area.
   */
  public async writeArea(
    area: S7Area,
    dbNumber: number,
    start: number,
    data: Uint8Array,
    wordLen: S7WordLen,
    options: TransportRequestOptions = {}
  ): Promise<void> {
    this.ensureConnected();

    const request = this.protocol.buildWriteAreaRequest(area, dbNumber, start, data, wordLen);
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    this.protocol.checkWriteResponse(parsed);
  }

  /**
   * List all block counters available on the PLC.
   */
  public async listBlocks(options: TransportRequestOptions = {}): Promise<BlocksList> {
    this.ensureConnected();

    const request = this.protocol.buildListBlocksRequest();
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    this.ensureSuccessReturnCode(parsed.returnCode, "List blocks");

    const counts = this.protocol.parseListBlocksResponse(parsed);
    return {
      OBCount: counts.OBCount ?? 0,
      FBCount: counts.FBCount ?? 0,
      FCCount: counts.FCCount ?? 0,
      SFBCount: counts.SFBCount ?? 0,
      SFCCount: counts.SFCCount ?? 0,
      DBCount: counts.DBCount ?? 0,
      SDBCount: counts.SDBCount ?? 0
    };
  }

  /**
   * List block numbers of a specific block type.
   *
   * The legacy USER_DATA operation may return data in multiple fragments.
   * We accumulate all fragments before decoding block numbers.
   */
  public async listBlocksOfType(
    blockType: Block,
    maxCount: number,
    options: TransportRequestOptions = {}
  ): Promise<number[]> {
    this.ensureConnected();

    const request = this.protocol.buildListBlocksOfTypeRequest(this.toLegacyBlockTypeCode(blockType));
    const firstResponse = await this.exchange(request, options);
    let parsed = this.protocol.parseResponse(firstResponse);
    this.ensureSuccessReturnCode(parsed.returnCode, "List blocks of type");

    let accumulated = parsed.data ?? new Uint8Array(0);
    let lastDataUnit = parsed.parameters?.lastDataUnit ?? 0x00;
    let sequenceNumber = parsed.parameters?.sequenceNumber ?? 0x00;
    const group = parsed.parameters?.group ?? 0x03;
    const subfunction = parsed.parameters?.subfunction ?? 0x02;

    for (let i = 0; i < 100 && lastDataUnit !== 0x00; i += 1) {
      const followup = this.protocol.buildUserDataFollowupRequest(group, subfunction, sequenceNumber);
      const followupPdu = await this.exchange(followup, options);
      parsed = this.protocol.parseResponse(followupPdu);
      this.ensureSuccessReturnCode(parsed.returnCode, "List blocks of type follow-up");
      accumulated = this.concatChunks(accumulated, parsed.data ?? new Uint8Array(0));
      lastDataUnit = parsed.parameters?.lastDataUnit ?? 0x00;
      sequenceNumber = parsed.parameters?.sequenceNumber ?? sequenceNumber;
    }

    const blockNumbers = this.protocol.parseListBlocksOfTypeResponse({
      sequence: parsed.sequence,
      parameterLength: 0,
      dataLength: accumulated.length,
      returnCode: 0xff,
      data: accumulated
    });
    return blockNumbers.slice(0, Math.max(0, maxCount));
  }

  /**
   * Get metadata for a specific block.
   */
  public async getBlockInfo(
    blockType: Block,
    blockNumber: number,
    options: TransportRequestOptions = {}
  ): Promise<TS7BlockInfo> {
    this.ensureConnected();

    const request = this.protocol.buildGetBlockInfoRequest(this.toLegacyBlockTypeCode(blockType), blockNumber);
    const responsePdu = await this.exchange(request, options);
    const parsed = this.protocol.parseResponse(responsePdu);
    this.ensureSuccessReturnCode(parsed.returnCode, "Get block info");

    const info = this.protocol.parseGetBlockInfoResponse(parsed);
    return {
      BlkType: info.block_type,
      BlkNumber: info.block_number,
      BlkLang: info.block_lang,
      BlkFlags: info.block_flags,
      MC7Size: info.mc7_size,
      LoadSize: info.load_size,
      LocalData: info.local_data,
      SBBLength: info.sbb_length,
      CheckSum: info.checksum,
      Version: info.version,
      CodeDate: this.protocol.bytesToAscii(info.code_date).slice(0, 10),
      IntfDate: this.protocol.bytesToAscii(info.intf_date).slice(0, 10),
      Author: this.protocol.bytesToAscii(info.author).slice(0, 8),
      Family: this.protocol.bytesToAscii(info.family).slice(0, 8),
      Header: this.protocol.bytesToAscii(info.header).slice(0, 8)
    };
  }

  /**
   * Decode block header information from raw block bytes.
   *
   * This mirrors python-snap7 ClientMixin.get_pg_block_info behavior.
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
    // python-snap7 uses deterministic placeholder dates in this helper.
    info.CodeDate = "2019/06/27";
    info.IntfDate = "2019/06/27";
    return info;
  }

  private ensureConnected(): void {
    if (!this.connectedValue) {
      throw new Snap7ConnectionError("Legacy S7 client is not connected");
    }
  }

  private ensureSuccessReturnCode(returnCode: number | undefined, operation: string): void {
    if (returnCode !== 0xff) {
      const code = (returnCode ?? 0).toString(16).padStart(2, "0");
      throw new Snap7ProtocolError(`${operation} failed with return code 0x${code}`);
    }
  }

  private toLegacyBlockTypeCode(blockType: Block): number {
    if (
      blockType === Block.OB ||
      blockType === Block.DB ||
      blockType === Block.SDB ||
      blockType === Block.FC ||
      blockType === Block.SFC ||
      blockType === Block.FB ||
      blockType === Block.SFB
    ) {
      return blockType;
    }
    return Block.DB;
  }

  private concatChunks(first: Uint8Array, second: Uint8Array): Uint8Array {
    const out = new Uint8Array(first.length + second.length);
    out.set(first, 0);
    out.set(second, first.length);
    return out;
  }

  private async exchange(pdu: Uint8Array, options: TransportRequestOptions): Promise<Uint8Array> {
    const wrapped = wrapCotpDt(pdu);
    const responsePayload = await this.transport.request(wrapped, options);
    return unwrapCotpDt(responsePayload);
  }
}
