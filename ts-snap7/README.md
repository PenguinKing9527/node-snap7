# @node-snap7/core

Async-first TypeScript implementation of Siemens S7 communication protocols, aligned with staged parity goals from `python-snap7`.

## Status

Current completed milestone:
- Async-only client model (no sync client)
- Legacy S7 + S7CommPlus V1 unified async client
- Unified `AsyncClient` with `auto` / `legacy` / `s7commplus` selection
- Client parity coverage for Stage 2 scope:
  - connection/session params and diagnostics
  - generic area I/O (`read_area` / `write_area` + `ab/eb/mb/tm/ct`)
  - DB extended helpers and typed DB read/write helpers
  - multi-variable operations (`read_multi_vars` / `write_multi_vars`)
  - block catalog/info, upload/download/delete
  - PLC control/device info/SZL
  - `iso_exchange_buffer` and compatibility error text mapping
  - production reliability hooks (auto reconnect, heartbeat, op queue, observability)
- Dual build output (`ESM` + `CJS`)
- Strict TypeScript + Vitest + CI verification workflow

Stage 2 scope guard (intentional exclusions):
- Synchronous client API
- `Server` / `Partner` / discovery modules
- Unplanned Stage 3+ expansion

## Install

```bash
pnpm add @node-snap7/core
```

## Quick Start

```ts
import { AsyncClient } from "@node-snap7/core";

const client = new AsyncClient();

await client.connect({
  address: "192.168.0.10",
  rack: 0,
  slot: 1,
  protocol: "auto" // auto | legacy | s7commplus
});

const data = await client.dbRead(1, 0, 8);
await client.dbWrite(1, 8, new Uint8Array([1, 2, 3]));

await client.disconnect();
```

## API Surface

- `new AsyncClient()`
- `connect(options: ConnectOptions): Promise<void>`
- `disconnect(): Promise<void>`
- `setConnectionParams` / `setConnectionType` / `setParam` / `getParam`
- `getExecTime` / `getLastError` / `errorText` / `getPduLength`
- `dbRead(dbNumber, start, size): Promise<Uint8Array>`
- `dbWrite(dbNumber, start, data): Promise<void>`
- `dbReadMulti(items): Promise<Uint8Array[]>`
- `readArea` / `writeArea` and `ab|eb|mb|tm|ct` helpers
- typed DB helpers (`dbReadInt`, `dbWriteReal`, `dbReadString`, ...)
- `readMultiVars` / `writeMultiVars`
- block and transfer operations (`listBlocks`, `getBlockInfo`, `upload`, `download`, ...)
- PLC/system information and control (`plcStop`, `getCpuInfo`, `readSzl`, ...)
- low-level exchange (`isoExchangeBuffer`)

For a stage acceptance summary and verification evidence, see `docs/STAGE2_CLIENT_ACCEPTANCE.md`.

## Development

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify
```

## Open Source Workflow

- Contribution guide: `CONTRIBUTING.md`
- Release checklist: `RELEASING.md`
- Stage 2 acceptance evidence: `docs/STAGE2_CLIENT_ACCEPTANCE.md`
- License: `LICENSE`

## Notes

This library is developed task-by-task with strict scope boundaries. Protocol and transport behavior should only be expanded in the corresponding planned task.
