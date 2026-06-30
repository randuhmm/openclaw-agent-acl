# CLAUDE.md — openclaw-agent-acl

## What this is

An OpenClaw plugin that enforces per-agent MCP server access control. It intercepts every `before_tool_call` event, looks up the calling server in `acl.json`, and blocks or allows based on an agent allowlist. Default-open: servers not listed in `acl.json` are unrestricted.

The plugin is split across three TypeScript source files so the security-critical hook stays auditable in isolation from the new HTTP admin surface. This is an intentional departure from the original single-file convention.

## Key commands

```bash
npm install            # install dev deps
npm test               # run all 71 Vitest tests
npm run test:coverage  # run tests + generate coverage/lcov.info
npm run typecheck      # tsc --noEmit (covers all source + test files)
npm run build          # compile → dist/index.js + dist/agent-acl-ui/
npm run plugin:build   # build + validate plugin manifest
```

## Architecture

Three source files:

### `acl-store.ts`

**`loadAcl(aclPath)`** — reads and validates `acl.json` at startup via `readFileSync`. Throws with descriptive messages on missing file, invalid JSON, or wrong schema. Called once in `register()`.

**`validateAclWrite(value)`** — stricter, schema-locked validation for the HTTP write path. Rejects unknown top-level keys and unknown per-server keys (e.g. `denyAgents`, `tools`) so the UI can never silently accept fields that belong to a future, unimplemented schema version (v1.2–v1.4).

**`writeAclAtomic(aclPath, config)`** — writes to a temp file in the same directory, then renames over the target. Readers never see a partial write.

**`AclStore`** — holds the in-memory ACL (`get()` / `update()`). Shared between the `before_tool_call` hook and the HTTP write handler, so UI saves take effect immediately without a gateway restart.

### `index.ts`

Thin orchestration layer. Builds the `AclStore`, registers the `before_tool_call` hook, and conditionally calls `registerHttpUi` based on the `uiEnabled` config (default: true).

```
tool call arrives
  → extract serverName = toolName.split('__')[0]
  → look up store.get().servers[serverName]
      → no rule  → { block: false }   ← default-open
      → rule found → check allowAgents.includes(agentId ?? 'main')
          → yes  → { block: false }
          → no   → { block: true, blockReason } + log
```

### `http-ui.ts`

**`registerHttpUi(api, store, aclPath, uiPath?)`** — registers a single prefix-matched HTTP route at `uiPath` (default `/agent-acl-ui/`). Dispatches:

- `GET /api/state` — returns view-model: `{ servers, knownMcpServers, knownAgentIds, aclPath }`
- `PUT /api/acl` — validates body with `validateAclWrite`, calls `writeAclAtomic`, then `store.update()` to keep the hook's in-memory view in sync
- Static file serving for `index.html`, `app.js`, `style.css` with path-traversal guard

Route auth: `"gateway"` + `gatewayRuntimeScopeSurface: "trusted-operator"` — same tier as the bundled `admin-http-rpc` extension.

## How tests work

All three test files use the same Vitest mocking pattern (module mocks hoisted):
- `node:fs` — `readFileSync`, `writeFileSync`, `renameSync`, `unlinkSync` are `vi.fn()`
- `openclaw/plugin-sdk/plugin-entry` — `definePluginEntry` is a pass-through (index.test.ts only)
- `node:url` — `fileURLToPath` returns a fixed path (http-ui.test.ts only, for stable static dir)

The `before_tool_call` handler is captured from `api.on()` spy calls; the HTTP handler is captured from `api.registerHttpRoute()` spy calls. Both are invoked directly in tests.

## Key invariants

- **Default-open**: a server absent from `acl.json` is never blocked
- **Agent ID fallback**: `ctx.agentId ?? 'main'` — missing agentId is treated as `"main"`
- **Case-sensitive**: agent IDs and server names must match exactly
- **Server name**: always the first `__`-delimited segment of the tool name
- **Single load**: `acl.json` is read once at `register()` time; external edits (not through the UI) require gateway restart (v1.1 adds hot-reload)
- **UI writes are in-memory**: `store.update()` after each successful `PUT /api/acl` means the hook reflects UI changes immediately — this is NOT the same as v1.1 hot-reload (which watches for external file edits)
- **`dist/index.js` and `dist/agent-acl-ui/` are committed**: required for `git:`-based installs without a build step

## Important files

| File | Purpose |
|---|---|
| `index.ts` | Plugin orchestration: AclStore setup, before_tool_call hook, registerHttpUi call |
| `acl-store.ts` | AclConfig type, loadAcl, validateAclWrite, writeAclAtomic, AclStore class |
| `http-ui.ts` | HTTP route handler: GET /api/state, PUT /api/acl, static serving |
| `ui/agent-acl-ui/` | Static assets (index.html, app.js, style.css) for the Web UI |
| `index.test.ts` | Plugin integration tests (26 tests) |
| `acl-store.test.ts` | Unit tests for loadAcl, validateAclWrite, writeAclAtomic, AclStore (25 tests) |
| `http-ui.test.ts` | Unit tests for HTTP route handler (20 tests) |
| `vitest.config.ts` | Test + coverage config |
| `openclaw.plugin.json` | Plugin manifest; declares `trustedToolPolicies` contract |
| `acl.json.example` | Sample config to copy |
| `dist/index.js` | Committed compiled output |
| `dist/agent-acl-ui/` | Committed compiled UI assets |
| `ARCHITECTURE.md` | Design decisions, limitations, roadmap |

## Planned but not yet implemented

Do not implement these without a corresponding issue/PR — they have schema implications:

- **v1.1** Hot-reload via `fs.watch` on `aclPath` (detects external edits — distinct from the UI's own write handler)
- **v1.2** Per-tool granularity (`acl.servers[s].tools[t].allowAgents`)
- **v1.3** Denylist mode (`denyAgents` alternative to `allowAgents`)
- **v1.4** Wildcard agent IDs (`"jonny-*"`)
