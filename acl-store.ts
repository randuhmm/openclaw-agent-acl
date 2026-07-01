import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface AclConfig {
  servers: Record<string, { allowAgents: string[] }>;
}

/**
 * Reads and validates acl.json at startup. Kept permissive on shape (only
 * checks the top-level "servers" key) to match the original v1.0 behavior —
 * stricter, schema-locked validation lives in validateAclWrite for the HTTP
 * write path, which is new surface and can afford to be stricter.
 */
export function loadAcl(aclPath: string): AclConfig {
  let raw: string;
  try {
    raw = readFileSync(aclPath, 'utf8');
  } catch {
    throw new Error(
      `agent-acl: cannot read acl.json at "${aclPath}". ` +
      `Create the file or set aclPath in plugin config.`,
    );
  }
  let acl: AclConfig;
  try {
    acl = JSON.parse(raw) as AclConfig;
  } catch (e) {
    throw new Error(`agent-acl: acl.json at "${aclPath}" is not valid JSON: ${e}`);
  }
  if (!acl || acl.servers == null || typeof acl.servers !== 'object' || Array.isArray(acl.servers)) {
    throw new Error(`agent-acl: acl.json must have a top-level "servers" object`);
  }
  return acl;
}

/**
 * Strict, schema-locked validation for the HTTP write path. Rejects unknown
 * top-level keys and unknown per-server-rule keys (e.g. "denyAgents",
 * "tools") so this UI can never silently accept or drop fields that belong
 * to a future, unimplemented schema version (v1.2-v1.4).
 */
export function validateAclWrite(value: unknown): AclConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('agent-acl: request body must be an object with a "servers" key');
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== 'servers') {
      throw new Error(`agent-acl: unknown top-level key "${key}"; only "servers" is supported`);
    }
  }
  const servers = obj.servers;
  if (servers == null || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('agent-acl: "servers" must be an object');
  }

  const validatedServers: Record<string, { allowAgents: string[] }> = {};
  for (const [serverName, rule] of Object.entries(servers as Record<string, unknown>)) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`agent-acl: rule for server "${serverName}" must be an object`);
    }
    const ruleObj = rule as Record<string, unknown>;
    for (const key of Object.keys(ruleObj)) {
      if (key !== 'allowAgents') {
        throw new Error(
          `agent-acl: unknown key "${key}" on server "${serverName}" rule ` +
          `(only "allowAgents" is supported in this schema version)`,
        );
      }
    }
    if (!Array.isArray(ruleObj.allowAgents) || !ruleObj.allowAgents.every((a) => typeof a === 'string')) {
      throw new Error(`agent-acl: "allowAgents" for server "${serverName}" must be an array of strings`);
    }
    validatedServers[serverName] = { allowAgents: [...(ruleObj.allowAgents as string[])] };
  }
  return { servers: validatedServers };
}

/**
 * Writes acl.json atomically: write to a temp file in the same directory,
 * then rename over the target. Readers (including a concurrently-running
 * gateway process) never observe a partially-written file.
 */
export function writeAclAtomic(aclPath: string, config: AclConfig): void {
  const dir = dirname(aclPath);
  const tmpPath = join(
    dir,
    `.acl.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const contents = `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(tmpPath, contents, 'utf8');
  try {
    renameSync(tmpPath, aclPath);
  } catch (e) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup; the original error is more useful than this one
    }
    throw e;
  }
}

/**
 * Holds the in-memory ACL so the before_tool_call hook and the HTTP UI's
 * write handler can share a single mutable view without a closed-over
 * `const`. update() is called after a successful write so the hook reflects
 * UI edits without a gateway restart.
 */
export class AclStore {
  private acl: AclConfig;

  constructor(initial: AclConfig) {
    this.acl = initial;
  }

  get(): AclConfig {
    return this.acl;
  }

  update(next: AclConfig): void {
    this.acl = next;
  }
}
