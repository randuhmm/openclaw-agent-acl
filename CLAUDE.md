# CLAUDE.md — openclaw-agent-acl

## What this is

A single-file OpenClaw plugin (`index.ts`, ~60 lines) that enforces per-agent MCP server access control. It intercepts every `before_tool_call` event, looks up the calling server in `acl.json`, and blocks or allows based on an agent allowlist. Default-open: servers not listed in `acl.json` are unrestricted.

## Key commands

```bash
npm install            # install dev deps
npm test               # run all 26 Vitest tests
npm run test:coverage  # run tests + generate coverage/lcov.info
npm run typecheck      # tsc --noEmit (covers index.ts + index.test.ts)
npm run build          # compile index.ts → dist/index.js
npm run plugin:build   # build + validate plugin manifest
```

## Architecture

Two testable units in `index.ts`:

**`loadAcl(aclPath)`** — reads and validates `acl.json` at startup via `readFileSync`. Throws with descriptive messages on missing file, invalid JSON, or wrong schema. Called once inside `register()`.

**`before_tool_call` handler** — registered via `api.on()`. Splits the tool name on `__` to extract the server name (e.g. `calendar-mcp__list_events` → `calendar-mcp`), looks it up in the loaded ACL, and returns `{ block: false }` or `{ block: true, blockReason }`.

```
tool call arrives
  → extract serverName = toolName.split('__')[0]
  → look up acl.servers[serverName]
      → no rule  → { block: false }   ← default-open
      → rule found → check allowAgents.includes(agentId ?? 'main')
          → yes  → { block: false }
          → no   → { block: true, blockReason } + log
```

## How tests work

`index.test.ts` mocks two modules before import (Vitest hoists `vi.mock`):
- `node:fs` — `readFileSync` is a `vi.fn()`, primed per-test with `mockReturnValue`
- `openclaw/plugin-sdk/plugin-entry` — `definePluginEntry` is a pass-through so the default export is the raw `{ id, name, description, register }` object

The `before_tool_call` handler is captured by spying on `api.on()` during `plugin.register(mockApi)`, then invoked directly: `await handler({ toolName }, { agentId })`.

## Key invariants

- **Default-open**: a server absent from `acl.json` is never blocked
- **Agent ID fallback**: `ctx.agentId ?? 'main'` — missing agentId is treated as `"main"`
- **Case-sensitive**: agent IDs and server names must match exactly
- **Server name**: always the first `__`-delimited segment of the tool name
- **Single load**: `acl.json` is read once at `register()` time; rule changes require gateway restart (v1.1 adds hot-reload)
- **`dist/index.js` is committed**: required for `git:`-based installs without a build step

## Important files

| File | Purpose |
|---|---|
| `index.ts` | Entire plugin implementation |
| `index.test.ts` | Full test suite (26 tests) |
| `vitest.config.ts` | Test + coverage config |
| `openclaw.plugin.json` | Plugin manifest; declares `trustedToolPolicies` contract |
| `acl.json.example` | Sample config to copy |
| `dist/index.js` | Committed compiled output |
| `ARCHITECTURE.md` | Design decisions, limitations, roadmap |

## Planned but not yet implemented

Do not implement these without a corresponding issue/PR — they have schema implications:

- **v1.1** Hot-reload via `fs.watch` on `aclPath`
- **v1.2** Per-tool granularity (`acl.servers[s].tools[t].allowAgents`)
- **v1.3** Denylist mode (`denyAgents` alternative to `allowAgents`)
- **v1.4** Wildcard agent IDs (`"jonny-*"`)
