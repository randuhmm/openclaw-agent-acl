import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:url', () => ({
  fileURLToPath: vi.fn(() => '/fake/dist/http-ui.js'),
}));

import { readFileSync, writeFileSync } from 'node:fs';
import { AclStore } from './acl-store.js';
import { registerHttpUi } from './http-ui.js';

const mockRead = vi.mocked(readFileSync);
const mockWrite = vi.mocked(writeFileSync);

function makeServerResponse() {
  const chunks: string[] = [];
  const headers: Record<string, string | number | string[]> = {};
  const res = {
    statusCode: 200,
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    end: vi.fn((body?: string | Buffer) => {
      if (body != null) chunks.push(typeof body === 'string' ? body : body.toString('utf8'));
    }),
    _getBody: () => chunks.join(''),
    _getHeaders: () => headers,
  };
  return res;
}

function makeRequest(opts: { method?: string; url?: string; body?: string }) {
  const bodyBuf = opts.body ? Buffer.from(opts.body, 'utf8') : null;
  return {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    [Symbol.asyncIterator]: async function* () {
      if (bodyBuf) yield bodyBuf;
    },
  };
}

type MockApi = {
  config: { mcp?: { servers?: Record<string, { enabled?: boolean }> }; agents?: { list?: Array<{ id: string }> } };
  logger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  registerHttpRoute: ReturnType<typeof vi.fn>;
  _getHandler: () => (req: unknown, res: unknown) => Promise<boolean | void>;
};

function makeApi(opts?: {
  mcpServers?: Record<string, { enabled?: boolean }>;
  agentList?: Array<{ id: string }>;
}): MockApi {
  let capturedHandler: ((req: unknown, res: unknown) => Promise<boolean | void>) | null = null;
  const api: MockApi = {
    config: {
      mcp: opts?.mcpServers !== undefined ? { servers: opts.mcpServers } : { servers: {} },
      agents: { list: opts?.agentList ?? [] },
    },
    logger: { info: vi.fn(), error: vi.fn() },
    registerHttpRoute: vi.fn((params: { handler: (req: unknown, res: unknown) => Promise<boolean | void> }) => {
      capturedHandler = params.handler;
    }),
    _getHandler: () => {
      if (!capturedHandler) throw new Error('registerHttpRoute was not called');
      return capturedHandler;
    },
  };
  return api;
}

function reg(api: MockApi, store: AclStore, aclPath: string, uiPath?: string) {
  registerHttpUi(
    api as unknown as Parameters<typeof registerHttpUi>[0],
    store,
    aclPath,
    uiPath,
  );
  return api._getHandler();
}

function makeStore(servers: Record<string, { allowAgents: string[] }> = {}) {
  return new AclStore({ servers });
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
});

// ─── Route registration ───────────────────────────────────────────────────────

describe('registerHttpUi — route registration', () => {
  it('registers a single HTTP route with correct auth and match', () => {
    const api = makeApi();
    registerHttpUi(api as unknown as Parameters<typeof registerHttpUi>[0], makeStore(), '/fake/acl.json');
    expect(api.registerHttpRoute).toHaveBeenCalledOnce();
    const params = vi.mocked(api.registerHttpRoute).mock.calls[0][0] as Record<string, unknown>;
    expect(params.auth).toBe('gateway');
    expect(params.match).toBe('prefix');
    expect(params.gatewayRuntimeScopeSurface).toBe('trusted-operator');
  });

  it('uses default uiPath /agent-acl-ui/', () => {
    const api = makeApi();
    registerHttpUi(api as unknown as Parameters<typeof registerHttpUi>[0], makeStore(), '/fake/acl.json');
    const params = vi.mocked(api.registerHttpRoute).mock.calls[0][0] as Record<string, unknown>;
    expect(params.path).toBe('/agent-acl-ui/');
  });

  it('accepts a custom uiPath', () => {
    const api = makeApi();
    registerHttpUi(api as unknown as Parameters<typeof registerHttpUi>[0], makeStore(), '/fake/acl.json', '/my-ui/');
    const params = vi.mocked(api.registerHttpRoute).mock.calls[0][0] as Record<string, unknown>;
    expect(params.path).toBe('/my-ui/');
  });

  it('adds trailing slash to uiPath that lacks one', () => {
    const api = makeApi();
    registerHttpUi(api as unknown as Parameters<typeof registerHttpUi>[0], makeStore(), '/fake/acl.json', '/my-ui');
    const params = vi.mocked(api.registerHttpRoute).mock.calls[0][0] as Record<string, unknown>;
    expect(params.path).toBe('/my-ui/');
  });
});

// ─── GET /api/state ───────────────────────────────────────────────────────────

