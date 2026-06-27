# openclaw-agent-acl

An [OpenClaw](https://openclaw.ai) plugin that restricts MCP server tool access on a per-agent basis using a simple JSON allowlist.

## Why

By default, every agent in OpenClaw can call tools from every connected MCP server. That's fine for a single-agent setup, but breaks down when you run multiple agents with different roles or trust levels — a family cooking assistant shouldn't be able to read your email, a child's agent shouldn't have access to your calendar or smart-home controls, and a work agent probably shouldn't touch personal data.

This plugin lets you lock down specific MCP servers to designated agents without touching OpenClaw's core configuration. You define the rules once in a JSON file; everything else stays open by default.

## How it works

OpenClaw namespaces all MCP tools as `<server>__<tool>` (e.g. `calendar-mcp__list_events`). This plugin intercepts every `before_tool_call` event, extracts the server name from the tool name, and checks whether the calling agent is in that server's allowlist. If not, the call is blocked with a clear reason returned to the agent and logged.

Servers with no rule in `acl.json` are unrestricted — you only list the servers you want to lock down.

## Installation

```bash
openclaw plugins install clawhub:randuhmm/openclaw-agent-acl
```

Or directly from git (for pre-release versions or self-hosted installs):

```bash
openclaw plugins install git:github.com/randuhmm/openclaw-agent-acl
```

## Configuration

### 1. Create `acl.json`

Copy the example and edit it for your setup:

```bash
cp acl.json.example ~/.openclaw/acl.json
```

```json
{
  "servers": {
    "calendar-mcp": {
      "allowAgents": ["my-assistant"]
    },
    "smart-home": {
      "allowAgents": ["main", "my-assistant"]
    },
    "recipes": {
      "allowAgents": ["family-chef"]
    }
  }
}
```

- `servers` — keys are MCP server names exactly as configured in OpenClaw
- `allowAgents` — agent IDs allowed to call tools from that server
- Servers **not listed** are unrestricted — all agents pass through

### 2. Point the plugin at your `acl.json`

In your `openclaw.json`, configure the `aclPath`:

```json
{
  "plugins": {
    "entries": {
      "agent-acl": {
        "enabled": true,
        "config": {
          "aclPath": "/home/user/.openclaw/acl.json"
        }
      }
    }
  }
}
```

If `aclPath` is omitted, the plugin looks for `acl.json` in its own installed directory.

### 3. Restart the gateway

```bash
openclaw gateway restart
```

## Verification

Confirm the plugin is active:

```bash
openclaw plugins inspect agent-acl --runtime
```

Test it: ask a restricted agent to use a blocked tool — it will receive a refusal, and you'll see a log line like:

```
agent-acl: blocked agent="family-chef" from tool="calendar-mcp__list_events"
```

## Finding your agent IDs

Agent IDs are the identifiers used when creating agents with `openclaw agents create`. List them:

```bash
openclaw agents list
```

The default agent ID is `"main"`.

## Updating rules

Edit `acl.json` and restart the gateway to apply changes. No plugin reinstall needed.

## Troubleshooting

**Plugin is loaded but nothing is being blocked**
Check that the server name in `acl.json` exactly matches the server name as configured in OpenClaw (case-sensitive). The key must equal what appears before `__` in a tool name — e.g. if the tool is `Calendar__list_events`, the server key is `Calendar`, not `calendar-mcp`.

**Gateway fails to start after installing the plugin**
The plugin now gives a clear error message if `acl.json` is missing or malformed. Check the gateway logs — the message will include the exact path it tried to read and what went wrong.

**An agent is being blocked unexpectedly**
Run `openclaw agents list` to confirm the exact agent ID. Agent IDs are case-sensitive and must match the string in `allowAgents` exactly.

## Plugin manifest: `trustedToolPolicies`

The `openclaw.plugin.json` manifest declares `contracts.trustedToolPolicies: ["agent-acl"]`. This tells OpenClaw's gateway that this plugin provides a trusted tool policy and should be loaded before tool calls are dispatched — it's what grants the plugin permission to intercept `before_tool_call` events.

## Requirements

- OpenClaw `>=2026.6.8`
- Node.js `>=22.19`

## License

MIT
