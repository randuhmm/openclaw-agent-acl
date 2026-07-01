import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { join } from 'node:path';
import { loadAcl, AclStore } from './acl-store.js';
import { registerHttpUi } from './http-ui.js';

export default definePluginEntry({
  id: 'agent-acl',
  name: 'Agent Tool ACL',
  description: 'Restricts MCP server tool access per agent via acl.json',
  register(api) {
    const aclPath: string =
      (api.pluginConfig?.['aclPath'] as string | undefined) ??
      join(api.rootDir!, 'acl.json');

    const acl = loadAcl(aclPath);
    api.logger.info(`agent-acl: loaded ${Object.keys(acl.servers).length} server rule(s) from ${aclPath}`);

    const store = new AclStore(acl);

    api.on('before_tool_call', async (event, ctx) => {
      const serverName = event.toolName.split('__')[0];
      const rule = store.get().servers[serverName];
      if (!rule) return { block: false };

      const agentId = ctx.agentId ?? 'main';
      if (rule.allowAgents.includes(agentId)) return { block: false };

      api.logger.info(`agent-acl: blocked agent="${agentId}" from tool="${event.toolName}"`);
      return {
        block: true,
        blockReason: `Agent "${agentId}" does not have access to "${serverName}" tools`,
      };
    });

    const uiEnabled = (api.pluginConfig?.['uiEnabled'] as boolean | undefined) ?? true;
    if (uiEnabled) {
      const uiPath = (api.pluginConfig?.['uiPath'] as string | undefined) ?? '/agent-acl-ui/';
      registerHttpUi(api, store, aclPath, uiPath);
    }
  },
});
