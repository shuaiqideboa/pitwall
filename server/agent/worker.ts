import Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db';
import { REPO_PATH, requestMessage } from './prompt';

// Takes requests off the queue one at a time and hands each to the one Pit
// Wall agent. Players don't wait: they read the reply on their next visit.

export interface QueuedRequest {
  id: number;
  text: string;
  player: string;
}

/** What the agent sends with reply_to_player. */
export interface ReplyInput {
  request_id?: unknown;
  status?: unknown;
  message?: unknown;
  pr_url?: unknown;
}

/** Runs one request to completion, calling `reply` when the agent reports back. */
export interface AgentBackend {
  readonly mode: 'managed' | 'test';
  handle(request: QueuedRequest, reply: (input: ReplyInput) => Promise<string>): Promise<void>;
}

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const STATUSES = ['pr_open', 'answered', 'declined'];
const FAILED_MESSAGE =
  "Sorry, something went wrong on our side while handling this request. It's been noted, and you're welcome to send it again.";

export class AgentWorker {
  private running = false;
  private again = false;

  constructor(
    private db: Db,
    private backend: AgentBackend,
    private log: (msg: string) => void = console.log,
  ) {}

  /** After a restart, requests that were mid-way go back in the queue. */
  async recover() {
    await this.db.query(`UPDATE requests SET status = 'queued', updated_at = now() WHERE status = 'working'`);
  }

  /** Start working through the queue, if not already. Safe to call often. */
  wake() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.wake();
      }
    });
  }

  /** Resolves once the queue is empty (for tests and shutdown). */
  async idle() {
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  private async drain() {
    for (;;) {
      const { rows } = await this.db.query<QueuedRequest>(
        `UPDATE requests SET status = 'working', updated_at = now()
         WHERE id = (SELECT id FROM requests WHERE status = 'queued' ORDER BY id LIMIT 1)
         RETURNING id, text, (SELECT name FROM users WHERE users.id = requests.user_id) AS player`,
      );
      const request = rows[0];
      if (!request) return;
      let replied = false;
      try {
        await this.backend.handle(request, async (input) => {
          const problem = await this.applyReply(request.id, input);
          if (!problem) replied = true;
          return problem ?? 'Saved. The player will see your message.';
        });
      } catch (err) {
        this.log(`agent: request ${request.id} failed: ${(err as Error).message}`);
      }
      if (!replied) {
        await this.db.query(`UPDATE requests SET status = 'failed', reply = $2, updated_at = now() WHERE id = $1`, [
          request.id,
          FAILED_MESSAGE,
        ]);
      }
    }
  }

  /** Store the agent's report for the player. Returns a problem to tell the agent, or null. */
  async applyReply(currentId: number, input: ReplyInput): Promise<string | null> {
    if (input.request_id !== currentId) return `request_id must be ${currentId}, the request you are handling.`;
    if (typeof input.status !== 'string' || !STATUSES.includes(input.status)) {
      return `status must be one of ${STATUSES.join(', ')}.`;
    }
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message || message.length > 1000) return 'message must be 1–1000 characters.';
    const prUrl = typeof input.pr_url === 'string' ? input.pr_url.trim() : null;
    if (input.status === 'pr_open' && !(prUrl && PR_URL.test(prUrl))) {
      return 'pr_url must be the pull request URL, like https://github.com/owner/repo/pull/12.';
    }
    await this.db.query(
      `UPDATE requests SET status = $2, reply = $3, pr_url = $4, updated_at = now() WHERE id = $1`,
      [currentId, input.status, message, input.status === 'pr_open' ? prUrl : null],
    );
    this.log(`agent: request ${currentId} -> ${input.status}`);
    return null;
  }
}

/** No agent configured (local development, tests): acknowledge requests so the flow works end to end. */
export const testBackend: AgentBackend = {
  mode: 'test',
  async handle(request, reply) {
    await reply({
      request_id: request.id,
      status: 'answered',
      message:
        'Thanks! The Pit Wall agent is in test mode right now, so your idea has been saved for the team to read.',
    });
  },
};

export interface ManagedConfig {
  apiKey: string;
  agentId: string;
  environmentId: string;
  /** Vaults with the agent's credentials (e.g. the GitHub MCP token). */
  vaultIds: string[];
  repoUrl: string;
  /** Token for cloning and pushing the repo; it goes through Anthropic's git proxy, never into the sandbox. */
  repoToken?: string;
  /** Hard spend cap per agent session, in US cents. */
  sessionBudgetCents?: number;
}

