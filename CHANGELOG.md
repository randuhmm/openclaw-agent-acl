# Changelog

## [Unreleased]

## [1.0.2] - 2026-07-01

### Fixed
- Web UI API calls now include `Authorization: Bearer <token>` headers. Previously all
  `fetch()` calls to `api/state` and `api/acl` were unauthenticated, causing 401 errors
  when the UI was accessed via a reverse proxy (nginx, Cloudflare Tunnel, etc.).
  The token is read from the URL hash on first load (`/agent-acl-ui/#<token>`), stripped
  from the URL, and persisted to `sessionStorage` for the remainder of the browser session.

## [1.0.1] - 2026-06-xx

### Added
- **Web UI**: browser-based permission editor served at `/agent-acl-ui/` (configurable via
  `uiPath`). Shows all configured MCP servers and agents in a servers × agents grid; lets
  operators create, edit, and remove ACL rules without hand-editing `acl.json`. Rule changes
  take effect immediately — no gateway restart required for writes made through the UI.
- `uiEnabled` plugin config option (boolean, default `true`) to disable the web UI if not needed.
- `uiPath` plugin config option (string, default `/"/agent-acl-ui/"`) to mount the UI at a
  custom path.
- `acl-store.ts` — extracted `AclConfig` type, `loadAcl()`, strict write-path validator
  (`validateAclWrite`), atomic `writeAclAtomic()` (temp-file + rename, same directory), and
  `AclStore` class shared between the hook and the HTTP handler.
- `http-ui.ts` — `registerHttpUi()` that registers a single prefix-matched HTTP route with
  `auth: "gateway"` / `gatewayRuntimeScopeSurface: "trusted-operator"`, serving static assets
  and two JSON API endpoints (`GET /api/state`, `PUT /api/acl`).
- 45 new unit tests across `acl-store.test.ts` and `http-ui.test.ts` (71 total).

### Changed
- `index.ts` refactored to use `AclStore`; the `before_tool_call` handler reads via
  `store.get()` so the HTTP write handler can share the same mutable reference.
- Build script: `--publicDir ui` copies `ui/agent-acl-ui/` assets to `dist/agent-acl-ui/`.
- `tsconfig.json` extended to cover `acl-store.ts`, `http-ui.ts`, and their test files.

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
