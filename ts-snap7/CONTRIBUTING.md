# Contributing to @node-snap7/core

Thanks for contributing.

## Ground Rules

- Keep changes scoped to the active task/milestone.
- Preserve layer boundaries: `core`, `transport`, `s7`, `client`, `errors`.
- Favor correctness and protocol fidelity over feature breadth.
- Do not mix unrelated refactors into protocol behavior changes.

## Local Setup

```bash
pnpm install
```

## Quality Gates

Run before opening a pull request:

```bash
pnpm run verify
```

This command runs:
- lint
- typecheck (strict TypeScript)
- unit tests with coverage
- build (ESM + CJS)

## Testing Expectations

Each behavior change should include:
- happy-path tests
- boundary tests
- error-path tests

Test names should describe behavior and expected outcome clearly.

## Pull Request Guidelines

- Include a concise summary of protocol or API behavior changes.
- List touched files and rationale for non-obvious logic.
- Mention risk areas and any intentionally deferred work.
- Keep commits focused and reviewable.

## Review Priorities

1. Correctness
2. Protocol fidelity
3. Error handling
4. Type safety
5. Maintainability

## Reporting Issues

When filing a bug, include:
- protocol mode (`auto`, `legacy`, or `s7commplus`)
- PLC model (if known)
- minimal reproduction code
- expected vs actual behavior
- library version and Node.js version
