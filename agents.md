# Node-Snap7 Agents Workflow (Async-Only)

## 1. Goal and Scope
- Goal: build an open-source Node.js + TypeScript implementation based on `python-snap7` `s7` core.
- Initial scope: `AsyncClient` only (Promise API). No sync client.
- Protocol milestone: `Legacy S7 + S7CommPlus V1`.
- Package target: dual output `ESM + CJS`.
- Test stack: `Vitest`.

## 2. Execution Rules
- Execute tasks in strict order. No cross-task implementation.
- A task is complete only when all gates pass:
  1. Implementation complete
  2. Self review / code review complete
  3. Unit tests added and passing
  4. Task report delivered
  5. Pause for human review
- Do not start the next task until user explicitly says `continue`.

## 3. Task List (Fixed Order)
1. Task 0: governance file `agents.md` (this file)
2. Task 1: project scaffold and release baseline
3. Task 2: codec foundation (`vlq`, headers, typed values)
4. Task 3: async transport layer (TCP + TPKT + COTP)
5. Task 4: Legacy S7 async minimal path
6. Task 5: S7CommPlus V1 async minimal path
7. Task 6: unified `AsyncClient` (`AUTO/LEGACY/S7COMMPLUS`)
8. Task 7: open-source readiness (docs, contribution guide, release checks)
9. Task 8: Client scope freeze + missing-feature checklist (planning/report artifacts only, no runtime mapping code)
10. Task 9: client parameters/session controls (`set/get_param`, connection params/type, password, diagnostics)
11. Task 10: generic area I/O + robust PDU chunking (`read_area`/`write_area`, `ab/eb/mb/tm/ct`)
12. Task 11: DB extended APIs + typed DB helpers parity (`db_get`, `db_fill`, typed read/write)
13. Task 12: multi-variable operations parity (`read_multi_vars`, `write_multi_vars`)
14. Task 13: block catalog/info parity (`list_blocks`, `list_blocks_of_type`, `get_block_info`, `get_pg_block_info`)
15. Task 14: upload/download/delete parity (`upload`, `full_upload`, `download`, `delete`)
16. Task 15: PLC control + device/system info parity (clock, CPU/CP/order/protection, SZL)
17. Task 16: low-level exchange + compatibility edge-cases (`iso_exchange_buffer`, return-code/error mapping)
18. Task 17: production reliability hardening (reconnect, heartbeat, concurrency safety, observability hooks)
19. Task 18: production acceptance + release readiness (parity sign-off, stability/perf checks, docs/release evidence)

## 4. Definition of Done per Task
- Architecture: respects layer boundaries (`core`, `transport`, `s7`, `client`, `errors`).
- Types: no new TypeScript strict errors.
- Tests: task behavior covered by unit tests and tests pass.
- Docs: update API/docs/comments where required.
- Reviewability: changes stay focused on current task only.

## 4.1 Open-Source Commenting Rule
- Because this is open-source software, implementation code must include detailed comments and docstrings comparable to `python-snap7`.
- Public modules, classes, and exported functions must explain intent, protocol context, inputs/outputs, and notable edge cases.
- Complex protocol logic must include concise inline rationale comments, not only type annotations.

## 5. Code Review Standard
- Priority order: correctness > protocol fidelity > error handling > type safety > maintainability.
- Findings are reported first and sorted by severity:
  - High: protocol breakage, data corruption, unstable connection behavior
  - Medium: behavior mismatch, missing edge cases, weak error semantics
  - Low: readability, naming, structure improvements
- If no issues are found, explicitly write: `Findings: None`.

## 6. Test Standard
- Each task must include:
  - happy-path tests
  - boundary tests
  - error-path tests
- Rules:
  - do not implement or test future-task behavior early
  - prefer unit tests, use mocks/stubs for protocol and transport
  - test names must describe behavior and expected result clearly

## 7. Pause and Resume Protocol
- At end of each task, output `TASK STOP` and pause.
- During pause, only address user review feedback or requested revisions.
- Start next task only after user explicitly says `continue` (or equivalent).

## 8. Task Report Template (Fixed)
```md
## Task N Report
- Scope:
- Implementation Summary:
- Files Changed:

### Code Review Findings
- High:
- Medium:
- Low:

### Tests
- Added/Updated:
- Commands Run:
- Result:

### Risks / Notes
- 

TASK STOP: Waiting for human review + commit.
```

## 9. Drift Control
- If request and plan conflict, stop on current task and report conflict before expanding scope.
- If unrelated dirty changes exist, do not revert or overwrite them; ask user how to proceed.
- If information is insufficient for safe progress, proceed with minimal-risk assumptions and record them in task report.

## 10. Stage 2 Scope Guard (Client-Only)
- Stage 2 objective: parity with `python-snap7` `Client` + `ClientMixin` functionality at production-grade quality.
- Stage 2 explicitly excludes: `Server`, `Partner`, `Discovery`, and unrelated CLI/logo modules.
- Keep `AsyncClient` as primary public entrypoint in this repository; provide compatibility aliases only when planned by the current task.
- Do not pull Stage 3+ features into Stage 2 tasks.
- Include S7CommPlus client parity items used by unified client, including TLS connect options (`use_tls`, `tls_cert`, `tls_key`, `tls_ca`), session setup completeness checks, and legitimation/auth flows where exposed by python reference.
