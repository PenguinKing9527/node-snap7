export type ProtocolSelection = "auto" | "legacy" | "s7commplus";

export interface ConnectOptions {
  address: string;
  rack?: number;
  slot?: number;
  tcpPort?: number;
  protocol?: ProtocolSelection;
}

export interface DbReadItem {
  dbNumber: number;
  start: number;
  size: number;
}
