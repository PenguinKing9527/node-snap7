# @node-snap7/core

Async-first TypeScript implementation of Siemens S7 communication protocols, aligned with staged parity goals from `python-snap7`.

## Status

Current implemented milestone:
- Async-only client model (no sync client)
- Legacy S7 minimal async DB read/write path
- S7CommPlus V1 minimal async DB read/write path
- Unified `AsyncClient` with `auto` / `legacy` / `s7commplus` selection
- Dual build output (`ESM` + `CJS`)
- Strict TypeScript + Vitest + CI verification workflow

Out of scope for current milestone:
- Synchronous client API
- Advanced protocol features beyond minimal DB read/write paths

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
- `dbRead(dbNumber, start, size): Promise<Uint8Array>`
- `dbWrite(dbNumber, start, data): Promise<void>`
- `dbReadMulti(items): Promise<Uint8Array[]>`

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
- License: `LICENSE`

## Notes

This library is developed task-by-task with strict scope boundaries. Protocol and transport behavior should only be expanded in the corresponding planned task.
