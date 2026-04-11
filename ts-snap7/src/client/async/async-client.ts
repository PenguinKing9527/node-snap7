import { Snap7NotImplementedError } from "../../errors/index.js";
import type { ConnectOptions, DbReadItem, ProtocolSelection } from "../../types.js";

/**
 * Unified async entrypoint for S7 communication.
 *
 * This class intentionally exposes the public shape early so downstream users
 * can integrate against stable types while protocol layers are built in stages.
 * Real connection and read/write behavior is implemented in later tasks.
 */
export class AsyncClient {
  private _protocol: ProtocolSelection;

  /**
   * Creates a client in `auto` protocol mode.
   */
  public constructor() {
    this._protocol = "auto";
  }

  /**
   * Current protocol selection for subsequent operations.
   * Note: this is selection intent at this stage, not negotiated runtime state.
   */
  public get protocol(): ProtocolSelection {
    return this._protocol;
  }

  /**
   * Connects to a PLC endpoint.
   * Placeholder until Task 6; currently stores protocol preference only.
   */
  public connect(options: ConnectOptions): Promise<void> {
    this._protocol = options.protocol ?? "auto";
    return Promise.reject(new Snap7NotImplementedError("connect() will be implemented in Task 6."));
  }

  /**
   * Disconnects from PLC and releases transport resources.
   * Placeholder until Task 6.
   */
  public disconnect(): Promise<void> {
    return Promise.reject(new Snap7NotImplementedError("disconnect() will be implemented in Task 6."));
  }

  /**
   * Reads raw bytes from a DB segment.
   * Placeholder until Task 6.
   */
  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    void dbNumber;
    void start;
    void size;
    return Promise.reject(new Snap7NotImplementedError("dbRead() will be implemented in Task 6."));
  }

  /**
   * Writes raw bytes to a DB segment.
   * Placeholder until Task 6.
   */
  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.reject(new Snap7NotImplementedError("dbWrite() will be implemented in Task 6."));
  }

  /**
   * Reads multiple DB segments in one logical operation.
   * Placeholder until Task 6.
   */
  public dbReadMulti(items: DbReadItem[]): Promise<Uint8Array[]> {
    void items;
    return Promise.reject(new Snap7NotImplementedError("dbReadMulti() will be implemented in Task 6."));
  }
}
