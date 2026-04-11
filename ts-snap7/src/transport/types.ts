import type { EventEmitter } from "node:events";

/**
 * Transport connection state.
 */
export type TransportState = "idle" | "connecting" | "connected" | "closed";

/**
 * Options used when opening ISO-on-TCP transport.
 */
export interface TransportConnectOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  localTsap?: number;
  remoteTsap?: number | Uint8Array;
}

/**
 * Request/receive options for transport-level packet exchange.
 */
export interface TransportRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Minimal socket contract required by the transport layer.
 *
 * A real `net.Socket` can satisfy this interface directly, and tests can
 * provide a mock implementation.
 */
export interface SocketLike extends EventEmitter {
  connect(port: number, host: string): void;
  write(data: Uint8Array | Buffer): boolean;
  end(): void;
  destroy(error?: Error): void;
  setNoDelay(noDelay?: boolean): this;
}

/**
 * Factory for creating sockets on demand.
 */
export type SocketFactory = () => SocketLike;
