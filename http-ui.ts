import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AclConfig, type AclStore, validateAclWrite, writeAclAtomic } from './acl-store.js';

const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        return { ok: false, status: 413, message: 'payload too large' };
      }
      chunks.push(buffer);
    }
  } catch {
    return { ok: false, status: 400, message: 'failed to read request body' };
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return { ok: false, status: 400, message: 'request body must be JSON' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, message: 'request body must be valid JSON' };
  }
}

function resolveStaticPath(staticDir: string, uiPath: string, requestPath: string): string | null {
  let rel = requestPath.slice(uiPath.length);
  if (rel === '' || rel === '/') rel = 'index.html';
  if (rel.startsWith('/')) rel = rel.slice(1);
  const resolved = normalize(join(staticDir, rel));
  if (resolved !== staticDir && !resolved.startsWith(staticDir + sep)) {
    return null; // path-traversal attempt
  }
  return resolved;
}

function serveStatic(res: ServerResponse, filePath: string): void {
  let contents: Buffer;
  try {
    contents = readFileSync(filePath);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not found');
    return;
  }
  const ext = extname(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(contents);
}

function buildViewModel(api: OpenClawPluginApi, store: AclStore, aclPath: string): unknown {
  const mcpServers = api.config.mcp?.servers ?? {};
  const knownMcpServers = Object.entries(mcpServers).map(([name, cfg]) => ({
    name,
    enabled: cfg?.enabled !== false,
  }));
  const knownAgentIds = (api.config.agents?.list ?? []).map((a) => a.id);
  return {
    servers: store.get().servers,
    knownMcpServers,
    knownAgentIds,
    aclPath,
  };
}

async function handlePutAcl(
  req: IncomingMessage,
  res: ServerResponse,
  store: AclStore,
  aclPath: string,
): Promise<void> {
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, body.status, { error: body.message });
    return;
  }
  let config: AclConfig;
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
      error: `failed to write acl.json: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }
  store.update(config);
  sendJson(res, 200, { servers: config.servers });
}

export function registerHttpUi(
  api: OpenClawPluginApi,
  store: AclStore,
  aclPath: string,
  uiPath = '/agent-acl-ui/',
): void {
  const normalizedPath = uiPath.endsWith('/') ? uiPath : `${uiPath}/`;
  const staticDir = join(dirname(fileURLToPath(import.meta.url)), 'agent-acl-ui');
  const statePath = `${normalizedPath}api/state`;
  const aclApiPath = `${normalizedPath}api/acl`;

  api.registerHttpRoute({
    path: normalizedPath,
    match: 'prefix',
    auth: 'gateway',
    gatewayRuntimeScopeSurface: 'trusted-operator',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '';
      const pathname = url.split('?')[0];
      const method = (req.method ?? 'GET').toUpperCase();

      if (pathname === statePath && method === 'GET') {
        sendJson(res, 200, buildViewModel(api, store, aclPath));
        return true;
      }

      if (pathname === aclApiPath) {
        if (method === 'PUT') {
          await handlePutAcl(req, res, store, aclPath);
        } else {
          res.setHeader('Allow', 'PUT');
          sendJson(res, 405, { error: 'Method Not Allowed' });
        }
        return true;
      }

      if (pathname.startsWith(normalizedPath) && method === 'GET') {
        const assetPath = resolveStaticPath(staticDir, normalizedPath, pathname);
        if (!assetPath) {
          sendJson(res, 400, { error: 'invalid path' });
          return true;
        }
        serveStatic(res, assetPath);
        return true;
      }

      return false;
    },
  });
}
