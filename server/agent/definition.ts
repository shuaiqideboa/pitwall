import type { AgentCreateParams } from '@anthropic-ai/sdk/resources/beta/agents';
import type { EnvironmentCreateParams } from '@anthropic-ai/sdk/resources/beta/environments';
import { AGENT_MODEL, AGENT_NAME, REPLY_TOOL, SYSTEM_PROMPT } from './prompt';

// The agent and its sandbox, as plain data. `npm run agent:setup` creates
// them once (or updates the existing agent in place); sessions only
// reference their ids.

/** GitHub's MCP server: the documented way for the agent to open pull requests. */
export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';

/** The sandbox: Anthropic-hosted, with only the network access the job needs. */
export const environmentParams: EnvironmentCreateParams = {
  name: 'pitwall-agent',
  config: {
    type: 'cloud',
    networking: {
      type: 'limited',
      allow_package_managers: true, // npm ci
      allow_mcp_servers: true, // GitHub MCP
      allowed_hosts: ['github.com', 'api.github.com'],
    },
  },
};

export const agentParams: AgentCreateParams = {
  name: AGENT_NAME,
  description: 'Handles Pitwall players’ change requests: decides, makes small tested changes, opens pull requests for the owner.',
  model: { id: AGENT_MODEL, effort: 'high' },
  system: SYSTEM_PROMPT,
  mcp_servers: [{ type: 'url', name: 'github', url: GITHUB_MCP_URL }],
  tools: [
    {
      type: 'agent_toolset_20260401',
      default_config: { enabled: true, permission_policy: { type: 'auto' } },
      // No web browsing: the job is the repo in front of it.
      configs: [
        { name: 'web_fetch', enabled: false },
        { name: 'web_search', enabled: false },
      ],
    },
    {
      // Only the pull-request tools; nothing that merges, deletes or changes settings.
      type: 'mcp_toolset',
      mcp_server_name: 'github',
      default_config: { enabled: false },
      configs: [
        { name: 'create_pull_request', enabled: true, permission_policy: { type: 'always_allow' } },
        { name: 'list_pull_requests', enabled: true, permission_policy: { type: 'always_allow' } },
        { name: 'get_pull_request', enabled: true, permission_policy: { type: 'always_allow' } },
      ],
    },
    REPLY_TOOL,
  ],
};
