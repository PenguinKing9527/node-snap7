/**
 * Readiness marker for transport layer implementation.
 */
export interface TransportStatus {
  ready: boolean;
  note: string;
}

/**
 * Transport layer status, updated when Task 3 is completed.
 */
export const transportStatus: TransportStatus = {
  ready: true,
  note: "Async TCP/TPKT/COTP transport is implemented in Task 3."
};

export { AsyncIsoTransport } from "./async-iso-transport.js";
export { COTP_CC, COTP_CR, decodeCotpConnectionConfirm, encodeCotpConnectionRequest } from "./cotp.js";
export { decodeTpktHeader, encodeTpkt, TPKT_VERSION } from "./tpkt.js";
export type {
  SocketFactory,
  SocketLike,
  TransportConnectOptions,
  TransportRequestOptions,
  TransportState,
  TransportTlsOptions
} from "./types.js";
