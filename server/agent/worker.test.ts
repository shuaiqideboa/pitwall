import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db';
import { agentParams, environmentParams } from './definition';
import { configFromEnv, managedBackend, OPENAI_SESSION_KEY, type ManagedConfig } from './worker';

type Sessions = OpenAI['beta']['agents']['sessions'];
const config: ManagedConfig = { apiKey: 'test', agentId: 'agent_openai', githubToken: 'github-secret', repoUrl: 'https://github.com/o/r', sessionBudgetCents: 200 };
const request = { id: 12, player: 'Alice', text: 'Please improve the lap counter' };
const report = { request_id: 12, status: 'answered', message: 'Already supported.' };

function database(initial: Record<string, string> = {}) {
  const state = new Map(Object.entries(initial));
  const db = { query: vi.fn(async (sql: string, args: string[]) => {
    if (sql.startsWith('SELECT')) return { rows: state.has(args[0]) ? [{ value: state.get(args[0]) }] : [] };
    state.set(args[0], args[1]);
    return { rows: [] };
  }) } as unknown as Db;
  return { db, state };
}
function mockSessions() {
  const abort = vi.fn();
  const sessions = {
    retrieve: vi.fn().mockResolvedValue({ id: 'sess_openai', status: 'idle' }),
    create: vi.fn().mockResolvedValue({ id: 'sess_openai', status: 'idle' }),
    events: { create: vi.fn().mockResolvedValue(undefined) },
    stream: vi.fn((_id: string, params: { toolHandlers: { reply_to_player: (input: object) => Promise<string> } }) => ({
      abort,
      async *[Symbol.asyncIterator]() {
        const result = await params.toolHandlers.reply_to_player(report);
        yield { type: 'agent.session.turn.completed', turn: { subagent_id: null }, result };
      },
    })),
  };
  return { sessions, api: sessions as unknown as Sessions, abort };
}

describe('OpenAI configuration', () => {
  it('never mistakes Claude configuration for an OpenAI agent', () => {
    expect(configFromEnv({ OPENAI_API_KEY: 'test', PITWALL_AGENT_ID: 'claude', PITWALL_VAULT_IDS: 'claude' })).toBeNull();
    expect(() => configFromEnv({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'test' })).toThrow(/PITWALL_OPENAI_AGENT_ID/);
    expect(() => configFromEnv({ PITWALL_OPENAI_AGENT_ID: 'agent' })).toThrow(/OPENAI_API_KEY/);
  });
  it('rejects invalid budgets and repository URLs before allocating a sandbox', () => {
    const env = { OPENAI_API_KEY: 'test', PITWALL_OPENAI_AGENT_ID: 'agent', PITWALL_GITHUB_TOKEN: 'github-secret' };
    for (const budget of ['-1', '0', 'NaN', '1.5']) expect(() => configFromEnv({ ...env, PITWALL_SESSION_BUDGET_CENTS: budget })).toThrow(/positive integer/);
    expect(() => environmentParams("https://github.com/o/r'; echo bad")).toThrow(/repository URL/);
    expect(() => environmentParams('https://token@github.com/o/r')).toThrow(/repository URL/);
    expect(configFromEnv({ ...env, PITWALL_SESSION_BUDGET_CENTS: '200' })?.sessionBudgetCents).toBe(200);
  });
  it('keeps GitHub credentials and MCP out of the OpenAI sandbox', () => {
    const env = environmentParams(config.repoUrl);
    expect(env.network).toMatchObject({ access: 'restricted' });
    expect(env.env).toBeUndefined();
    expect(env.setup_commands?.[0].command).toContain('git clone --branch main');
    expect(JSON.stringify(env)).not.toMatch(/TOKEN|AUTH|secret/);
    expect(agentParams.tools?.some((t) => t.type === 'mcp')).toBe(false);
    expect(agentParams.model).toBe('gpt-6-astra');
  });
});

