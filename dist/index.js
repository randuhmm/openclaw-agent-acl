// index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { join as join3 } from "path";

// acl-store.ts
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { dirname, join } from "path";
function loadAcl(aclPath) {
  let raw;
  try {
    raw = readFileSync(aclPath, "utf8");
  } catch {
    throw new Error(
      `agent-acl: cannot read acl.json at "${aclPath}". Create the file or set aclPath in plugin config.`
    );
  }
  let acl;
  try {
    acl = JSON.parse(raw);
  } catch (e) {
    throw new Error(`agent-acl: acl.json at "${aclPath}" is not valid JSON: ${e}`);
  }
  if (!acl || acl.servers == null || typeof acl.servers !== "object" || Array.isArray(acl.servers)) {
    throw new Error(`agent-acl: acl.json must have a top-level "servers" object`);
  }
  return acl;
}
function validateAclWrite(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('agent-acl: request body must be an object with a "servers" key');
  }
  const obj = value;
  for (const key of Object.keys(obj)) {
    if (key !== "servers") {
      throw new Error(`agent-acl: unknown top-level key "${key}"; only "servers" is supported`);
    }
  }
  const servers = obj.servers;
  if (servers == null || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error('agent-acl: "servers" must be an object');
  }
  const validatedServers = {};
  for (const [serverName, rule] of Object.entries(servers)) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`agent-acl: rule for server "${serverName}" must be an object`);
    }
    const ruleObj = rule;
    for (const key of Object.keys(ruleObj)) {
      if (key !== "allowAgents") {
        throw new Error(
          `agent-acl: unknown key "${key}" on server "${serverName}" rule (only "allowAgents" is supported in this schema version)`
        );
      }
    }
    if (!Array.isArray(ruleObj.allowAgents) || !ruleObj.allowAgents.every((a) => typeof a === "string")) {
      throw new Error(`agent-acl: "allowAgents" for server "${serverName}" must be an array of strings`);
    }
    validatedServers[serverName] = { allowAgents: [...ruleObj.allowAgents] };
  }
  return { servers: validatedServers };
}
function writeAclAtomic(aclPath, config) {
  const dir = dirname(aclPath);
  const tmpPath = join(
    dir,
    `.acl.json.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const contents = `${JSON.stringify(config, null, 2)}
`;
  writeFileSync(tmpPath, contents, "utf8");
  try {
    renameSync(tmpPath, aclPath);
  } catch (e) {
    try {
      unlinkSync(tmpPath);
    } catch {
    }
    throw e;
  }
}
var AclStore = class {
  acl;
  constructor(initial) {
    this.acl = initial;
  }
  get() {
    return this.acl;
  }
  update(next) {
    this.acl = next;
  }
};

// http-ui.ts
import { readFileSync as readFileSync2 } from "fs";
import { dirname as dirname2, extname, join as join2, normalize, sep } from "path";
import { fileURLToPath } from "url";
var MAX_BODY_BYTES = 1024 * 1024;
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        return { ok: false, status: 413, message: "payload too large" };
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400, message: "failed to read request body" };
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return { ok: false, status: 400, message: "request body must be JSON" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, message: "request body must be valid JSON" };
  }
}
function resolveStaticPath(staticDir, uiPath, requestPath) {
  let rel = requestPath.slice(uiPath.length);
  if (rel === "" || rel === "/") rel = "index.html";
  if (rel.startsWith("/")) rel = rel.slice(1);
  const resolved = normalize(join2(staticDir, rel));
  if (resolved !== staticDir && !resolved.startsWith(staticDir + sep)) {
    return null;
  }
  return resolved;
}
function serveStatic(res, filePath) {
  let contents;
  try {
    contents = readFileSync2(filePath);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.end(contents);
}
function buildViewModel(api, store, aclPath) {
  const mcpServers = api.config.mcp?.servers ?? {};
  const knownMcpServers = Object.entries(mcpServers).map(([name, cfg]) => ({
    name,
    enabled: cfg?.enabled !== false
  }));
  const knownAgentIds = (api.config.agents?.list ?? []).map((a) => a.id);
  return {
    servers: store.get().servers,
    knownMcpServers,
    knownAgentIds,
    aclPath
  };
}
async function handlePutAcl(req, res, store, aclPath) {
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, body.status, { error: body.message });
    return;
  }
  let config;
  try {
    config = validateAclWrite(body.value);
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    return;
  }
  try {
    writeAclAtomic(aclPath, config);
  } catch (e) {
    sendJson(res, 500, {
      error: `failed to write acl.json: ${e instanceof Error ? e.message : String(e)}`
    });
    return;
  }
  store.update(config);
  sendJson(res, 200, { servers: config.servers });
}
function registerHttpUi(api, store, aclPath, uiPath = "/agent-acl-ui/") {
  const normalizedPath = uiPath.endsWith("/") ? uiPath : `${uiPath}/`;
  const staticDir = join2(dirname2(fileURLToPath(import.meta.url)), "agent-acl-ui");
  const statePath = `${normalizedPath}api/state`;
  const aclApiPath = `${normalizedPath}api/acl`;
  api.registerHttpRoute({
    path: normalizedPath,
    match: "prefix",
    auth: "gateway",
    gatewayRuntimeScopeSurface: "trusted-operator",
    handler: async (req, res) => {
      const url = req.url ?? "";
      const pathname = url.split("?")[0];
      const method = (req.method ?? "GET").toUpperCase();
      if (pathname === statePath && method === "GET") {
        sendJson(res, 200, buildViewModel(api, store, aclPath));
        return true;
      }
      if (pathname === aclApiPath) {
        if (method === "PUT") {
          await handlePutAcl(req, res, store, aclPath);
        } else {
          res.setHeader("Allow", "PUT");
          sendJson(res, 405, { error: "Method Not Allowed" });
        }
        return true;
      }
      if (pathname.startsWith(normalizedPath) && method === "GET") {
        const assetPath = resolveStaticPath(staticDir, normalizedPath, pathname);
        if (!assetPath) {
          sendJson(res, 400, { error: "invalid path" });
          return true;
        }
        serveStatic(res, assetPath);
        return true;
      }
      return false;
    }
  });
}

// index.ts
var index_default = definePluginEntry({
  id: "agent-acl",
  name: "Agent Tool ACL",
  description: "Restricts MCP server tool access per agent via acl.json",
  register(api) {
    const aclPath = api.pluginConfig?.["aclPath"] ?? join3(api.rootDir, "acl.json");
    const acl = loadAcl(aclPath);
    api.logger.info(`agent-acl: loaded ${Object.keys(acl.servers).length} server rule(s) from ${aclPath}`);
    const store = new AclStore(acl);
    api.on("before_tool_call", async (event, ctx) => {
      const serverName = event.toolName.split("__")[0];
      const rule = store.get().servers[serverName];
      if (!rule) return { block: false };
      const agentId = ctx.agentId ?? "main";
      if (rule.allowAgents.includes(agentId)) return { block: false };
      api.logger.info(`agent-acl: blocked agent="${agentId}" from tool="${event.toolName}"`);
      return {
        block: true,
        blockReason: `Agent "${agentId}" does not have access to "${serverName}" tools`
      };
    });
    const uiEnabled = api.pluginConfig?.["uiEnabled"] ?? true;
    if (uiEnabled) {
      const uiPath = api.pluginConfig?.["uiPath"] ?? "/agent-acl-ui/";
      registerHttpUi(api, store, aclPath, uiPath);
    }
  }
});
export {
  index_default as default
};
