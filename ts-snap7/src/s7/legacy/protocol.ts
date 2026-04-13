/**
 * Legacy S7 protocol helper used by the async client implementation.
 *
 * This module intentionally mirrors the python-snap7 packet layout for:
 * - setup communication
 * - area read/write
 * - USER_DATA block catalog/block-info calls
 */

export enum S7PduType {
  REQUEST = 0x01,
  ACK = 0x02,
  ACK_DATA = 0x03,
  USERDATA = 0x07
}

export enum S7Function {
  READ_AREA = 0x04,
  WRITE_AREA = 0x05,
  REQUEST_DOWNLOAD = 0x1a,
  DOWNLOAD_BLOCK = 0x1b,
  DOWNLOAD_ENDED = 0x1c,
  START_UPLOAD = 0x1d,
  UPLOAD = 0x1e,
  END_UPLOAD = 0x1f,
  PLC_CONTROL = 0x28,
  PLC_STOP = 0x29,
  SETUP_COMMUNICATION = 0xf0
}

export enum S7Area {
  PE = 0x81,
  PA = 0x82,
  MK = 0x83,
  DB = 0x84,
  CT = 0x1c,
  TM = 0x1d
}

export enum S7WordLen {
  BIT = 0x01,
  BYTE = 0x02,
  CHAR = 0x03,
  WORD = 0x04,
  INT = 0x05,
  DWORD = 0x06,
  DINT = 0x07,
  REAL = 0x08,
  COUNTER = 0x1c,
  TIMER = 0x1d
}

export enum S7BlockSubfunction {
  LIST_ALL = 0x01,
  LIST_BY_TYPE = 0x02,
  BLOCK_INFO = 0x03
}

/**
 * S7 data return-code descriptions aligned with python-snap7.
 */
export const S7_RETURN_CODES: Readonly<Record<number, string>> = Object.freeze({
  0x00: "Reserved",
  0x01: "Hardware error",
  0x03: "Accessing the object not allowed",
  0x05: "Invalid address",
  0x06: "Data type not supported",
  0x07: "Data type inconsistent",
  0x0a: "Object does not exist",
  0x10: "Invalid block type number",
  0x11: "Block not found in storage medium",
  0x12: "Block already exists",
  0x13: "Block is protected",
  0x14: "Block download without proper block first",
  0x19: "Block download sequence error",
  0x1a: "Insufficient working memory",
  0x1b: "Insufficient load memory",
  0x1c: "Not enough work retentive data (instance DBs)",
  0x1d: "Interface error",
  0x1e: "Delete block refused",
  0x20: "Invalid parameter",
  0x21: "PG resource error (max connections reached)",
  0xff: "Success"
});

/**
 * Get human-readable description for S7 return code.
 */
export const getReturnCodeDescription = (returnCode: number): string => {
  return S7_RETURN_CODES[returnCode] ?? "Unknown error";
};

export interface ParsedGetBlockInfo {
  block_type: number;
  block_number: number;
  block_lang: number;
  block_flags: number;
  mc7_size: number;
  load_size: number;
  local_data: number;
  sbb_length: number;
  checksum: number;
  version: number;
  code_date: Uint8Array;
  intf_date: Uint8Array;
  author: Uint8Array;
  family: Uint8Array;
  header: Uint8Array;
}

export interface ParsedReadSzl {
  szlId: number;
  szlIndex: number;
  data: Uint8Array;
}

export interface LegacyS7Response {
  sequence: number;
  parameterLength: number;
  dataLength: number;
  functionCode?: number;
  returnCode?: number;
  transportSize?: number;
  rawParameters?: Uint8Array;
  data?: Uint8Array;
  parameters?: {
    pduLength?: number;
    group?: number;
    subfunction?: number;
    sequenceNumber?: number;
    lastDataUnit?: number;
    errorCode?: number;
  };
}

/**
 * Stateful protocol helper with incrementing sequence numbers.
 */
