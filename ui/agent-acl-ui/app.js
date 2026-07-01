// @ts-check
'use strict';

/**
 * @typedef {{ allowAgents: string[] }} ServerRule
 * @typedef {{ servers: Record<string, ServerRule>, knownMcpServers: Array<{name: string, enabled: boolean}>, knownAgentIds: string[], aclPath: string }} State
 */

/** @type {State | null} */
let state = null;

/** Deep clone of servers map that tracks the user's edits before Save. */
/** @type {Record<string, ServerRule | null>} null = default-open (rule removed) */
let editedServers = {};

async function loadState() {
  const res = await fetch('api/state');
  if (!res.ok) throw new Error(`Failed to load state: ${res.status}`);
  return /** @type {State} */ (await res.json());
}

/** @param {string[]} agentIds */
function sortedAgentIds(agentIds) {
  return [...new Set(agentIds)].sort();
}

/** @param {State} s */
function buildAgentColumns(s) {
  const configured = new Set(s.knownAgentIds);
  const fromAcl = new Set(Object.values(s.servers).flatMap((r) => r.allowAgents));
  const all = new Set([...configured, ...fromAcl]);
  const sorted = sortedAgentIds([...all]);
  return sorted.map((id) => ({ id, isUnknown: !configured.has(id) }));
}

/** @param {State} s */
function buildServerRows(s) {
  const fromConfig = new Set(s.knownMcpServers.map((m) => m.name));
  const fromAcl = new Set(Object.keys(s.servers));
  const all = new Set([...fromConfig, ...fromAcl]);
  const sorted = [...all].sort();
  return sorted.map((name) => {
    const mcpEntry = s.knownMcpServers.find((m) => m.name === name);
    const hasRule = Object.prototype.hasOwnProperty.call(s.servers, name);
    return {
      name,
      enabled: mcpEntry ? mcpEntry.enabled : undefined,
      inConfig: !!mcpEntry,
      hasRule,
    };
  });
}

/** @param {string} text @param {string} cls */
function badge(text, cls = '') {
  const el = document.createElement('span');
  el.className = `badge ${cls}`;
  el.textContent = text;
  return el;
}

function renderGrid() {
  if (!state) return;

  const agentCols = buildAgentColumns(state);
  const serverRows = buildServerRows(state);

  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';

  const h1 = document.createElement('h1');
  h1.textContent = 'agent-acl — MCP server access rules';
  app.appendChild(h1);

  const pathEl = document.createElement('p');
  pathEl.className = 'acl-path';
  pathEl.textContent = state.aclPath;
  app.appendChild(pathEl);

  const table = document.createElement('table');
  table.className = 'grid';

  const thead = table.createTHead();
  const headRow = thead.insertRow();
  const thServer = document.createElement('th');
  thServer.className = 'row-label';
  thServer.textContent = 'MCP Server';
  headRow.appendChild(thServer);

  for (const col of agentCols) {
    const th = document.createElement('th');
    th.appendChild(document.createTextNode(col.id));
    if (col.isUnknown) th.appendChild(badge('free text'));
    headRow.appendChild(th);
  }
  const thActions = document.createElement('th');
  thActions.textContent = '';
  headRow.appendChild(thActions);

  const tbody = table.createTBody();

  for (const row of serverRows) {
    const isEdited = Object.prototype.hasOwnProperty.call(editedServers, row.name);
    const effectiveRule = isEdited ? editedServers[row.name] : (state.servers[row.name] ?? null);
    const isDefaultOpen = effectiveRule === null;

    const tr = tbody.insertRow();
    if (isDefaultOpen) tr.classList.add('default-open');

    const tdLabel = document.createElement('td');
    tdLabel.className = 'row-label';
    tdLabel.appendChild(document.createTextNode(row.name));
    if (!row.inConfig) tdLabel.appendChild(badge('not in config'));
    else if (row.enabled === false) tdLabel.appendChild(badge('disabled'));

    const allowAgents = effectiveRule?.allowAgents ?? [];
    const zeroAgents = !isDefaultOpen && allowAgents.length === 0;
    if (zeroAgents) {
      const warn = document.createElement('div');
      warn.className = 'row-warning';
      warn.textContent = 'No agents allowed (server is effectively locked)';
      tdLabel.appendChild(warn);
    }
    tr.appendChild(tdLabel);

    for (const col of agentCols) {
      const td = tr.insertCell();
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !isDefaultOpen && allowAgents.includes(col.id);

      const serverName = row.name;
      const agentId = col.id;

      cb.addEventListener('change', () => {
        const currentRaw = Object.prototype.hasOwnProperty.call(editedServers, serverName)
          ? editedServers[serverName]
          : (state?.servers[serverName] ?? null);
        const current = currentRaw ?? { allowAgents: [] };
        const agents = new Set(current.allowAgents);
        if (cb.checked) agents.add(agentId);
        else agents.delete(agentId);
        editedServers[serverName] = { allowAgents: [...agents].sort() };
        renderGrid();
      });

      td.appendChild(cb);
      tr.appendChild(td);
    }

    const tdAction = document.createElement('td');
    if (!isDefaultOpen) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'reset-rule';
      resetBtn.textContent = 'Reset to default-open';
      resetBtn.title = 'Remove the ACL rule for this server (all agents become implicitly allowed)';
      resetBtn.addEventListener('click', () => {
        editedServers[row.name] = null;
        renderGrid();
      });
      tdAction.appendChild(resetBtn);
    }
    tr.appendChild(tdAction);
  }

  app.appendChild(table);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', saveAcl);
  toolbar.appendChild(saveBtn);

  const statusEl = document.createElement('span');
  statusEl.className = 'status';
  statusEl.id = 'save-status';
  toolbar.appendChild(statusEl);

  app.appendChild(toolbar);
}

async function saveAcl() {
  if (!state) return;

  const statusEl = document.getElementById('save-status');
  if (statusEl) statusEl.textContent = 'Saving…';

  const merged = Object.assign({}, state.servers);
  for (const [name, rule] of Object.entries(editedServers)) {
    if (rule === null) {
      delete merged[name];
    } else {
      merged[name] = rule;
    }
  }

  try {
    const res = await fetch('api/acl', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: merged }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (statusEl) {
        statusEl.className = 'status error';
        statusEl.textContent = `Error: ${json.error ?? res.statusText}`;
      }
      return;
    }
    state = Object.assign({}, state, { servers: merged });
    editedServers = {};
    if (statusEl) {
      statusEl.className = 'status ok';
      statusEl.textContent = 'Saved';
    }
    renderGrid();
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'status error';
      statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

async function init() {
  const app = document.getElementById('app');
  try {
    state = await loadState();
    editedServers = {};
    renderGrid();
  } catch (err) {
    if (app) {
      app.innerHTML = `<p style="color:red">Failed to load: ${
        err instanceof Error ? err.message : String(err)
      }</p>`;
    }
  }
}

init();
