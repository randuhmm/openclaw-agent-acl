# Architecture: openclaw-agent-acl

This document describes the internal design of the plugin, its data flow, current limitations, and the planned roadmap for future versions. Intended audience: contributors and anyone building on top of this plugin.

## Design overview

```
User prompt
    │
    ▼
OpenClaw gateway
    │  dispatches tool call
    ▼
before_tool_call event
    │
    ▼
agent-acl plugin
    │
    ├─ extract server name from tool name  ("calendar-mcp__list_events" → "calendar-mcp")
    │
    ├─ look up acl.servers["calendar-mcp"]
    │      ├─ no rule → pass (unrestricted)
    │      └─ rule found → check allowAgents.includes(ctx.agentId)
    │              ├─ yes → pass
    │              └─ no  → block + log
    │
    ▼
Tool executes (or is blocked with reason returned to agent)
```

## Key implementation details

### Hook: `before_tool_call`

The plugin registers a single async handler on OpenClaw's `before_tool_call` event. This event fires synchronously in the tool dispatch path before any MCP call is made. The handler returns `{ block: false }` to allow or `{ block: true, blockReason: string }` to deny.

### Tool name parsing

OpenClaw namespaces MCP tools as `<server>__<tool>`. The plugin splits on the first `__` to extract the server name:

```typescript
const serverName = event.toolName.split('__')[0];
```

This is safe as long as server names do not themselves contain `__`, which is consistent with OpenClaw's naming conventions.

### ACL config loading

`acl.json` is read once during `register()` via `readFileSync`. The file is parsed and validated at startup — missing file, invalid JSON, or wrong structure all throw with a descriptive error message that surfaces in gateway logs. The parsed config is held in memory for the lifetime of the gateway process.

### Default-open policy

Any MCP server not listed in `acl.json` is fully unrestricted. This is an intentional "lock what you need" design: adding the plugin doesn't break anything by default, and you opt specific servers into the allowlist incrementally.

### Agent ID resolution

The agent ID is taken from `ctx.agentId`, falling back to `"main"` if absent. Agent IDs in `allowAgents` must match exactly (case-sensitive).

### Plugin manifest: `trustedToolPolicies`

The `openclaw.plugin.json` declares `contracts.trustedToolPolicies: ["agent-acl"]`. This contract grants the plugin permission to intercept `before_tool_call` events and return block decisions. Without it, the gateway would not dispatch the hook to this plugin.

---

## Known limitations

These are intentional constraints for v1.0, not bugs. Each is tracked as a future enhancement.

| # | Limitation | Impact |
|---|---|---|
| 1 | **No hot-reload** | Rule changes require gateway restart (`openclaw gateway restart`) |
| 2 | **Server-level granularity only** | Can't allow `mealie__search` but block `mealie__delete` for the same agent |
| 3 | **Allowlist only** | No denylist mode — can't say "all agents except X" |
| 4 | **No wildcard agent IDs** | Can't match `jonny-*` to cover all per-user agent instances |
| 5 | **No runtime inspection** | No API to query the loaded ACL without reading the file directly |
| 6 | **Single config file** | All rules live in one `acl.json`; no include/merge of multiple rule files |

---

## Roadmap

### v1.1 — Hot-reload

Watch `aclPath` with `fs.watch` and atomically swap the in-memory ACL on change. No gateway restart needed to update rules. Implementation sketch:

```typescript
import { watch } from 'node:fs';

watch(aclPath, () => {
  try {
    acl = loadAcl(aclPath);
    api.logger.info(`agent-acl: reloaded ${Object.keys(acl.servers).length} rule(s)`);
  } catch (e) {
    api.logger.error(`agent-acl: reload failed — keeping previous rules. ${e}`);
  }
});
```

### v1.2 — Per-tool granularity

Extend the schema to allow tool-level overrides within a server:

```json
{
  "servers": {
    "mealie": {
      "allowAgents": ["family-chef"],
      "tools": {
        "delete_recipe": { "allowAgents": [] }
      }
    }
  }
}
```

Tool-level rules take precedence over server-level rules.

### v1.3 — Denylist mode

Add `denyAgents` as an alternative to `allowAgents`. Semantics: if `denyAgents` is present, all agents are allowed *except* those listed.

```json
{
  "servers": {
    "web-search": {
      "denyAgents": ["child-agent"]
    }
  }
}
```

### v1.4 — Wildcard agent IDs

Support glob-style patterns in `allowAgents`/`denyAgents`:

```json
{ "allowAgents": ["jonny-*", "main"] }
```

Matches any agent ID starting with `jonny-`, which covers per-user instances like `jonny-assistant`, `jonny-chef`, etc.

---

## Contributing

The plugin is a single TypeScript file (`index.ts`) compiled with `tsup` to `dist/index.js`. The `dist/` output is committed to the repo so that `git:`-based installs work without a build step.

```bash
npm install          # install dev deps
npm run typecheck    # type-check without building
npm run build        # compile index.ts → dist/index.js
npm run plugin:build # build + validate plugin entry point
```

All PRs should pass `npm run plugin:build` and `npm run plugin:validate` before merge. The CI workflow (`.github/workflows/ci.yml`) enforces this on every push.
