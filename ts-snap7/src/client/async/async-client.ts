import { Snap7ConnectionError } from "../../errors/index.js";
import { LegacyS7AsyncClient } from "../../s7/legacy/index.js";
import { S7CommPlusAsyncClient } from "../../s7/plus/index.js";
import type { ConnectOptions, DbReadItem, ProtocolSelection } from "../../types.js";

type ActiveProtocol = Exclude<ProtocolSelection, "auto">;

/**
 * Minimal legacy-client contract required by the unified client.
 */
export interface LegacyClientLike {
  connect(options: { address: string; rack?: number; slot?: number; tcpPort?: number }): Promise<void>;
  disconnect(): Promise<void>;
  dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array>;
  dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void>;
}

/**
 * Minimal S7CommPlus-client contract required by the unified client.
 */
export interface S7CommPlusClientLike {
  connect(options: { host: string; port?: number }): Promise<void>;
  disconnect(): void;
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
  private preferredProtocol: ProtocolSelection;
  private activeProtocol: ActiveProtocol | null;
  private readonly createLegacyClient: () => LegacyClientLike;
  private readonly createS7CommPlusClient: () => S7CommPlusClientLike;
  private legacyClient: LegacyClientLike | null;
  private s7CommPlusClient: S7CommPlusClientLike | null;

  /**
   * Creates a client in `auto` protocol mode by default.
   * Optional dependency hooks are primarily intended for unit tests.
   */
  public constructor(dependencies: AsyncClientDependencies = {}) {
    this.preferredProtocol = "auto";
    this.activeProtocol = null;
    this.createLegacyClient = dependencies.createLegacyClient ?? (() => new LegacyS7AsyncClient());
    this.createS7CommPlusClient = dependencies.createS7CommPlusClient ?? (() => new S7CommPlusAsyncClient());
    this.legacyClient = null;
    this.s7CommPlusClient = null;
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
   * Connects to a PLC endpoint.
   */
  public async connect(options: ConnectOptions): Promise<void> {
    this.preferredProtocol = options.protocol ?? "auto";
    await this.disconnect();

    if (this.preferredProtocol === "legacy") {
      await this.connectLegacy(options);
      return;
    }

    if (this.preferredProtocol === "s7commplus") {
      await this.connectS7CommPlus(options);
      return;
    }

    await this.connectAuto(options);
  }

  /**
   * Disconnects from PLC and releases transport resources.
   */
  public async disconnect(): Promise<void> {
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
      throw new Snap7ConnectionError(
        disconnectError instanceof Error ? disconnectError.message : "Failed to disconnect unified AsyncClient"
      );
    }
  }

  /**
   * Reads raw bytes from a DB segment.
   */
  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    if (this.activeProtocol === "s7commplus") {
      return this.requireS7CommPlusClient().dbRead(dbNumber, start, size);
    }

    if (this.activeProtocol === "legacy") {
      return this.requireLegacyClient().dbRead(dbNumber, start, size);
    }

    return Promise.reject(new Snap7ConnectionError("AsyncClient is not connected"));
  }

  /**
   * Writes raw bytes to a DB segment.
   */
  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    if (this.activeProtocol === "s7commplus") {
      return this.requireS7CommPlusClient().dbWrite(dbNumber, start, data);
    }

    if (this.activeProtocol === "legacy") {
      return this.requireLegacyClient().dbWrite(dbNumber, start, data);
    }

    return Promise.reject(new Snap7ConnectionError("AsyncClient is not connected"));
  }

  /**
   * Reads multiple DB segments in one logical operation.
   */
  public async dbReadMulti(items: DbReadItem[]): Promise<Uint8Array[]> {
    if (this.activeProtocol === "s7commplus") {
      return this.requireS7CommPlusClient().dbReadMulti(
        items.map((item) => [item.dbNumber, item.start, item.size] as const)
      );
    }

    if (this.activeProtocol === "legacy") {
      const legacyClient = this.requireLegacyClient();
      const out: Uint8Array[] = [];
      for (const item of items) {
        out.push(await legacyClient.dbRead(item.dbNumber, item.start, item.size));
      }
      return out;
    }

    return Promise.reject(new Snap7ConnectionError("AsyncClient is not connected"));
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
    const connectOptions: { host: string; port?: number } = { host: options.address };
    if (options.tcpPort !== undefined) {
      connectOptions.port = options.tcpPort;
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

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
