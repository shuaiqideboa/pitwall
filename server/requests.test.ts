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
  it('needs a signed-in player', async () => {
    expect((await post('/api/requests', { text: 'Make the Safety Car rarer please' })).status).toBe(401);
    expect((await app.request('/api/requests')).status).toBe(401);
  });

  it('checks the length of the request', async () => {
    const cookie = await signUp();
    expect((await post('/api/requests', { text: 'short' }, cookie)).status).toBe(400);
    expect((await post('/api/requests', { text: 'x'.repeat(2001) }, cookie)).status).toBe(400);
  });

  it('queues the request and the agent answers it', async () => {
    const cookie = await signUp();
    const res = await post('/api/requests', { text: 'Make the Safety Car come out less often' }, cookie);
    expect(res.status).toBe(201);
    await worker.idle();
    const [request] = await myRequests(cookie);
    expect(request).toMatchObject({ text: 'Make the Safety Car come out less often', status: 'answered' });
    expect(request.reply).toMatch(/test mode/);
  });

  it('shows each player only their own requests', async () => {
    const alice = await signUp('Alice');
    const bob = await signUp('Bob');
    await post('/api/requests', { text: 'Alice wants faster pit stops' }, alice);
    await post('/api/requests', { text: 'Bob wants a rain mode please' }, bob);
    await worker.idle();
    expect((await myRequests(alice)).map((r) => r.text)).toEqual(['Alice wants faster pit stops']);
    expect((await myRequests(bob)).map((r) => r.text)).toEqual(['Bob wants a rain mode please']);
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

  it('marks a request failed if the agent crashes, and moves on', async () => {
    let calls = 0;
    setup({
      mode: 'test',
      async handle(req, reply) {
        if (++calls === 1) throw new Error('boom');
        await reply({ request_id: req.id, status: 'answered', message: 'All good.' });
      },
    });
    const [first, second] = await queue('This one will crash the agent', 'This one will work fine');
    expect(first.status).toBe('failed');
    expect(first.reply).toMatch(/something went wrong/);
    expect(second.status).toBe('answered');
    expect(logs.some((l) => l.includes('boom'))).toBe(true);
  });

  it('marks a request failed if the agent never reports back', async () => {
    setup({ mode: 'test', async handle() {} });
    const [request] = await queue('The agent forgets to reply to this');
    expect(request.status).toBe('failed');
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
