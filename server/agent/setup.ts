// Provision the saved agent only. GitHub credentials never go to OpenAI.
import OpenAI from 'openai';
import { pathToFileURL } from 'node:url';
import { agentParams } from './definition';
import { AGENT_MODEL } from './prompt';

export async function provisionAgent(env: NodeJS.ProcessEnv, client = new OpenAI({ apiKey: env.OPENAI_API_KEY })) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');
  await client.models.retrieve(AGENT_MODEL);
  await client.beta.agents.sessions.list({ limit: 1 });
  const agent = env.PITWALL_OPENAI_AGENT_ID
    ? await client.beta.agents.update(env.PITWALL_OPENAI_AGENT_ID, agentParams)
    : await client.beta.agents.create(agentParams);
  return { agentId: agent.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = await provisionAgent(process.env);
  console.log(`Set on Railway game (production):\nPITWALL_OPENAI_AGENT_ID=${ids.agentId}\nAlso set OPENAI_API_KEY and retain PITWALL_GITHUB_TOKEN in Railway's secret manager.`);
}