/** The agent's settings from the environment, or null to run in test mode. */
export function configFromEnv(env: NodeJS.ProcessEnv): ManagedConfig | null {
  const apiKey = env.claude_api_key ?? env.ANTHROPIC_API_KEY;
  if (!apiKey || !env.PITWALL_AGENT_ID || !env.PITWALL_ENVIRONMENT_ID) return null;
  return {
    apiKey,
    agentId: env.PITWALL_AGENT_ID,
    environmentId: env.PITWALL_ENVIRONMENT_ID,
    vaultIds: (env.PITWALL_VAULT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    repoUrl: env.PITWALL_REPO_URL ?? 'https://github.com/shuaiqideboa/pitwall',
    repoToken: env.PITWALL_GITHUB_TOKEN,
    sessionBudgetCents: env.PITWALL_SESSION_BUDGET_CENTS ? Number(env.PITWALL_SESSION_BUDGET_CENTS) : undefined,
  };
}

/** A request should never take longer than this; then it counts as failed. */
const REQUEST_DEADLINE_MS = 45 * 60 * 1000;

/**
 * The real agent: one long-running Managed Agents session for every request
 * (the session id is kept in the database). Each request is one user
 * message; the turn ends when the session goes idle.
 */
export function managedBackend(db: Db, config: ManagedConfig, log: (m: string) => void = console.log): AgentBackend {
  const client = new Anthropic({ apiKey: config.apiKey });

  async function sessionId(): Promise<string> {
    const { rows } = await db.query<{ value: string }>(`SELECT value FROM agent_state WHERE key = 'session_id'`);
    if (rows[0]) {
      const existing = await client.beta.sessions.retrieve(rows[0].value).catch(() => null);
      if (existing && existing.status !== 'terminated') return existing.id;
    }
    const session = await client.beta.sessions.create({
      agent: config.agentId,
      environment_id: config.environmentId,
      title: 'Pit Wall: player requests',
      vault_ids: config.vaultIds,
      resources: config.repoToken
        ? [
            {
              type: 'github_repository',
              url: config.repoUrl,
              mount_path: REPO_PATH,
              authorization_token: config.repoToken,
              checkout: { type: 'branch', name: 'main' },
            },
          ]
        : [],
      ...(config.sessionBudgetCents
        ? { budget: { type: 'limit', max_list_cost: { amount: String(config.sessionBudgetCents), currency: 'USD' } } }
        : {}),
    });
    await db.query(
      `INSERT INTO agent_state (key, value) VALUES ('session_id', $1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [session.id],
    );
    log(`agent: started session ${session.id}`);
    return session.id;
  }

  return {
    mode: 'managed',
    async handle(request, reply) {
      const id = await sessionId();
      const answered = new Set<string>();
      const deadline = Date.now() + REQUEST_DEADLINE_MS;

      // Stream first, then send, so no event is missed.
      const stream = await client.beta.sessions.events.stream(id);
      await client.beta.sessions.events.send(id, {
        events: [{ type: 'user.message', content: [{ type: 'text', text: requestMessage(request) }] }],
      });

      for await (const event of stream) {
        if (Date.now() > deadline) throw new Error('took too long');
        if (event.type === 'agent.custom_tool_use' && !answered.has(event.id)) {
          answered.add(event.id);
          const result =
            event.name === 'reply_to_player' ? await reply(event.input as ReplyInput) : `Unknown tool ${event.name}.`;
          await client.beta.sessions.events.send(id, {
            events: [{ type: 'user.custom_tool_result', custom_tool_use_id: event.id, content: [{ type: 'text', text: result }] }],
          });
        } else if ((event.type === 'agent.tool_use' || event.type === 'agent.mcp_tool_use') && event.evaluated_permission === 'ask') {
          // Nobody is watching to approve risky calls: deny them, as the docs advise for unattended runs.
          log(`agent: denied a call that needed approval (${event.name})`);
          await client.beta.sessions.events.send(id, {
            events: [{ type: 'user.tool_confirmation', tool_use_id: event.id, result: 'deny' }],
          });
        } else if (event.type === 'session.status_idle' && event.stop_reason.type !== 'requires_action') {
          if (event.stop_reason.type === 'budget_reached') log('agent: session budget reached');
          return;
        } else if (event.type === 'session.status_terminated') {
          await db.query(`DELETE FROM agent_state WHERE key = 'session_id'`);
          throw new Error('session ended');
        }
      }
    },
  };
}
