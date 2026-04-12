/**
 * Minimal Legacy S7 protocol implementation for async DB read/write.
 *
 * Scope of this module:
 * - setup communication request/response
 * - single-item DB read request + data extraction
 * - single-item DB write request + write acknowledgement checks
 *
 * The implementation intentionally follows python-snap7 packet layout.
 */

export enum S7PduType {
  REQUEST = 0x01,
  ACK = 0x02,
  ACK_DATA = 0x03
}

export enum S7Function {
  READ_AREA = 0x04,
  WRITE_AREA = 0x05,
  SETUP_COMMUNICATION = 0xf0
}

export enum S7Area {
  DB = 0x84
}

export enum S7WordLen {
  BYTE = 0x02
}

export interface LegacyS7Response {
  sequence: number;
  parameterLength: number;
  dataLength: number;
  functionCode?: number;
  returnCode?: number;
  data?: Uint8Array;
  parameters?: {
    pduLength?: number;
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
    pv.setUint8(5, S7WordLen.BYTE);
    pv.setUint16(6, size, false);
    pv.setUint16(8, dbNumber, false);
    pv.setUint8(10, S7Area.DB);
    // Address for non-bit types is byte offset * 8 (3-byte big-endian value).
    const address = start * 8;
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
    pv.setUint8(5, S7WordLen.BYTE);
    pv.setUint16(6, data.length, false);
    pv.setUint16(8, dbNumber, false);
    pv.setUint8(10, S7Area.DB);
    const address = start * 8;
    pv.setUint8(11, (address >> 16) & 0xff);
    pv.setUint8(12, (address >> 8) & 0xff);
    pv.setUint8(13, address & 0xff);

    const dataSection = new Uint8Array(4 + data.length);
    const dv = new DataView(dataSection.buffer);
    dv.setUint8(0, 0x00);
    dv.setUint8(1, 0x04); // byte transport size in S7 data section
    dv.setUint16(2, data.length * 8, false);
    dataSection.set(data, 4);

    const out = new Uint8Array(header.length + params.length + dataSection.length);
    out.set(header, 0);
    out.set(params, header.length);
    out.set(dataSection, header.length + params.length);
    return out;
  }

  /**
   * Parses ACK/ACK_DATA response.
   */
  public parseResponse(pdu: Uint8Array): LegacyS7Response {
    if (pdu.length < 12) {
      throw new Error("PDU too short for S7 response");
    }

    const view = new DataView(pdu.buffer, pdu.byteOffset, pdu.length);
    const protocolId = view.getUint8(0);
    const pduType = view.getUint8(1) as S7PduType;
    if (protocolId !== 0x32) {
      throw new Error(`Invalid S7 protocol ID: 0x${protocolId.toString(16).padStart(2, "0")}`);
    }
    if (pduType !== S7PduType.ACK && pduType !== S7PduType.ACK_DATA) {
      throw new Error(`Unexpected S7 response PDU type: 0x${pduType.toString(16).padStart(2, "0")}`);
    }

    const sequence = view.getUint16(4, false);
    const parameterLength = view.getUint16(6, false);
    const dataLength = view.getUint16(8, false);
    const errorClass = view.getUint8(10);
    const errorCode = view.getUint8(11);
    if (errorClass !== 0 || errorCode !== 0) {
      throw new Error(`S7 protocol error class=0x${errorClass.toString(16)} code=0x${errorCode.toString(16)}`);
    }

    const response: LegacyS7Response = { sequence, parameterLength, dataLength };
    let offset = 12;

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
      }
      offset += parameterLength;
    }

    if (dataLength > 0) {
      const section = pdu.slice(offset, offset + dataLength);
      if (section.length >= 4) {
        const returnCode = section[0];
        if (returnCode !== undefined) {
          response.returnCode = returnCode;
        }
        const bitLength = new DataView(section.buffer, section.byteOffset, section.length).getUint16(2, false);
        const bytesLength = Math.ceil(bitLength / 8);
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
      throw new Error(
        `Write failed with return code 0x${(response.returnCode ?? 0).toString(16).padStart(2, "0")}`
      );
    }
  }
}
