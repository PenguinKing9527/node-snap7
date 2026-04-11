export interface TransportStatus {
  ready: boolean;
  note: string;
}

export const transportStatus: TransportStatus = {
  ready: false,
  note: "Async TCP/TPKT/COTP transport will be implemented in Task 3."
};
