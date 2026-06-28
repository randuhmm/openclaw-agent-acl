# Changelog

## [1.0.1] — 2026-06-28

### Fixed
- Schema validation now correctly rejects `servers: null` with the expected
  "must have a top-level servers object" error (previously threw a confusing
  "Cannot convert undefined or null to object" from `Object.keys`)

### Added
- Vitest unit test suite (26 tests) with 100% line/branch/function coverage
- `test:coverage` npm script and lcov report via `@vitest/coverage-v8`
- `CLAUDE.md` — developer quick-reference for AI-assisted development
- `SECURITY.md` — vulnerability disclosure policy
- `CONTRIBUTING.md` — setup, test guide, PR checklist, commit style
- CI: coverage reporting + Codecov upload; README badges (CI, npm, codecov, license)

## [1.0.0] — 2026-06-27

### Added
- Initial release: per-agent MCP server allowlist via `before_tool_call` hook
- JSON config (`acl.json`) with server-level rules — servers not listed are unrestricted
- `aclPath` plugin config option for placing `acl.json` outside the plugin directory
- Validated error messages for missing, unreadable, or malformed `acl.json`
- `contracts.trustedToolPolicies` manifest declaration for gateway integration
