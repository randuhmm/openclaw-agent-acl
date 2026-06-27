# Changelog

## [1.0.0] — 2026-06-27

### Added
- Initial release: per-agent MCP server allowlist via `before_tool_call` hook
- JSON config (`acl.json`) with server-level rules — servers not listed are unrestricted
- `aclPath` plugin config option for placing `acl.json` outside the plugin directory
- Validated error messages for missing, unreadable, or malformed `acl.json`
- `contracts.trustedToolPolicies` manifest declaration for gateway integration