describe('OpenAI managed backend', () => {
  it('stores its own session ID, applies the spending cap and delivers the player reply', async () => {
    const { db, state } = database({ session_id: 'anthropic-session' });
    const { sessions, api, abort } = mockSessions();
    const reply = vi.fn().mockResolvedValue('Saved.');
    const backend = managedBackend(db, config, () => {}, { sessions: api });
    await backend.handle(request, reply);
    expect(sessions.retrieve).not.toHaveBeenCalled();
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ agent_id: config.agentId, spend_control: { limit: 200 } }), expect.anything());
    expect(JSON.stringify(sessions.create.mock.calls)).not.toContain(config.githubToken);
    expect(state.get('session_id')).toBe('anthropic-session');
    expect(state.get(OPENAI_SESSION_KEY)).toBe('sess_openai');
    expect(reply).toHaveBeenCalledWith(report);
    expect(abort).toHaveBeenCalledOnce();
    await backend.handle({ ...request, id: 13 }, reply);
    expect(sessions.create).toHaveBeenCalledOnce();
  });
  it('cancels an interrupted remote turn before sending another request', async () => {
    const { db } = database({ [OPENAI_SESSION_KEY]: 'sess_openai' });
    const { sessions, api } = mockSessions();
    sessions.retrieve.mockResolvedValueOnce({ id: 'sess_openai', status: 'in_progress' });
    await managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => 'Saved.');
    expect(sessions.events.create).toHaveBeenCalledWith('sess_openai', { events: [{ type: 'agent.session.input.cancel' }] }, expect.anything());
    expect(sessions.events.create.mock.invocationCallOrder[0]).toBeLessThan(sessions.stream.mock.invocationCallOrder[0]);
  });
  it('does not create a new billed session after an auth, network or session failure', async () => {
    for (const failure of [new Error('network unavailable'), new OpenAI.AuthenticationError(401, {}, 'bad key', new Headers())]) {
      const { db } = database({ [OPENAI_SESSION_KEY]: 'sess_openai' });
      const { sessions, api } = mockSessions();
      sessions.retrieve.mockRejectedValueOnce(failure);
      await expect(managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => '')).rejects.toThrow();
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.stream).not.toHaveBeenCalled();
    }
    const { db } = database({ [OPENAI_SESSION_KEY]: 'sess_openai' });
    const { sessions, api } = mockSessions();
    sessions.retrieve.mockResolvedValue({ id: 'sess_openai', status: 'failed' });
    await expect(managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => '')).rejects.toThrow(/inspect/);
    expect(sessions.create).not.toHaveBeenCalled();
  });
  it('recreates only a session which the API confirms is deleted', async () => {
    const { db } = database({ [OPENAI_SESSION_KEY]: 'deleted' });
    const { sessions, api } = mockSessions();
    sessions.retrieve.mockRejectedValueOnce(new OpenAI.NotFoundError(404, {}, 'not found', new Headers()));
    await managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => 'Saved.');
    expect(sessions.create).toHaveBeenCalledOnce();
  });
  it('never retries an unsupported budget as an unlimited session', async () => {
    const { db, state } = database();
    const { sessions, api } = mockSessions();
    sessions.create.mockRejectedValue(new OpenAI.BadRequestError(400, { param: 'spend_control' }, 'Unknown parameter', new Headers()));
    await expect(managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => '')).rejects.toThrow(/refusing to create an unlimited session/);
    expect(sessions.create).toHaveBeenCalledOnce();
    expect(sessions.stream).not.toHaveBeenCalled();
    expect(state.has(OPENAI_SESSION_KEY)).toBe(false);
  });
  it('propagates a failed root turn and cancels remote execution', async () => {
    const { db } = database();
    const { sessions, api, abort } = mockSessions();
    sessions.stream.mockReturnValue({ abort, async *[Symbol.asyncIterator]() {
      yield { type: 'agent.session.turn.failed', turn: { subagent_id: null, error: { message: 'budget reached' } } };
    } } as never);
    await expect(managedBackend(db, config, () => {}, { sessions: api }).handle(request, async () => '')).rejects.toThrow(/budget reached/);
    expect(sessions.events.create).toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });
  it('enforces the deadline even when the stream emits nothing', async () => {
    const { db } = database();
    const { sessions, api, abort } = mockSessions();
    sessions.stream.mockImplementation(((_id: string, _params: unknown, options: { signal: AbortSignal }) => ({
      abort,
      async *[Symbol.asyncIterator]() {
        await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
        yield {};
      },
    })) as never);
    await expect(managedBackend(db, config, () => {}, { sessions: api, deadlineMs: 10 }).handle(request, async () => '')).rejects.toThrow(/deadline/);
    expect(sessions.events.create).toHaveBeenCalledWith('sess_openai', expect.objectContaining({ events: [{ type: 'agent.session.input.cancel' }] }), expect.anything());
    expect(abort).toHaveBeenCalledOnce();
  });
});
