# Releasing @node-snap7/core

This document defines the release checklist for open-source publication.

## Preconditions

- All task gates passed for the milestone.
- Human review completed.
- Branch is up to date with target base.
- Stage acceptance report exists for current milestone (for Stage 2: `docs/STAGE2_CLIENT_ACCEPTANCE.md`).

## 1. Version Bump

Update package version in `package.json` according to semver.

## 2. Verify Quality

```bash
pnpm run verify
pnpm run release:check
```

`release:check` performs:
- full verify pipeline
- package dry-run to validate publish contents

## 3. Inspect Package Contents

Confirm the package includes:
- `dist/**`
- `README.md`
- `LICENSE`
- `*.d.ts` types

## 4. Create Release Notes

Summarize:
- user-visible API changes
- protocol behavior changes
- bug fixes
- known limitations

## 5. Publish

Example:

```bash
npm publish --access public
```

Use your organization's preferred release flow if it differs.

## 6. Post-Release Checks

- Verify package appears on npm.
- Validate install and import from a clean sample project.
- Tag and announce release notes.

## Stage 2 Acceptance Evidence (Client Scope)

Before Stage 2 release sign-off, confirm the acceptance report includes:
- parity summary for client-only scope versus `python-snap7`
- test and release-check evidence (`pnpm run release:check`)
- known risks and explicit out-of-scope notes
