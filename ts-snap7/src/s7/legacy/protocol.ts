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

export interface LegacyS7Response {
  sequence: number;
  parameterLength: number;
  dataLength: number;
  functionCode?: number;
  returnCode?: number;
  transportSize?: number;
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
      throw new Error(`Read failed with return code 0x${(response.returnCode ?? 0).toString(16).padStart(2, "0")}`);
    }
    return response.data ?? new Uint8Array(0);
  }

  /**
   * Validates write acknowledgement.
   */
  public checkWriteResponse(response: LegacyS7Response): void {
    if (response.returnCode !== undefined && response.returnCode !== 0xff) {
      throw new Error(`Write failed with return code 0x${(response.returnCode ?? 0).toString(16).padStart(2, "0")}`);
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