export class LegacyS7Protocol {
  private sequence = 0;

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) & 0xffff;
    return this.sequence;
  }

  /**
   * Builds setup-communication request to negotiate PDU size.
   */
  public buildSetupCommunicationRequest(maxAmqCaller = 1, maxAmqCallee = 1, pduLength = 480): Uint8Array {
    const header = new Uint8Array(10);
    const hv = new DataView(header.buffer);
    hv.setUint8(0, 0x32);
    hv.setUint8(1, S7PduType.REQUEST);
    hv.setUint16(2, 0x0000, false);
    hv.setUint16(4, this.nextSequence(), false);
    hv.setUint16(6, 0x0008, false);
    hv.setUint16(8, 0x0000, false);

    const params = new Uint8Array(8);
    const pv = new DataView(params.buffer);
    pv.setUint8(0, S7Function.SETUP_COMMUNICATION);
    pv.setUint8(1, 0x00);
    pv.setUint16(2, maxAmqCaller, false);
    pv.setUint16(4, maxAmqCallee, false);
    pv.setUint16(6, pduLength, false);

    const out = new Uint8Array(18);
    out.set(header, 0);
    out.set(params, 10);
    return out;
  }

  /**
   * Builds single-item DB read request.
   */
  public buildReadDbRequest(dbNumber: number, start: number, size: number): Uint8Array {
    return this.buildReadAreaRequest(S7Area.DB, dbNumber, start, size, S7WordLen.BYTE);
  }

  /**
   * Builds single-item area read request.
   */
  public buildReadAreaRequest(area: S7Area, dbNumber: number, start: number, amount: number, wordLen: S7WordLen): Uint8Array {
    const header = new Uint8Array(10);
    const hv = new DataView(header.buffer);
    hv.setUint8(0, 0x32);
    hv.setUint8(1, S7PduType.REQUEST);
    hv.setUint16(2, 0x0000, false);
    hv.setUint16(4, this.nextSequence(), false);
    hv.setUint16(6, 0x000e, false);
    hv.setUint16(8, 0x0000, false);

    const params = new Uint8Array(14);
    const pv = new DataView(params.buffer);
    pv.setUint8(0, S7Function.READ_AREA);
    pv.setUint8(1, 0x01);
    pv.setUint8(2, 0x12);
    pv.setUint8(3, 0x0a);
    pv.setUint8(4, 0x10);
    pv.setUint8(5, wordLen);
    pv.setUint16(6, amount, false);
    pv.setUint16(8, area === S7Area.DB ? dbNumber : 0, false);
    pv.setUint8(10, area);
    // Bit access uses absolute bit offset; other transports use byte offset * 8.
    const address = wordLen === S7WordLen.BIT ? start : start * 8;
    pv.setUint8(11, (address >> 16) & 0xff);
    pv.setUint8(12, (address >> 8) & 0xff);
    pv.setUint8(13, address & 0xff);

    const out = new Uint8Array(header.length + params.length);
    out.set(header, 0);
    out.set(params, header.length);
    return out;
  }

  /**
   * Builds single-item DB write request.
   */
  public buildWriteDbRequest(dbNumber: number, start: number, data: Uint8Array): Uint8Array {
    return this.buildWriteAreaRequest(S7Area.DB, dbNumber, start, data, S7WordLen.BYTE);
  }

  /**
   * Builds single-item area write request.
   */
  public buildWriteAreaRequest(
    area: S7Area,
    dbNumber: number,
    start: number,
    data: Uint8Array,
    wordLen: S7WordLen
  ): Uint8Array {
    const header = new Uint8Array(10);
    const hv = new DataView(header.buffer);
    hv.setUint8(0, 0x32);
    hv.setUint8(1, S7PduType.REQUEST);
    hv.setUint16(2, 0x0000, false);
    hv.setUint16(4, this.nextSequence(), false);
    hv.setUint16(6, 0x000e, false);
    hv.setUint16(8, 0x0004 + data.length, false);

    const params = new Uint8Array(14);
    const pv = new DataView(params.buffer);
    pv.setUint8(0, S7Function.WRITE_AREA);
    pv.setUint8(1, 0x01);
    pv.setUint8(2, 0x12);
    pv.setUint8(3, 0x0a);
    pv.setUint8(4, 0x10);
    pv.setUint8(5, wordLen);
    const amount = this.computeAmountFromDataLength(wordLen, data.length);
    pv.setUint16(6, amount, false);
    pv.setUint16(8, area === S7Area.DB ? dbNumber : 0, false);
    pv.setUint8(10, area);
    const address = wordLen === S7WordLen.BIT ? start : start * 8;
    pv.setUint8(11, (address >> 16) & 0xff);
    pv.setUint8(12, (address >> 8) & 0xff);
    pv.setUint8(13, address & 0xff);

    const dataSection = new Uint8Array(4 + data.length);
    const dv = new DataView(dataSection.buffer);
    dv.setUint8(0, 0x00);
    dv.setUint8(1, this.dataTransportSize(wordLen));
    dv.setUint16(2, data.length * 8, false);
    dataSection.set(data, 4);

    const out = new Uint8Array(header.length + params.length + dataSection.length);
    out.set(header, 0);
    out.set(params, header.length);
    out.set(dataSection, header.length + params.length);
    return out;
  }

  /**
   * Builds USER_DATA request for list-blocks operation.
   */
  public buildListBlocksRequest(): Uint8Array {
    return this.buildBlockUserDataRequest(S7BlockSubfunction.LIST_ALL, new Uint8Array(0), 0x00);
  }

  /**
   * Builds USER_DATA request for list-blocks-of-type operation.
   */
  public buildListBlocksOfTypeRequest(blockType: number): Uint8Array {
    return this.buildBlockUserDataRequest(S7BlockSubfunction.LIST_BY_TYPE, Uint8Array.of(0x30, blockType, 0x0a, 0x00), 0x00);
  }

  /**
   * Builds USER_DATA request for get-block-info operation.
   */
  public buildGetBlockInfoRequest(blockType: number, blockNumber: number): Uint8Array {
    const blockNumberAscii = String(blockNumber).padStart(5, "0");
    const payload = new Uint8Array(8);
    payload[0] = 0x30;
    payload[1] = blockType & 0xff;
    payload[2] = 0x41; // ASCII 'A'
    for (let i = 0; i < 5; i += 1) {
      payload[3 + i] = blockNumberAscii.charCodeAt(i);
    }
    return this.buildBlockUserDataRequest(S7BlockSubfunction.BLOCK_INFO, payload, 0x00);
  }

  /**
   * Builds USER_DATA follow-up request for multi-packet block answers.
   */
  public buildUserDataFollowupRequest(group: number, subfunction: number, sequenceNumber: number): Uint8Array {
    const typeGroup = 0x40 | (group & 0x0f);
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x04, 0x11, typeGroup, subfunction, sequenceNumber & 0xff);
    const dataSection = Uint8Array.of(0x0a, 0x00, 0x00, 0x00);
    return this.buildUserDataPdu(params, dataSection);
  }

  /**
   * Parses block counts from a list-blocks response.
   */
  public parseListBlocksResponse(response: LegacyS7Response): Record<string, number> {
    const out: Record<string, number> = {
      OBCount: 0,
      FBCount: 0,
      FCCount: 0,
      SFBCount: 0,
      SFCCount: 0,
      DBCount: 0,
      SDBCount: 0
    };
    const raw = response.data ?? new Uint8Array(0);
    const typeToName = new Map<number, keyof typeof out>([
      [0x38, "OBCount"],
      [0x41, "DBCount"],
      [0x42, "SDBCount"],
      [0x43, "FCCount"],
      [0x44, "SFCCount"],
      [0x45, "FBCount"],
      [0x46, "SFBCount"]
    ]);

    for (let offset = 0; offset + 4 <= raw.length; offset += 4) {
      const indicator = raw[offset] ?? 0;
      const blockType = raw[offset + 1] ?? 0;
      if (indicator !== 0x30) {
        continue;
      }
      const field = typeToName.get(blockType);
      if (field === undefined) {
        continue;
      }
      out[field] = new DataView(raw.buffer, raw.byteOffset + offset + 2, 2).getUint16(0, false);
    }
    return out;
  }

  /**
   * Parses block numbers from a list-blocks-of-type response payload.
   */
  public parseListBlocksOfTypeResponse(response: LegacyS7Response): number[] {
    const result: number[] = [];
    const raw = response.data ?? new Uint8Array(0);
    for (let offset = 0; offset + 4 <= raw.length; offset += 4) {
      const value = new DataView(raw.buffer, raw.byteOffset + offset, 2).getUint16(0, false);
      result.push(value);
    }
    return result;
  }

  /**
   * Parses block metadata from USER_DATA get-block-info payload.
   */
  public parseGetBlockInfoResponse(response: LegacyS7Response): ParsedGetBlockInfo {
    const raw = response.data ?? new Uint8Array(0);
    const empty: ParsedGetBlockInfo = {
      block_type: 0,
      block_number: 0,
      block_lang: 0,
      block_flags: 0,
      mc7_size: 0,
      load_size: 0,
      local_data: 0,
      sbb_length: 0,
      checksum: 0,
      version: 0,
      code_date: new Uint8Array(0),
      intf_date: new Uint8Array(0),
      author: new Uint8Array(0),
      family: new Uint8Array(0),
      header: new Uint8Array(0)
    };

    if (raw.length < 78) {
      return empty;
    }

    return {
      block_type: raw[1] ?? 0,
      block_number: new DataView(raw.buffer, raw.byteOffset + 12, 2).getUint16(0, false),
      block_lang: raw[10] ?? 0,
      block_flags: raw[9] ?? 0,
      mc7_size: new DataView(raw.buffer, raw.byteOffset + 40, 2).getUint16(0, false),
      load_size: new DataView(raw.buffer, raw.byteOffset + 14, 4).getUint32(0, false),
      local_data: new DataView(raw.buffer, raw.byteOffset + 38, 2).getUint16(0, false),
      sbb_length: new DataView(raw.buffer, raw.byteOffset + 34, 2).getUint16(0, false),
      checksum: new DataView(raw.buffer, raw.byteOffset + 68, 2).getUint16(0, false),
      version: raw[66] ?? 0,
      code_date: raw.slice(22, 28),
      intf_date: raw.slice(28, 34),
      author: raw.slice(42, 50),
      family: raw.slice(50, 58),
      header: raw.slice(58, 66)
    };
  }

  /**
   * Builds START_UPLOAD request.
   */
  public buildStartUploadRequest(blockType: number, blockNumber: number): Uint8Array {
    const blockAddrAscii = `${blockType.toString(16).toUpperCase().padStart(2, "0")}${String(blockNumber).padStart(5, "0")}A`;
    const addr = this.asciiBytes(blockAddrAscii);
    const params = new Uint8Array(9 + addr.length);
    const view = new DataView(params.buffer);
    view.setUint8(0, S7Function.START_UPLOAD);
    view.setUint8(1, 0x00);
    view.setUint8(2, 0x00);
    view.setUint32(3, 0x00000000, false);
    view.setUint8(7, addr.length);
    params.set(addr, 8);
    return this.buildRequestPdu(params, new Uint8Array(0));
  }

  /**
   * Builds UPLOAD request.
   */
  public buildUploadRequest(uploadId: number): Uint8Array {
    const params = new Uint8Array(7);
    const view = new DataView(params.buffer);
    view.setUint8(0, S7Function.UPLOAD);
    view.setUint8(1, 0x00);
    view.setUint8(2, 0x00);
    view.setUint32(3, uploadId >>> 0, false);
    return this.buildRequestPdu(params, new Uint8Array(0));
  }

  /**
   * Builds END_UPLOAD request.
   */
  public buildEndUploadRequest(uploadId: number): Uint8Array {
    const params = new Uint8Array(7);
    const view = new DataView(params.buffer);
    view.setUint8(0, S7Function.END_UPLOAD);
    view.setUint8(1, 0x00);
    view.setUint8(2, 0x00);
    view.setUint32(3, uploadId >>> 0, false);
    return this.buildRequestPdu(params, new Uint8Array(0));
  }

  /**
   * Builds REQUEST_DOWNLOAD request.
   */
  public buildDownloadRequest(blockType: number, blockNumber: number, blockData: Uint8Array): Uint8Array {
    const blockAddrAscii = `${blockType.toString(16).toUpperCase().padStart(2, "0")}${String(blockNumber).padStart(5, "0")}P`;
    const blockAddr = this.asciiBytes(blockAddrAscii);
    const lengthAscii = this.asciiBytes(String(blockData.length).padStart(6, "0"));
    const params = new Uint8Array(6 + blockAddr.length + 1 + lengthAscii.length);
    let offset = 0;
    params[offset++] = S7Function.REQUEST_DOWNLOAD;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = blockAddr.length;
    params.set(blockAddr, offset);
    offset += blockAddr.length;
    params[offset++] = lengthAscii.length;
    params.set(lengthAscii, offset);
    return this.buildRequestPdu(params, new Uint8Array(0));
  }

  /**
   * Builds DOWNLOAD_BLOCK request (data-transfer phase).
   */
  public buildDownloadBlockRequest(blockData: Uint8Array): Uint8Array {
    const params = Uint8Array.of(S7Function.DOWNLOAD_BLOCK, 0x01, 0x00);
    const dataSection = new Uint8Array(4 + blockData.length);
    const view = new DataView(dataSection.buffer);
    view.setUint16(0, blockData.length, false);
    view.setUint16(2, 0x00fb, false);
    dataSection.set(blockData, 4);
    return this.buildRequestPdu(params, dataSection);
  }

  /**
   * Builds DOWNLOAD_ENDED request.
   */
  public buildDownloadEndedRequest(): Uint8Array {
    return this.buildRequestPdu(Uint8Array.of(S7Function.DOWNLOAD_ENDED), new Uint8Array(0));
  }

  /**
   * Builds PLC_CONTROL request for block deletion.
   */
  public buildDeleteBlockRequest(blockType: number, blockNumber: number): Uint8Array {
    const piService = this.asciiBytes("_DELE");
    const blockSpec = this.asciiBytes(
      `${blockType.toString(16).toUpperCase().padStart(2, "0")}${String(blockNumber).padStart(5, "0")}P`
    );
    const params = new Uint8Array(9 + blockSpec.length + piService.length);
    let offset = 0;
    params[offset++] = S7Function.PLC_CONTROL;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = 0x00;
    params[offset++] = blockSpec.length;
    params[offset++] = piService.length;
    params[offset++] = 0x00;
    params.set(blockSpec, offset);
    offset += blockSpec.length;
    params.set(piService, offset);
    return this.buildRequestPdu(params, new Uint8Array(0));
  }

  /**
   * Parse START_UPLOAD response to extract upload handle and optional block length.
   */
  public parseStartUploadResponse(response: LegacyS7Response): { uploadId: number; blockLength: number } {
    const out = { uploadId: 0, blockLength: 0 };
    const raw = response.rawParameters ?? new Uint8Array(0);
    if (raw.length < 8) {
      return out;
    }
    out.uploadId = new DataView(raw.buffer, raw.byteOffset + 3, 4).getUint32(0, false);
    if (raw.length > 8) {
      const lenField = raw[7] ?? 0;
      if (raw.length >= 8 + lenField) {
        const ascii = this.bytesToAscii(raw.slice(8, 8 + lenField));
        const parsed = Number.parseInt(ascii, 10);
        if (Number.isFinite(parsed)) {
          out.blockLength = parsed;
        }
      }
    }
    return out;
  }

  /**
   * Parse UPLOAD response payload bytes.
   */
  public parseUploadResponse(response: LegacyS7Response): Uint8Array {
    return response.data ?? new Uint8Array(0);
  }

  /**
   * Build PLC control request.
   *
   * Supported operations:
   * - `stop`
   * - `hot_start`
   * - `cold_start`
   */
  public buildPlcControlRequest(operation: "stop" | "hot_start" | "cold_start"): Uint8Array {
    if (operation === "stop") {
      return this.buildRequestPdu(Uint8Array.of(S7Function.PLC_STOP), new Uint8Array(0));
    }
    const restartType = operation === "hot_start" ? 1 : 2;
    return this.buildRequestPdu(Uint8Array.of(S7Function.PLC_CONTROL, restartType), new Uint8Array(0));
  }

  /**
   * Build USER_DATA read-SZL request.
   */
  public buildReadSzlRequest(szlId: number, szlIndex: number): Uint8Array {
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x04, 0x11, 0x44, 0x01, 0x00);
    const dataSection = new Uint8Array(8);
    const view = new DataView(dataSection.buffer);
    dataSection[0] = 0x0a;
    dataSection[1] = 0x00;
    view.setUint16(2, 0x0004, false);
    view.setUint16(4, szlId & 0xffff, false);
    view.setUint16(6, szlIndex & 0xffff, false);
    return this.buildUserDataPdu(params, dataSection);
  }

  /**
   * Parse read-SZL response payload.
   */
  public parseReadSzlResponse(response: LegacyS7Response, firstFragment = true): ParsedReadSzl {
    const raw = response.data ?? new Uint8Array(0);
    if (firstFragment) {
      if (raw.length < 4) {
        return { szlId: 0, szlIndex: 0, data: new Uint8Array(0) };
      }
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      return {
        szlId: view.getUint16(0, false),
        szlIndex: view.getUint16(2, false),
        data: raw.slice(4)
      };
    }
    return {
      szlId: 0,
      szlIndex: 0,
      data: raw
    };
  }

  /**
   * Build USER_DATA get-clock request.
   */
  public buildGetClockRequest(): Uint8Array {
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x04, 0x11, 0x47, 0x01, 0x00);
    const dataSection = Uint8Array.of(0x0a, 0x00, 0x00, 0x00);
    return this.buildUserDataPdu(params, dataSection);
  }

  /**
   * Build USER_DATA set-clock request.
   */
  public buildSetClockRequest(value: Date): Uint8Array {
    const year = value.getFullYear() % 100;
    const bcd = Uint8Array.of(
      0x00,
      this.toBcd(year),
      this.toBcd(value.getMonth() + 1),
      this.toBcd(value.getDate()),
      this.toBcd(value.getHours()),
      this.toBcd(value.getMinutes()),
      this.toBcd(value.getSeconds()),
      (value.getDay() === 0 ? 7 : value.getDay()) & 0x0f
    );
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x04, 0x11, 0x47, 0x02, 0x00);
    const dataSection = new Uint8Array(4 + bcd.length);
    dataSection[0] = 0x0a;
    dataSection[1] = 0x00;
    new DataView(dataSection.buffer).setUint16(2, bcd.length, false);
    dataSection.set(bcd, 4);
    return this.buildUserDataPdu(params, dataSection);
  }

  /**
   * Parse PLC clock from USER_DATA response.
   */
  public parseGetClockResponse(response: LegacyS7Response): Date {
    const raw = response.data ?? new Uint8Array(0);
    if (raw.length < 8) {
      return new Date();
    }
    const year = this.fromBcd(raw[1] ?? 0);
    const month = this.fromBcd(raw[2] ?? 0);
    const day = this.fromBcd(raw[3] ?? 0);
    const hour = this.fromBcd(raw[4] ?? 0);
    const minute = this.fromBcd(raw[5] ?? 0);
    const second = this.fromBcd(raw[6] ?? 0);
    const fullYear = year < 90 ? 2000 + year : 1900 + year;
    const parsed = new Date(fullYear, month - 1, day, hour, minute, second);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  /**
   * Build a simple CPU-state request.
   */
  public buildCpuStateRequest(): Uint8Array {
    return this.buildRequestPdu(Uint8Array.of(S7Function.READ_AREA), new Uint8Array(0));
  }

  /**
   * Extract CPU state string.
   *
   * The python reference currently returns a default RUN status.
   */
  public extractCpuState(response: LegacyS7Response): string {
    void response;
    return "S7CpuStatusRun";
  }

  /**
   * Validate control-style ACK response (e.g. delete block, PLC control).
   */
  public checkControlResponse(response: LegacyS7Response): void {
    // For these flows, parser-level protocol errors are already thrown.
    // Return-code in data section, if present, should still indicate success.
    if (response.returnCode !== undefined && response.returnCode !== 0xff) {
      const code = response.returnCode.toString(16).padStart(2, "0");
      const description = getReturnCodeDescription(response.returnCode);
      throw new Error(`Control request failed: ${description} (0x${code})`);
    }
  }

  /**
   * Parses ACK/ACK_DATA/USER_DATA responses.
   */
  public parseResponse(pdu: Uint8Array): LegacyS7Response {
    if (pdu.length < 10) {
      throw new Error("PDU too short for S7 response");
    }

    const view = new DataView(pdu.buffer, pdu.byteOffset, pdu.length);
    const protocolId = view.getUint8(0);
    const pduType = view.getUint8(1) as S7PduType;
    if (protocolId !== 0x32) {
      throw new Error(`Invalid S7 protocol ID: 0x${protocolId.toString(16).padStart(2, "0")}`);
    }
    if (pduType !== S7PduType.ACK && pduType !== S7PduType.ACK_DATA && pduType !== S7PduType.USERDATA) {
      throw new Error(`Unexpected S7 response PDU type: 0x${pduType.toString(16).padStart(2, "0")}`);
    }

    const sequence = view.getUint16(4, false);
    const parameterLength = view.getUint16(6, false);
    const dataLength = view.getUint16(8, false);

    // USER_DATA responses have a 10-byte header, ACK/ACK_DATA include class/code bytes.
    let offset = 10;
    if (pduType !== S7PduType.USERDATA) {
      if (pdu.length < 12) {
        throw new Error("PDU too short for ACK/ACK_DATA response");
      }
      const errorClass = view.getUint8(10);
      const errorCode = view.getUint8(11);
      if (errorClass !== 0 || errorCode !== 0) {
        throw new Error(`S7 protocol error class=0x${errorClass.toString(16)} code=0x${errorCode.toString(16)}`);
      }
      offset = 12;
    }

    const response: LegacyS7Response = { sequence, parameterLength, dataLength };

    if (parameterLength > 0) {
      const params = pdu.slice(offset, offset + parameterLength);
      response.rawParameters = params;
      const functionCode = params[0];
      if (functionCode !== undefined) {
        response.functionCode = functionCode;
      }
      if (functionCode === S7Function.SETUP_COMMUNICATION && params.length >= 8) {
        response.parameters = {
          pduLength: new DataView(params.buffer, params.byteOffset, params.length).getUint16(6, false)
        };
      } else if (this.isUserDataResponseParameters(params)) {
        response.parameters = {
          group: (params[5] ?? 0) & 0x0f,
          subfunction: params[6] ?? 0,
          sequenceNumber: params[7] ?? 0,
          lastDataUnit: params[9] ?? 0,
          errorCode: new DataView(params.buffer, params.byteOffset + 10, 2).getUint16(0, false)
        };
      }
      offset += parameterLength;
    }

    if (dataLength > 0) {
      const section = pdu.slice(offset, offset + dataLength);
      if (section.length >= 4) {
        const returnCode = section[0];
        const transportSize = section[1] ?? 0;
        if (returnCode !== undefined) {
          response.returnCode = returnCode;
        }
        response.transportSize = transportSize;
        const declaredLength = new DataView(section.buffer, section.byteOffset + 2, 2).getUint16(0, false);
        const bytesLength = transportSize === 0x00 || transportSize === 0x09 ? declaredLength : Math.ceil(declaredLength / 8);
        response.data = section.slice(4, 4 + bytesLength);
      } else if (section.length === 1) {
        const returnCode = section[0];
        if (returnCode !== undefined) {
          response.returnCode = returnCode;
        }
        response.data = new Uint8Array(0);
      }
    }

    return response;
  }

  /**
   * Extracts read bytes and validates return code.
   */
  public extractReadBytes(response: LegacyS7Response): Uint8Array {
    if (response.returnCode !== 0xff) {
      const code = (response.returnCode ?? 0).toString(16).padStart(2, "0");
      const description = getReturnCodeDescription(response.returnCode ?? 0);
      throw new Error(`Read failed: ${description} (0x${code})`);
    }
    return response.data ?? new Uint8Array(0);
  }

  /**
   * Validates write acknowledgement.
   */
  public checkWriteResponse(response: LegacyS7Response): void {
    if (response.returnCode !== undefined && response.returnCode !== 0xff) {
      const code = (response.returnCode ?? 0).toString(16).padStart(2, "0");
      const description = getReturnCodeDescription(response.returnCode ?? 0);
      throw new Error(`Write failed: ${description} (0x${code})`);
    }
  }

  public bytesToAscii(input: Uint8Array): string {
    let out = "";
    for (const value of input) {
      if (value === 0) {
        continue;
      }
      out += String.fromCharCode(value);
    }
    return out.trim();
  }

  private buildBlockUserDataRequest(subfunction: S7BlockSubfunction, payload: Uint8Array, dataRef: number): Uint8Array {
    const params = Uint8Array.of(0x00, 0x01, 0x12, 0x04, 0x11, 0x43, subfunction, dataRef & 0xff);
    const dataSection = new Uint8Array(4 + payload.length);
    dataSection[0] = 0x0a;
    dataSection[1] = 0x00;
    new DataView(dataSection.buffer).setUint16(2, payload.length, false);
    dataSection.set(payload, 4);
    return this.buildUserDataPdu(params, dataSection);
  }

  private buildRequestPdu(parameters: Uint8Array, dataSection: Uint8Array): Uint8Array {
    const header = new Uint8Array(10);
    const view = new DataView(header.buffer);
    view.setUint8(0, 0x32);
    view.setUint8(1, S7PduType.REQUEST);
    view.setUint16(2, 0x0000, false);
    view.setUint16(4, this.nextSequence(), false);
    view.setUint16(6, parameters.length, false);
    view.setUint16(8, dataSection.length, false);
    const out = new Uint8Array(header.length + parameters.length + dataSection.length);
    out.set(header, 0);
    out.set(parameters, header.length);
    out.set(dataSection, header.length + parameters.length);
    return out;
  }

  private asciiBytes(value: string): Uint8Array {
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i) & 0xff;
    }
    return out;
  }

  private toBcd(value: number): number {
    return (((Math.floor(value / 10) & 0x0f) << 4) | (value % 10)) & 0xff;
  }

  private fromBcd(value: number): number {
    return ((value >> 4) & 0x0f) * 10 + (value & 0x0f);
  }

  private buildUserDataPdu(params: Uint8Array, dataSection: Uint8Array): Uint8Array {
    const header = new Uint8Array(10);
    const hv = new DataView(header.buffer);
    hv.setUint8(0, 0x32);
    hv.setUint8(1, S7PduType.USERDATA);
    hv.setUint16(2, 0x0000, false);
    hv.setUint16(4, this.nextSequence(), false);
    hv.setUint16(6, params.length, false);
    hv.setUint16(8, dataSection.length, false);

    const out = new Uint8Array(header.length + params.length + dataSection.length);
    out.set(header, 0);
    out.set(params, header.length);
    out.set(dataSection, header.length + params.length);
    return out;
  }

  private isUserDataResponseParameters(params: Uint8Array): boolean {
    return params.length >= 12 && params[0] === 0x00 && params[2] === 0x12 && params[4] === 0x12;
  }

  private dataTransportSize(wordLen: S7WordLen): number {
    if (wordLen === S7WordLen.COUNTER) {
      return 0x1c;
    }
    if (wordLen === S7WordLen.TIMER) {
      return 0x1d;
    }
    if (wordLen === S7WordLen.BIT) {
      return 0x03;
    }
    return 0x04;
  }

  private computeAmountFromDataLength(wordLen: S7WordLen, dataLength: number): number {
    const bytesPerElement = this.bytesPerElement(wordLen);
    if (dataLength % bytesPerElement !== 0) {
      throw new Error(`Data length ${dataLength} is not aligned for word length ${wordLen}`);
    }
    return dataLength / bytesPerElement;
  }

  private bytesPerElement(wordLen: S7WordLen): number {
    if (wordLen === S7WordLen.BIT || wordLen === S7WordLen.BYTE || wordLen === S7WordLen.CHAR) {
      return 1;
    }
    if (wordLen === S7WordLen.WORD || wordLen === S7WordLen.INT || wordLen === S7WordLen.COUNTER || wordLen === S7WordLen.TIMER) {
      return 2;
    }
    if (wordLen === S7WordLen.DWORD || wordLen === S7WordLen.DINT || wordLen === S7WordLen.REAL) {
      return 4;
    }
    return 1;
  }
}
