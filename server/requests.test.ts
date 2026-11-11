import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentWorker, type AgentBackend, testBackend } from './agent/worker';
import { DAILY_REQUEST_LIMIT, createApp } from './app';
import { type Db, connect, migrate } from './db';

let db: Db;
let worker: AgentWorker;
let app: ReturnType<typeof createApp>;
const logs: string[] = [];

function setup(backend: AgentBackend) {
  worker = new AgentWorker(db, backend, (m) => logs.push(m));
  app = createApp(db, { secureCookies: false, onRequest: () => worker.wake() });
}

beforeEach(async () => {
  db = await connect();
  await migrate(db);
  logs.length = 0;
  setup(testBackend);
});
afterEach(async () => {
  await worker.idle();
  await db.close();
});

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

async function signUp(name = 'Alice') {
  const res = await post('/api/signup', { email: `${name.toLowerCase()}@example.com`, name, password: 'correct horse' });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

const myRequests = async (cookie: string) =>
  ((await (await app.request('/api/requests', { headers: { cookie } })).json()) as { requests: Record<string, unknown>[] })
    .requests;

describe('player requests', () => {
  it('requires sign-in and a request of the allowed length', async () => {
    expect((await post('/api/requests', { text: 'Make the Safety Car rarer please' })).status).toBe(401);
    expect((await app.request('/api/requests')).status).toBe(401);
    const cookie = await signUp();
    expect((await post('/api/requests', { text: 'short' }, cookie)).status).toBe(400);
    expect((await post('/api/requests', { text: 'x'.repeat(2001) }, cookie)).status).toBe(400);
  });

  it('queues and answers requests while keeping each player’s history private', async () => {
    const alice = await signUp('Alice');
    const bob = await signUp('Bob');
    expect((await post('/api/requests', { text: 'Alice wants faster pit stops' }, alice)).status).toBe(201);
    expect((await post('/api/requests', { text: 'Bob wants a rain mode please' }, bob)).status).toBe(201);
    await worker.idle();
    expect(await myRequests(alice)).toEqual([expect.objectContaining({ text: 'Alice wants faster pit stops', status: 'answered', reply: expect.stringMatching(/test mode/) })]);
    expect(await myRequests(bob)).toEqual([expect.objectContaining({ text: 'Bob wants a rain mode please', status: 'answered', reply: expect.stringMatching(/test mode/) })]);
  });

  it(`limits each player to ${DAILY_REQUEST_LIMIT} requests a day`, async () => {
    const cookie = await signUp();
    for (let i = 0; i < DAILY_REQUEST_LIMIT; i++) {
      expect((await post('/api/requests', { text: `Idea number ${i} for the game` }, cookie)).status).toBe(201);
    }
    expect((await post('/api/requests', { text: 'One idea too many today' }, cookie)).status).toBe(429);
  });
});

describe('the agent worker', () => {
  async function queue(...texts: string[]) {
    const cookie = await signUp();
    for (const text of texts) await post('/api/requests', { text }, cookie);
    await worker.idle();
    return (await myRequests(cookie)).reverse();
  }

  it('handles requests one at a time, in order', async () => {
    const order: number[] = [];
    let active = 0;
    setup({
      mode: 'test',
      async handle(req, reply) {
        active++;
        expect(active).toBe(1);
        order.push(req.id);
        await new Promise((r) => setTimeout(r, 20));
        await reply({ request_id: req.id, status: 'declined', message: 'Not this time.' });
        active--;
      },
    });
    const done = await queue('First idea for the game', 'Second idea for the game', 'Third idea for the game');
    expect(order).toEqual(done.map((r) => r.id));
    expect(done.every((r) => r.status === 'declined')).toBe(true);
  });

  it('rejects a bad report and lets the agent correct it', async () => {
    const answers: string[] = [];
    setup({
      mode: 'test',
      async handle(req, reply) {
        answers.push(await reply({ request_id: req.id + 99, status: 'answered', message: 'Hi' }));
        answers.push(await reply({ request_id: req.id, status: 'pr_open', message: 'Opened!', pr_url: 'not a link' }));
        answers.push(await reply({ request_id: req.id, status: 'merged', message: 'Done' }));
        answers.push(
          await reply({ request_id: req.id, status: 'pr_open', message: 'Opened a change for you.', pr_url: 'https://github.com/o/r/pull/7' }),
        );
      },
    });
    const [request] = await queue('Please add a lap counter sound');
    expect(answers[0]).toMatch(/request_id must be/);
    expect(answers[1]).toMatch(/pr_url must be/);
    expect(answers[2]).toMatch(/status must be/);
    expect(answers[3]).toMatch(/Saved/);
    expect(request).toMatchObject({ status: 'pr_open', pr_url: 'https://github.com/o/r/pull/7' });
  });

  it('marks crashes and missing replies failed, then continues processing the queue', async () => {
    let calls = 0;
    setup({
      mode: 'test',
      async handle(req, reply) {
        if (++calls === 1) throw new Error('boom');
        if (calls === 2) return;
        await reply({ request_id: req.id, status: 'answered', message: 'All good.' });
      },
    });
    const [first, silent, next] = await queue('This one will crash the agent', 'The agent forgets to reply', 'This one will work fine');
    expect(first.status).toBe('failed');
    expect(first.reply).toMatch(/something went wrong/);
    expect(silent.status).toBe('failed');
    expect(next.status).toBe('answered');
    expect(logs.some((l) => l.includes('boom'))).toBe(true);
  });

  it('puts interrupted work back in the queue after a restart', async () => {
    const cookie = await signUp();
    await db.query(`INSERT INTO requests (user_id, text, status) VALUES (1, 'Was mid-way when the server stopped', 'working')`);
    await worker.recover();
    worker.wake();
    await worker.idle();
    expect((await myRequests(cookie))[0].status).toBe('answered');
  });
});
