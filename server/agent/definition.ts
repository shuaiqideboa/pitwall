import type { AgentCreateParams, EnvironmentParam } from 'openai/resources/beta/agents/agents';
import { AGENT_MODEL, AGENT_NAME, PR_LOOKUP_TOOL, PR_SUBMIT_TOOL, REPLY_TOOL, REPO_PATH, SYSTEM_PROMPT } from './prompt';

export const DEFAULT_REPO_URL = 'https://github.com/shuaiqideboa/pitwall';

export function validateRepoUrl(url: string): string {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) {
    throw new Error('PITWALL_REPO_URL must be an HTTPS GitHub repository URL without credentials or query parameters.');
  }
  return url;
}

/** Public source only. GitHub credentials remain in the Railway worker. */
export function environmentParams(repoUrl: string): EnvironmentParam.EnvironmentParamOpenAIHosted {
  validateRepoUrl(repoUrl);
  return {
    type: 'openai_hosted',
    container_size: 'medium',
    network: {
      access: 'restricted',
      allowed_domains: ['github.com', 'api.github.com', 'registry.npmjs.org'],
    },
    setup_commands: [{
      command: [
        'set -eu',
        `git clone --branch main '${repoUrl}' '${REPO_PATH}'`,
        `cd '${REPO_PATH}'`,
        'git config user.name "Pit Wall"',
        'git config user.email "pitwall-agent@users.noreply.github.com"',
      ].join('\n'),
    }],
  };
}

export const agentParams: AgentCreateParams = {
  name: AGENT_NAME,
  model: AGENT_MODEL,
  reasoning: { effort: 'high' },
  instructions: SYSTEM_PROMPT,
  multi_agent: { enabled: false },
  tools: [
    { type: 'web_search', mode: 'disabled' },
    PR_LOOKUP_TOOL,
    PR_SUBMIT_TOOL,
    REPLY_TOOL,
  ],
};
