import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
  definePluginEntry: (config: unknown) => config,
}));

import { readFileSync } from 'node:fs';
import plugin from './index.js';

const mockReadFileSync = vi.mocked(readFileSync);

function makeAclJson(servers: Record<string, { allowAgents: string[] }> = {}): string {
  return JSON.stringify({ servers });
}

type BeforeToolCallHandler = (
  event: { toolName: string },
  ctx: { agentId?: string },
) => Promise<{ block: boolean; blockReason?: string }>;

function makeMockApi(opts?: { pluginConfig?: Record<string, unknown>; rootDir?: string }) {
  let capturedHandler: BeforeToolCallHandler | null = null;
  const api = {
    pluginConfig: opts?.pluginConfig,
    rootDir: opts?.rootDir ?? '/fake/root',
    logger: { info: vi.fn() },
    on: vi.fn((eventName: string, fn: BeforeToolCallHandler) => {
      if (eventName === 'before_tool_call') capturedHandler = fn;
    }),
  };
  const getHandler = (): BeforeToolCallHandler => {
    if (!capturedHandler) throw new Error('before_tool_call handler was not registered');
    return capturedHandler;
  };
  return { api, getHandler };
}

// Cast because definePluginEntry is mocked as a pass-through
const p = plugin as unknown as {
  id: string;
  name: string;
  description: string;
  register: (api: ReturnType<typeof makeMockApi>['api']) => void;
};

beforeEach(() => {
  mockReadFileSync.mockReset();
});

// ─── Plugin metadata ──────────────────────────────────────────────────────────

describe('plugin metadata', () => {
  it('has the correct id', () => {
    expect(p.id).toBe('agent-acl');
  });

  it('has the correct name', () => {
    expect(p.name).toBe('Agent Tool ACL');
  });

  it('has a description string', () => {
    expect(typeof p.description).toBe('string');
    expect(p.description.length).toBeGreaterThan(0);
  });

  it('exposes a register function', () => {
    expect(typeof p.register).toBe('function');
  });
});

// ─── loadAcl — file read failure ─────────────────────────────────────────────

describe('loadAcl — file read failure', () => {
  it('throws when readFileSync throws', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    const { api } = makeMockApi();
    expect(() => p.register(api)).toThrow(/cannot read acl\.json/);
  });

  it('error message includes the file path', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { api } = makeMockApi({ rootDir: '/my/project' });
    expect(() => p.register(api)).toThrow('/my/project/acl.json');
  });
});

// ─── loadAcl — JSON parse failure ────────────────────────────────────────────

describe('loadAcl — JSON parse failure', () => {
  it('throws when the file content is not valid JSON', () => {
    mockReadFileSync.mockReturnValue('not { valid json');
    const { api } = makeMockApi();
    expect(() => p.register(api)).toThrow(/is not valid JSON/);
  });

  it('error message includes the file path', () => {
    mockReadFileSync.mockReturnValue('{bad}');
    const { api } = makeMockApi({ rootDir: '/my/project' });
    expect(() => p.register(api)).toThrow('/my/project/acl.json');
  });
});

// ─── loadAcl — schema validation ─────────────────────────────────────────────

describe('loadAcl — schema validation', () => {
  it('throws when acl.json has no "servers" key', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ rules: {} }));
    const { api } = makeMockApi();
    expect(() => p.register(api)).toThrow(/top-level "servers" object/);
  });

  it('throws when "servers" is an array', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ servers: [] }));
    const { api } = makeMockApi();
    expect(() => p.register(api)).toThrow(/top-level "servers" object/);
  });

  it('throws when "servers" is null', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ servers: null }));
    const { api } = makeMockApi();
    expect(() => p.register(api)).toThrow(/top-level "servers" object/);
  });
});

// ─── loadAcl — success ───────────────────────────────────────────────────────

describe('loadAcl — success', () => {
  it('logs the server count and path after a successful load', () => {
    mockReadFileSync.mockReturnValue(makeAclJson({ 'my-mcp': { allowAgents: ['agent1'] } }));
    const { api } = makeMockApi({ rootDir: '/proj' });
    p.register(api);
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('1 server rule(s)'),
    );
    expect(api.logger.info).toHaveBeenCalledWith(expect.stringContaining('/proj/acl.json'));
  });

  it('registers a before_tool_call handler', () => {
    mockReadFileSync.mockReturnValue(makeAclJson());
    const { api } = makeMockApi();
    p.register(api);
    expect(api.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
  });
});

