import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { loadAcl, validateAclWrite, writeAclAtomic, AclStore } from './acl-store.js';

const mockRead = vi.mocked(readFileSync);
const mockWrite = vi.mocked(writeFileSync);
const mockRename = vi.mocked(renameSync);
const mockUnlink = vi.mocked(unlinkSync);

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockRename.mockReset();
  mockUnlink.mockReset();
});

// ─── loadAcl ─────────────────────────────────────────────────────────────────

describe('loadAcl', () => {
  it('parses a valid acl.json', () => {
    mockRead.mockReturnValue(JSON.stringify({ servers: { 'my-mcp': { allowAgents: ['agent1'] } } }));
    const result = loadAcl('/fake/acl.json');
    expect(result.servers['my-mcp'].allowAgents).toEqual(['agent1']);
  });

  it('throws with path on read failure', () => {
    mockRead.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => loadAcl('/custom/acl.json')).toThrow('/custom/acl.json');
    expect(() => loadAcl('/custom/acl.json')).toThrow(/cannot read acl\.json/);
  });

  it('throws on invalid JSON', () => {
    mockRead.mockReturnValue('{bad}');
    expect(() => loadAcl('/fake/acl.json')).toThrow(/is not valid JSON/);
  });

  it('throws when servers key is missing', () => {
    mockRead.mockReturnValue(JSON.stringify({ rules: {} }));
    expect(() => loadAcl('/fake/acl.json')).toThrow(/top-level "servers" object/);
  });

  it('throws when servers is an array', () => {
    mockRead.mockReturnValue(JSON.stringify({ servers: [] }));
    expect(() => loadAcl('/fake/acl.json')).toThrow(/top-level "servers" object/);
  });

  it('accepts an empty servers object', () => {
    mockRead.mockReturnValue(JSON.stringify({ servers: {} }));
    expect(loadAcl('/fake/acl.json')).toEqual({ servers: {} });
  });
});

// ─── validateAclWrite ────────────────────────────────────────────────────────

describe('validateAclWrite', () => {
  it('accepts a valid servers map', () => {
    const result = validateAclWrite({ servers: { 'my-mcp': { allowAgents: ['agent1'] } } });
    expect(result.servers['my-mcp'].allowAgents).toEqual(['agent1']);
  });

  it('accepts an empty servers object', () => {
    const result = validateAclWrite({ servers: {} });
    expect(result.servers).toEqual({});
  });

  it('throws when body is not an object', () => {
    expect(() => validateAclWrite('string')).toThrow();
    expect(() => validateAclWrite(null)).toThrow();
    expect(() => validateAclWrite([])).toThrow();
  });

  it('throws on unknown top-level key', () => {
    expect(() => validateAclWrite({ servers: {}, extra: 'bad' })).toThrow(/unknown top-level key "extra"/);
  });

  it('throws when servers is missing', () => {
    expect(() => validateAclWrite({})).toThrow(/"servers"/);
  });

  it('throws when servers is an array', () => {
    expect(() => validateAclWrite({ servers: [] })).toThrow(/"servers"/);
  });

  it('throws when a server rule is not an object', () => {
    expect(() => validateAclWrite({ servers: { 'my-mcp': 'bad' } })).toThrow(/rule for server "my-mcp"/);
  });

  it('throws on unknown server rule key (denyAgents)', () => {
    expect(() =>
      validateAclWrite({ servers: { 'my-mcp': { allowAgents: [], denyAgents: [] } } }),
    ).toThrow(/unknown key "denyAgents" on server "my-mcp"/);
  });

  it('throws on unknown server rule key (tools)', () => {
    expect(() =>
      validateAclWrite({ servers: { 'my-mcp': { allowAgents: [], tools: {} } } }),
    ).toThrow(/unknown key "tools" on server "my-mcp"/);
  });

  it('throws when allowAgents is not an array', () => {
    expect(() =>
      validateAclWrite({ servers: { 'my-mcp': { allowAgents: 'agent1' } } }),
    ).toThrow(/"allowAgents" for server "my-mcp" must be an array/);
  });

  it('throws when allowAgents contains a non-string', () => {
    expect(() =>
      validateAclWrite({ servers: { 'my-mcp': { allowAgents: [1, 2] } } }),
    ).toThrow(/"allowAgents" for server "my-mcp" must be an array of strings/);
  });

  it('returns a deep copy so mutations to input do not affect result', () => {
    const input = { servers: { 'my-mcp': { allowAgents: ['agent1'] } } };
    const result = validateAclWrite(input);
    input.servers['my-mcp'].allowAgents.push('agent2');
    expect(result.servers['my-mcp'].allowAgents).toEqual(['agent1']);
  });
});

// ─── writeAclAtomic ──────────────────────────────────────────────────────────

describe('writeAclAtomic', () => {
  const config = { servers: { 'my-mcp': { allowAgents: ['agent1'] } } };

  it('writes to a temp file in the same directory then renames to target', () => {
    writeAclAtomic('/data/acl.json', config);
    expect(mockWrite).toHaveBeenCalledOnce();
    const [tmpPath] = vi.mocked(mockWrite).mock.calls[0] as [string, ...unknown[]];
    expect(tmpPath).toMatch(/^\/data\//);
    expect(tmpPath).not.toBe('/data/acl.json');
    expect(mockRename).toHaveBeenCalledWith(tmpPath, '/data/acl.json');
  });

  it('writes valid JSON with a trailing newline', () => {
    writeAclAtomic('/data/acl.json', config);
    const [, contents] = vi.mocked(mockWrite).mock.calls[0] as [unknown, string, ...unknown[]];
    const parsed = JSON.parse(contents);
    expect(parsed).toEqual(config);
    expect(contents).toMatch(/\n$/);
  });

  it('does not call renameSync and deletes temp file when writeFileSync throws', () => {
    mockWrite.mockImplementation(() => { throw new Error('disk full'); });
    expect(() => writeAclAtomic('/data/acl.json', config)).toThrow('disk full');
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('tries to clean up temp file and re-throws when renameSync fails', () => {
    mockRename.mockImplementation(() => { throw new Error('rename failed'); });
    expect(() => writeAclAtomic('/data/acl.json', config)).toThrow('rename failed');
    expect(mockUnlink).toHaveBeenCalledOnce();
  });
});

// ─── AclStore ────────────────────────────────────────────────────────────────

describe('AclStore', () => {
  it('get() returns the initial config', () => {
    const initial = { servers: { 'my-mcp': { allowAgents: ['agent1'] } } };
    const store = new AclStore(initial);
    expect(store.get()).toBe(initial);
  });

  it('update() replaces the in-memory config', () => {
    const initial = { servers: {} };
    const store = new AclStore(initial);
    const next = { servers: { 'my-mcp': { allowAgents: ['agent1'] } } };
    store.update(next);
    expect(store.get()).toBe(next);
  });

  it('before_tool_call semantics: updated store is visible immediately', () => {
    const store = new AclStore({ servers: {} });
    expect(store.get().servers['my-mcp']).toBeUndefined();
    store.update({ servers: { 'my-mcp': { allowAgents: ['agent1'] } } });
    expect(store.get().servers['my-mcp'].allowAgents).toContain('agent1');
  });
});
