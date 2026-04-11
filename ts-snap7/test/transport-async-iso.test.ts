import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { Snap7ConnectionError, Snap7ProtocolError } from "../src/errors/index.js";
import {
  AsyncIsoTransport,
  decodeCotpConnectionConfirm,
  decodeTpktHeader,
  encodeCotpConnectionRequest,
  encodeTpkt
} from "../src/transport/index.js";
import type { SocketLike } from "../src/transport/types.js";

class MockSocket extends EventEmitter implements SocketLike {
  public writes: Uint8Array[] = [];
  public ended = false;
  public destroyed = false;

  private readonly onWrite: ((data: Uint8Array, writeIndex: number, socket: MockSocket) => void) | undefined;

  public constructor(onWrite?: (data: Uint8Array, writeIndex: number, socket: MockSocket) => void) {
    super();
    this.onWrite = onWrite;
  }

  public connect(_port: number, _host: string): void {
    void _port;
    void _host;
    setImmediate(() => this.emit("connect"));
  }

  public write(data: Uint8Array | Buffer): boolean {
    const normalized = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.writes.push(normalized);
    this.onWrite?.(normalized, this.writes.length, this);
    return true;
  }

  public end(): void {
    this.ended = true;
  }

  public destroy(_error?: Error): void {
    void _error;
    this.destroyed = true;
    setImmediate(() => this.emit("close"));
  }

  public setNoDelay(_noDelay?: boolean): this {
    void _noDelay;
    return this;
  }
}

const buildCotpCcPayload = (): Uint8Array =>
  Uint8Array.of(
    0x06, // length
    0xd0, // CC
    0x00,
    0x01, // dst ref
    0x00,
    0x00, // src ref
    0x00 // class
  );

describe("transport helpers", () => {
  it("encodes TPKT and decodes header", () => {
    const frame = encodeTpkt(Uint8Array.of(1, 2, 3));
    const [version, length] = decodeTpktHeader(frame);
    expect(version).toBe(3);
    expect(length).toBe(7);
  });

  it("builds CR and parses CC", () => {
    const cr = encodeCotpConnectionRequest(0x0100, 0x0102);
    expect(cr[1]).toBe(0xe0);

    const cc = decodeCotpConnectionConfirm(buildCotpCcPayload());
    expect(cc.destinationReference).toBe(1);
  });
});

describe("AsyncIsoTransport", () => {
  it("connects with COTP handshake and serves request/response", async () => {
    const socket = new MockSocket((data, writeIndex, s) => {
      const payload = data.slice(4); // remove TPKT
      if (writeIndex === 1) {
        // First write is CR. Respond with CC.
        expect(payload[1]).toBe(0xe0);
        setImmediate(() => s.emit("data", encodeTpkt(buildCotpCcPayload())));
      } else if (writeIndex === 2) {
        // Second write is request payload.
        const requestPayload = payload;
        expect(Array.from(requestPayload)).toEqual([0xaa, 0xbb]);
        setImmediate(() => s.emit("data", encodeTpkt(Uint8Array.of(0xde, 0xad))));
      }
    });

    const transport = new AsyncIsoTransport(() => socket);
    await transport.connect({ host: "127.0.0.1", port: 102, timeoutMs: 200 });
    expect(transport.state).toBe("connected");

    const response = await transport.request(Uint8Array.of(0xaa, 0xbb), { timeoutMs: 200 });
    expect(Array.from(response)).toEqual([0xde, 0xad]);
  });

  it("maps connect timeout to Snap7ConnectionError", async () => {
    const neverConnectSocket = new (class extends MockSocket {
      public override connect(): void {
        // Intentionally do nothing.
      }
    })();

    const transport = new AsyncIsoTransport(() => neverConnectSocket);
    await expect(transport.connect({ host: "127.0.0.1", port: 102, timeoutMs: 20 })).rejects.toBeInstanceOf(
      Snap7ConnectionError
    );
  });

  it("maps invalid TPKT version during handshake to Snap7ProtocolError", async () => {
    const socket = new MockSocket((_, writeIndex, s) => {
      if (writeIndex === 1) {
        // Invalid version (0x02 instead of 0x03), length=11.
        setImmediate(() => s.emit("data", Uint8Array.of(0x02, 0x00, 0x00, 0x0b, 0, 0, 0, 0, 0, 0, 0)));
      }
    });

    const transport = new AsyncIsoTransport(() => socket);
    await expect(transport.connect({ host: "127.0.0.1", port: 102, timeoutMs: 100 })).rejects.toBeInstanceOf(
      Snap7ProtocolError
    );
  });

  it("supports request abort via AbortSignal", async () => {
    const socket = new MockSocket((_, writeIndex, s) => {
      if (writeIndex === 1) {
        setImmediate(() => s.emit("data", encodeTpkt(buildCotpCcPayload())));
      }
    });

    const transport = new AsyncIsoTransport(() => socket);
    await transport.connect({ host: "127.0.0.1", port: 102, timeoutMs: 100 });

    const controller = new AbortController();
    const promise = transport.request(Uint8Array.of(1, 2, 3), { timeoutMs: 500, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(Snap7ConnectionError);
  });

  it("rejects request when disconnected", async () => {
    const transport = new AsyncIsoTransport(() => new MockSocket());
    await expect(transport.request(Uint8Array.of(1), { timeoutMs: 10 })).rejects.toBeInstanceOf(Snap7ConnectionError);
  });
});