// ─── aclPath resolution ───────────────────────────────────────────────────────

describe('aclPath resolution', () => {
  it('uses pluginConfig.aclPath when provided', () => {
    mockReadFileSync.mockReturnValue(makeAclJson());
    const { api } = makeMockApi({ pluginConfig: { aclPath: '/custom/path/acl.json' } });
    p.register(api);
    expect(mockReadFileSync).toHaveBeenCalledWith('/custom/path/acl.json', 'utf8');
  });

  it('defaults to <rootDir>/acl.json when aclPath is absent', () => {
    mockReadFileSync.mockReturnValue(makeAclJson());
    const { api } = makeMockApi({ rootDir: '/workspace' });
    p.register(api);
    expect(mockReadFileSync).toHaveBeenCalledWith('/workspace/acl.json', 'utf8');
  });
});

// ─── before_tool_call handler ────────────────────────────────────────────────

describe('before_tool_call handler', () => {
  function setupWithServers(servers: Record<string, { allowAgents: string[] }>) {
    mockReadFileSync.mockReturnValue(makeAclJson(servers));
    const { api, getHandler } = makeMockApi();
    p.register(api);
    return { handler: getHandler(), api };
  }

  it('returns { block: false } when the server has no ACL rule (default-open)', async () => {
    const { handler } = setupWithServers({});
    const result = await handler({ toolName: 'unknown-server__some_tool' }, { agentId: 'agent1' });
    expect(result).toEqual({ block: false });
  });

  it('returns { block: false } when the agent is in allowAgents', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1', 'agent2'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, { agentId: 'agent1' });
    expect(result).toEqual({ block: false });
  });

  it('returns { block: true } when the agent is NOT in allowAgents', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, { agentId: 'other-agent' });
    expect(result.block).toBe(true);
  });

  it('blockReason includes the agentId and serverName', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, { agentId: 'other-agent' });
    expect(result.blockReason).toContain('other-agent');
    expect(result.blockReason).toContain('my-mcp');
  });

  it('falls back to "main" when ctx.agentId is undefined', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['main'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, {});
    expect(result).toEqual({ block: false });
  });

  it('blocks when fallback "main" is not in allowAgents', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, {});
    expect(result.block).toBe(true);
  });

  it('allows when fallback "main" is in allowAgents', async () => {
    const { handler } = setupWithServers({ 'my-mcp': { allowAgents: ['main', 'agent1'] } });
    const result = await handler({ toolName: 'my-mcp__list' }, {});
    expect(result).toEqual({ block: false });
  });

  it('extracts server name correctly from a double-underscore tool name', async () => {
    const { handler } = setupWithServers({ 'calendar-mcp': { allowAgents: ['agent1'] } });
    const result = await handler({ toolName: 'calendar-mcp__list_events' }, { agentId: 'agent1' });
    expect(result).toEqual({ block: false });
  });

  it('extracts only the first segment when the tool name has multiple __', async () => {
    const { handler } = setupWithServers({ 'calendar-mcp': { allowAgents: ['agent1'] } });
    const result = await handler(
      { toolName: 'calendar-mcp__category__list_events' },
      { agentId: 'agent1' },
    );
    expect(result).toEqual({ block: false });
  });

  it('calls api.logger.info when blocking a call', async () => {
    const { handler, api } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1'] } });
    await handler({ toolName: 'my-mcp__list' }, { agentId: 'blocked-agent' });
    const logCalls = (api.logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const blockLog = logCalls.find((args: unknown[]) =>
      typeof args[0] === 'string' && args[0].includes('blocked'),
    );
    expect(blockLog).toBeDefined();
  });

  it('does NOT call logger for an allowed call', async () => {
    const { handler, api } = setupWithServers({ 'my-mcp': { allowAgents: ['agent1'] } });
    // Reset logger to ignore the initial load log
    (api.logger.info as ReturnType<typeof vi.fn>).mockClear();
    await handler({ toolName: 'my-mcp__list' }, { agentId: 'agent1' });
    expect(api.logger.info).not.toHaveBeenCalled();
  });
});
