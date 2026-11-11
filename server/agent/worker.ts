import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_REPO_URL, environmentParams, validateRepoUrl } from './definition';
import { githubPublisher } from './github';
import type { Db } from '../db';
import { requestMessage } from './prompt';

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
  githubToken: string;
  repoUrl: string;
  /** Hard spend cap per persistent session, in USD cents. Never reset automatically. */
  sessionBudgetCents?: number;
}

/** Production must fail visibly on missing configuration instead of acknowledging fake work. */
export function configFromEnv(env: NodeJS.ProcessEnv): ManagedConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const agentId = env.PITWALL_OPENAI_AGENT_ID?.trim();
  const githubToken = env.PITWALL_GITHUB_TOKEN?.trim();
  if (!agentId && env.NODE_ENV !== 'production') return null;
  if (!apiKey || !agentId || !githubToken) {
    throw new Error('Configure OPENAI_API_KEY, PITWALL_OPENAI_AGENT_ID and PITWALL_GITHUB_TOKEN (run npm run agent:setup).');
  }
  const budget = env.PITWALL_SESSION_BUDGET_CENTS;
  const sessionBudgetCents = budget ? Number(budget) : undefined;
  if (sessionBudgetCents !== undefined && (!Number.isSafeInteger(sessionBudgetCents) || sessionBudgetCents <= 0)) {
    throw new Error('PITWALL_SESSION_BUDGET_CENTS must be a positive integer.');
  }
  return {
    apiKey, agentId, githubToken,
    repoUrl: validateRepoUrl(env.PITWALL_REPO_URL ?? DEFAULT_REPO_URL),
    sessionBudgetCents,
  };
}

const REQUEST_DEADLINE_MS = 45 * 60 * 1000;
/** Separate namespace: an Anthropic session ID must never be sent to OpenAI. */
export const OPENAI_SESSION_KEY = 'openai_session_id';

type Sessions = OpenAI['beta']['agents']['sessions'];
export interface ManagedOptions {
  sessions?: Sessions;
  deadlineMs?: number;
}

/** One durable OpenAI Agents session; the SDK subscribes before sending each turn. */
export function managedBackend(
  db: Db,
  config: ManagedConfig,
  log: (m: string) => void = console.log,
  options: ManagedOptions = {},
): AgentBackend {
  const sessions = options.sessions ?? new OpenAI({ apiKey: config.apiKey, timeout: 30_000, maxRetries: 2 }).beta.agents.sessions;

  // Closing an SSE stream does not stop remote execution. Wait for cancellation
  // before allowing the next queued request to use this session.
  async function cancelAndWait(id: string) {
    await sessions.events.create(id, { events: [{ type: 'agent.session.input.cancel' }] }, { timeout: 10_000 });
    const stopAt = Date.now() + 30_000;
    while (Date.now() < stopAt) {
      const session = await sessions.retrieve(id, { timeout: 10_000 });
      if (session.status === 'idle' || session.status === 'failed') return;
      await delay(250);
    }
    throw new Error('OpenAI turn cancellation is still pending; session cannot accept another request.');
  }

  async function sessionId(signal: AbortSignal): Promise<string> {
    const { rows } = await db.query<{ value: string }>(`SELECT value FROM agent_state WHERE key = $1`, [OPENAI_SESSION_KEY]);
    if (rows[0]) {
      const existing = await sessions.retrieve(rows[0].value, { signal }).catch((err: unknown) => {
        if (err instanceof OpenAI.APIError && err.status === 404) return null;
        throw err; // A transient outage or auth failure must not create another billed session.
      });
      if (existing) {
        if (existing.status === 'failed') throw new Error('OpenAI session failed; inspect it before replacing the saved session.');
        if (existing.status !== 'idle') {
          log('agent: cancelling interrupted OpenAI turn before retrying queued work');
          await cancelAndWait(existing.id);
        }
        return existing.id;
      }
    }
    const session = await sessions.create({
      agent_id: config.agentId,
      environment: environmentParams(config.repoUrl),
      metadata: { application: 'pitwall' },
      ...(config.sessionBudgetCents ? { spend_control: { limit: config.sessionBudgetCents } } : {}),
    }, { signal, maxRetries: 0 }).catch((err: unknown) => {
      if (config.sessionBudgetCents && err instanceof OpenAI.BadRequestError && err.param === 'spend_control') {
        throw new Error('This OpenAI project does not accept spend_control. The configured session budget cannot be enforced; refusing to create an unlimited session.');
      }
      throw err;
    });
    await db.query(
      `INSERT INTO agent_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [OPENAI_SESSION_KEY, session.id],
    );
    log(`agent: started OpenAI session ${session.id}`);
    return session.id;
  }

  return {
    mode: 'managed',
    async handle(request, reply) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('OpenAI request deadline exceeded')), options.deadlineMs ?? REQUEST_DEADLINE_MS);
      let id: string | undefined;
      try {
        id = await sessionId(controller.signal);
        const github = githubPublisher(config.repoUrl, config.githubToken, request.id, controller.signal);
        const toolResult = async (action: () => Promise<unknown>) => {
          try { return await action(); }
          catch (err) { return { error: (err as Error).message }; }
        };
        const stream = sessions.stream(id, {
          input: requestMessage(request),
          // SDK retries reuse this key; a deliberate retry after cancellation starts a new turn.
          idempotencyKey: `pitwall-${request.id}-${randomUUID()}`,
          toolHandlers: {
            reply_to_player: async (input) => {
              if (input.status === 'pr_open') {
                const pr = await github.lookup({ request_id: request.id });
                if (pr.state !== 'open' || !('pr_url' in pr) || input.pr_url !== pr.pr_url) return 'pr_url must be the current request’s real open PR. Call submit_pull_request first.';
              }
              return reply(input as ReplyInput);
            },
            get_request_pull_request: (input) => toolResult(() => github.lookup(input)),
            submit_pull_request: (input) => toolResult(() => github.submit(input)),
          },
        }, { signal: controller.signal });
        try {
          for await (const event of stream) {
            if (event.type === 'agent.session.turn.failed' && event.turn.subagent_id === null) {
              throw new Error(`OpenAI turn failed: ${event.turn.error?.message ?? 'unknown error'}`);
            }
            if (event.type === 'agent.session.turn.cancelled' && event.turn.subagent_id === null) {
              throw new Error('OpenAI turn was cancelled');
            }
            if (event.type === 'agent.session.failed' || event.type === 'agent.session.environment.failed' || event.type === 'error') {
              throw new Error(`OpenAI lifecycle failure: ${event.type}`);
            }
            // No browser/approval workflows are configured for this unattended worker.
            if (event.type === 'agent.session.requires_action' && event.session.required_actions.some((a) => a.type !== 'function_call')) {
              throw new Error('OpenAI requested an unsupported interactive action');
            }
          }
        } finally {
          stream.abort();
        }
      } catch (err) {
        if (id) await cancelAndWait(id).catch(() => log('agent: OpenAI cancellation pending; saved session retained for recovery'));
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
