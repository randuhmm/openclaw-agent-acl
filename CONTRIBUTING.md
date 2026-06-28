# Contributing

## Prerequisites

- Node.js `>=22.19`
- npm

## Setup

```bash
git clone https://github.com/randuhmm/openclaw-agent-acl.git
cd openclaw-agent-acl
npm install
```

## Running tests

```bash
npm test               # run all tests once
npm run test:watch     # rerun on file changes
npm run test:coverage  # run tests + print coverage summary
npm run typecheck      # type-check all TypeScript files
```

All 26 tests must pass before submitting a PR. Coverage should not decrease.

## Building

```bash
npm run plugin:build   # compiles index.ts → dist/index.js and validates the manifest
```

The `dist/` directory is committed to the repo so that `git:`-based installs work without a separate build step. Always commit updated `dist/index.js` alongside source changes.

## Adding a test

Tests live in `index.test.ts`. The suite mocks `node:fs` and `openclaw/plugin-sdk/plugin-entry` at the top of the file — individual tests prime `readFileSync` with `vi.mocked(readFileSync).mockReturnValue(...)` or `.mockImplementation(...)`.

To test the `before_tool_call` handler, call `plugin.register(mockApi)` using `makeMockApi()`, then retrieve the captured handler via `getHandler()` and invoke it directly:

```typescript
const { api, getHandler } = makeMockApi();
plugin.register(api);
const result = await getHandler()({ toolName: 'my-server__tool' }, { agentId: 'agent1' });
expect(result).toEqual({ block: false });
```

See `ARCHITECTURE.md` for design context and `CLAUDE.md` for a quick reference on how the mocking works.

## PR checklist

- [ ] `npm test` passes (all 26 tests green)
- [ ] `npm run plugin:build` passes
- [ ] `npm run typecheck` passes
- [ ] `dist/index.js` updated if `index.ts` changed
- [ ] New behavior covered by at least one test

## Commit style

Conventional commits preferred:

```
feat: add hot-reload support for acl.json changes
fix: handle null servers value in schema validation
docs: add CONTRIBUTING.md
test: cover wildcard agent ID matching
```

For security fixes, use `fix(security):` as the prefix.
