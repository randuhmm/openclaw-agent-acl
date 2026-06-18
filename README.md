# openclaw-agent-acl

An [OpenClaw](https://openclaw.ai) plugin that restricts MCP server tool access on a per-agent basis using a simple JSON allowlist.

By default, all agents in OpenClaw can call any connected MCP tool. This plugin lets you lock down specific MCP servers so only designated agents can use their tools — without touching OpenClaw's core configuration.

## How it works

OpenClaw namespaces all MCP tools as `<server>__<tool>` (e.g. `mealie__get_recipes`). This plugin intercepts every `before_tool_call` event, extracts the server name from the tool name, and checks whether the calling agent is in that server's allowlist. If not, the call is blocked with a clear reason logged.

Servers with no rule in `acl.json` are unrestricted — you only need to list the servers you want to lock down.

## Installation

```bash
openclaw plugins install clawhub:randuhmm/openclaw-agent-acl
```

Or from git (pre-release / self-hosted):

```bash
openclaw plugins install git:github.com/randuhmm/openclaw-agent-acl
```

## Configuration

### 1. Create `acl.json`

Copy the example and place it in your OpenClaw state directory (or any path you choose):

```bash
cp acl.json.example /path/to/openclaw/state/acl.json
```

```json
{
  "servers": {
    "mealie": {
      "allowAgents": ["family-chef"]
    },
    "ha-mcp": {
      "allowAgents": ["main", "jonny-assistant"]
    }
  }
}
```

- `servers` — keys are MCP server names as configured in OpenClaw
- `allowAgents` — array of agent IDs that may call tools from that server
- Any server **not listed** in `servers` is unrestricted (all agents pass through)

### 2. Point the plugin at your `acl.json`

In your `openclaw.json`, add the `aclPath` config for the plugin:

```json
{
  "plugins": {
    "entries": {
      "agent-acl": {
        "enabled": true,
        "config": {
          "aclPath": "/root/.openclaw/acl.json"
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

After restarting, confirm the plugin is registered:

```bash
openclaw plugins inspect agent-acl --runtime
```

Then test: ask a restricted agent to use a blocked tool — it should receive a refusal, and you'll see a log line like:

```
agent-acl: blocked agent="main" from tool="mealie__get_recipes"
```

## Finding your agent IDs

Agent IDs are the identifiers you used when creating agents with `openclaw agents create`. List them with:

```bash
openclaw agents list
```

The default/main agent ID is typically `"main"`.

## Updating rules

Edit `acl.json` and restart the gateway to apply changes. No plugin reinstall needed.

## Requirements

- OpenClaw `>=2026.3.24-beta.2`
- Node.js `>=22.19`

## License

MIT
