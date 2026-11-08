// One-time setup (safe to re-run): creates the agent's environment and the
// Pit Wall agent, or updates the existing agent in place with the current
// definition. Prints the ids to store as Railway variables.
//
//   railway run --service game -- npx tsx server/agent/setup.ts
//
// Never run per request: sessions only reference these ids.
import Anthropic from '@anthropic-ai/sdk';
import { agentParams, environmentParams } from './definition';

const client = new Anthropic({ apiKey: process.env.claude_api_key ?? process.env.ANTHROPIC_API_KEY });

let environmentId = process.env.PITWALL_ENVIRONMENT_ID;
if (!environmentId) {
  const env = await client.beta.environments.create(environmentParams);
  environmentId = env.id;
  console.log(`Created environment ${env.id}`);
} else {
  console.log(`Using environment ${environmentId}`);
}

const existing = process.env.PITWALL_AGENT_ID;
const agent = existing
  ? await client.beta.agents.update(existing, agentParams) // same agent, new version if anything changed
  : await client.beta.agents.create(agentParams);
console.log(`${existing ? 'Updated' : 'Created'} agent ${agent.id} (version ${agent.version})`);

console.log(`
Set these on the Railway game service (if not already set):
  PITWALL_ENVIRONMENT_ID=${environmentId}
  PITWALL_AGENT_ID=${agent.id}`);
