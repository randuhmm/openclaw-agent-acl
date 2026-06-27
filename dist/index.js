// index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readFileSync } from "fs";
import { join } from "path";
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
  if (!acl || typeof acl.servers !== "object" || Array.isArray(acl.servers)) {
    throw new Error(`agent-acl: acl.json must have a top-level "servers" object`);
  }
  return acl;
}
var index_default = definePluginEntry({
  id: "agent-acl",
  name: "Agent Tool ACL",
  description: "Restricts MCP server tool access per agent via acl.json",
  register(api) {
    const aclPath = api.pluginConfig?.["aclPath"] ?? join(api.rootDir, "acl.json");
    const acl = loadAcl(aclPath);
    api.logger.info(`agent-acl: loaded ${Object.keys(acl.servers).length} server rule(s) from ${aclPath}`);
    api.on("before_tool_call", async (event, ctx) => {
      const serverName = event.toolName.split("__")[0];
      const rule = acl.servers[serverName];
      if (!rule) return { block: false };
      const agentId = ctx.agentId ?? "main";
      if (rule.allowAgents.includes(agentId)) return { block: false };
      api.logger.info(`agent-acl: blocked agent="${agentId}" from tool="${event.toolName}"`);
      return {
        block: true,
        blockReason: `Agent "${agentId}" does not have access to "${serverName}" tools`
      };
    });
  }
});
export {
  index_default as default
};