describe('GET /api/state', () => {
  it('returns servers, knownMcpServers, knownAgentIds, aclPath', async () => {
    const api = makeApi({
      mcpServers: { 'calendar-mcp': { enabled: true }, 'smart-home': { enabled: false } },
      agentList: [{ id: 'agent1' }, { id: 'agent2' }],
    });
    const store = makeStore({ 'calendar-mcp': { allowAgents: ['agent1'] } });
    const handler = reg(api, store, '/proj/acl.json');

    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/api/state' });
    const res = makeServerResponse();
    const handled = await handler(req, res);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._getBody());
    expect(body.aclPath).toBe('/proj/acl.json');
    expect(body.servers).toEqual({ 'calendar-mcp': { allowAgents: ['agent1'] } });
    expect(body.knownMcpServers).toEqual(
      expect.arrayContaining([
        { name: 'calendar-mcp', enabled: true },
        { name: 'smart-home', enabled: false },
      ]),
    );
    expect(body.knownAgentIds).toEqual(expect.arrayContaining(['agent1', 'agent2']));
  });

  it('returns empty knownMcpServers when config.mcp is absent', async () => {
    const api = makeApi();
    (api.config as Record<string, unknown>).mcp = undefined;
    const handler = reg(api, makeStore(), '/proj/acl.json');

    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/api/state' });
    const res = makeServerResponse();
    await handler(req, res);

    expect(JSON.parse(res._getBody()).knownMcpServers).toEqual([]);
  });

  it('returns empty knownAgentIds when config.agents.list is absent', async () => {
    const api = makeApi();
    (api.config as Record<string, unknown>).agents = undefined;
    const handler = reg(api, makeStore(), '/proj/acl.json');

    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/api/state' });
    const res = makeServerResponse();
    await handler(req, res);

    expect(JSON.parse(res._getBody()).knownAgentIds).toEqual([]);
  });

  it('reflects free-text agent ids from allowAgents in the servers data', async () => {
    const api = makeApi({ agentList: [{ id: 'agent1' }] });
    const store = makeStore({ 'my-mcp': { allowAgents: ['agent1', 'free-text-agent'] } });
    const handler = reg(api, store, '/proj/acl.json');

    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/api/state' });
    const res = makeServerResponse();
    await handler(req, res);

    const body = JSON.parse(res._getBody());
    expect(body.servers['my-mcp'].allowAgents).toContain('free-text-agent');
  });
});

// ─── PUT /api/acl ─────────────────────────────────────────────────────────────

describe('PUT /api/acl', () => {
  it('returns 200 and persists + updates store on valid input', async () => {
    const api = makeApi();
    const store = makeStore({});
    const handler = reg(api, store, '/proj/acl.json');

    const req = makeRequest({
      method: 'PUT',
      url: '/agent-acl-ui/api/acl',
      body: JSON.stringify({ servers: { 'my-mcp': { allowAgents: ['agent1'] } } }),
    });
    const res = makeServerResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(store.get().servers['my-mcp'].allowAgents).toContain('agent1');
  });

  it('returns 400 for invalid JSON body', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'PUT', url: '/agent-acl-ui/api/acl', body: 'not-json' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for unknown server rule key (denyAgents)', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({
      method: 'PUT',
      url: '/agent-acl-ui/api/acl',
      body: JSON.stringify({ servers: { 'my-mcp': { allowAgents: [], denyAgents: [] } } }),
    });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._getBody()).error).toMatch(/denyAgents/);
  });

  it('returns 400 when allowAgents is not an array', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({
      method: 'PUT',
      url: '/agent-acl-ui/api/acl',
      body: JSON.stringify({ servers: { 'my-mcp': { allowAgents: 'agent1' } } }),
    });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 and leaves store unchanged when write fails', async () => {
    mockWrite.mockImplementation(() => { throw new Error('disk full'); });
    const api = makeApi();
    const store = makeStore({});
    const handler = reg(api, store, '/proj/acl.json');

    const req = makeRequest({
      method: 'PUT',
      url: '/agent-acl-ui/api/acl',
      body: JSON.stringify({ servers: { 'my-mcp': { allowAgents: ['agent1'] } } }),
    });
    const res = makeServerResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(store.get().servers['my-mcp']).toBeUndefined();
  });

  it('returns 405 for non-PUT methods on /api/acl', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'DELETE', url: '/agent-acl-ui/api/acl' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('write-then-read: before_tool_call hook sees updated state without restart', async () => {
    const api = makeApi();
    const store = makeStore({ 'old-server': { allowAgents: ['old-agent'] } });
    const handler = reg(api, store, '/proj/acl.json');

    const putReq = makeRequest({
      method: 'PUT',
      url: '/agent-acl-ui/api/acl',
      body: JSON.stringify({ servers: { 'new-server': { allowAgents: ['new-agent'] } } }),
    });
    const putRes = makeServerResponse();
    await handler(putReq, putRes);
    expect(putRes.statusCode).toBe(200);

    // The store (shared with the before_tool_call hook) reflects the updated config
    expect(store.get().servers['new-server'].allowAgents).toContain('new-agent');
    expect(store.get().servers['old-server']).toBeUndefined();
  });
});

// ─── Static file serving ─────────────────────────────────────────────────────

describe('static file serving', () => {
  it('serves index.html for the root UI path', async () => {
    mockRead.mockReturnValue(Buffer.from('<html>hello</html>'));
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._getHeaders()['Content-Type']).toMatch(/text\/html/);
    expect(res._getBody()).toContain('<html>hello</html>');
  });

  it('serves app.js with correct content type', async () => {
    mockRead.mockReturnValue(Buffer.from('// js'));
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/app.js' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._getHeaders()['Content-Type']).toMatch(/javascript/);
  });

  it('returns 404 for an unknown static file', async () => {
    mockRead.mockImplementation(() => { throw new Error('ENOENT'); });
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/missing.html' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 and does not read any file for path-traversal attempts', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'GET', url: '/agent-acl-ui/../../etc/passwd' });
    const res = makeServerResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('does not handle non-GET requests for static paths (returns falsy)', async () => {
    const api = makeApi();
    const handler = reg(api, makeStore(), '/proj/acl.json');
    const req = makeRequest({ method: 'POST', url: '/agent-acl-ui/style.css' });
    const res = makeServerResponse();
    const handled = await handler(req, res);
    expect(handled).toBeFalsy();
    expect(mockRead).not.toHaveBeenCalled();
  });
});
