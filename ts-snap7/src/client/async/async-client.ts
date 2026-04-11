import { Snap7NotImplementedError } from "../../errors/index.js";
import type { ConnectOptions, DbReadItem, ProtocolSelection } from "../../types.js";

export class AsyncClient {
  private _protocol: ProtocolSelection;

  public constructor() {
    this._protocol = "auto";
  }

  public get protocol(): ProtocolSelection {
    return this._protocol;
  }

  public connect(options: ConnectOptions): Promise<void> {
    this._protocol = options.protocol ?? "auto";
    return Promise.reject(new Snap7NotImplementedError("connect() will be implemented in Task 6."));
  }

  public disconnect(): Promise<void> {
    return Promise.reject(new Snap7NotImplementedError("disconnect() will be implemented in Task 6."));
  }

  public dbRead(dbNumber: number, start: number, size: number): Promise<Uint8Array> {
    void dbNumber;
    void start;
    void size;
    return Promise.reject(new Snap7NotImplementedError("dbRead() will be implemented in Task 6."));
  }

  public dbWrite(dbNumber: number, start: number, data: Uint8Array): Promise<void> {
    void dbNumber;
    void start;
    void data;
    return Promise.reject(new Snap7NotImplementedError("dbWrite() will be implemented in Task 6."));
  }

  public dbReadMulti(items: DbReadItem[]): Promise<Uint8Array[]> {
    void items;
    return Promise.reject(new Snap7NotImplementedError("dbReadMulti() will be implemented in Task 6."));
  }
}
