# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use GitHub's private vulnerability reporting instead:
**Settings → Security → Advisories → Report a vulnerability**

Include:
- A description of the issue and its impact
- Steps to reproduce or a proof-of-concept
- The version of the plugin and OpenClaw gateway affected

We will acknowledge receipt within **7 days** and aim to publish a fix within **30 days** for confirmed issues.

## Scope

In-scope vulnerabilities include:
- Logic errors in `acl.json` rule evaluation that allow an agent to bypass an intended block
- Issues that allow the ACL config to be read, modified, or bypassed without authorization
- Path traversal or injection in the `aclPath` config option

Out of scope:
- Dependency vulnerabilities — run `npm audit` and open a standard issue or PR
- Issues requiring physical access or OS-level compromise of the host running the gateway
- Social engineering attacks against `acl.json` authors

## Dependency vulnerabilities

Run `npm audit` to check for known vulnerabilities in dependencies. For non-critical findings, open a standard issue.
