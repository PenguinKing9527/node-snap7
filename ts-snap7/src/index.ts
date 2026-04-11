export { AsyncClient } from "./client/async/async-client.js";
export type { ConnectOptions, DbReadItem, ProtocolSelection } from "./types.js";

export {
  Snap7ConnectionError,
  Snap7Error,
  Snap7NotImplementedError,
  Snap7ProtocolError
} from "./errors/index.js";

export { codecModuleStatus } from "./core/index.js";
export { transportStatus } from "./transport/index.js";
export { legacyS7Status } from "./s7/legacy/index.js";
export { s7CommPlusStatus } from "./s7/plus/index.js";
