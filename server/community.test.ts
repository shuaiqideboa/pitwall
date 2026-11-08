import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { type Db, connect, migrate } from './db';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await connect();
  await migrate(db);
  app = createApp(db, { secureCookies: false });
});
afterEach(() => db.close());

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

async function player(name: string) {
  const res = await post('/api/signup', { email: `${name.toLowerCase()}@example.com`, name, password: 'correct horse' });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  const { user } = (await res.json()) as { user: { id: number } };
  return { cookie, id: user.id };
}

/** An idea in a given state, as the agent would have left it. */
async function idea(userId: number, text: string, status: string) {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO requests (user_id, text, status, reply, pr_url) VALUES ($1, $2, $3, 'Agent reply', 'https://github.com/o/r/pull/1') RETURNING id`,
    [userId, text, status],
  );
  return rows[0].id;
}

type Idea = { id: number; text: string; player: string; votes: number; voted: boolean; mine: boolean };
const community = async (cookie?: string) =>
  (await (await app.request('/api/community', { headers: cookie ? { cookie } : {} })).json()) as {
    waiting: Idea[];
    live: Idea[];
    signedIn: boolean;
  };

describe('community page', () => {
  it('shows only ideas that became a change, to anyone', async () => {
    const alice = await player('Alice');
    await idea(alice.id, 'Waiting for review', 'pr_open');
    await idea(alice.id, 'Already live', 'merged');
    for (const status of ['queued', 'working', 'answered', 'declined', 'failed', 'rejected']) {
      await idea(alice.id, `Hidden ${status}`, status);
    }
    const page = await community(); // signed out
    expect(page.signedIn).toBe(false);
    expect(page.waiting.map((i) => i.text)).toEqual(['Waiting for review']);
    expect(page.live.map((i) => i.text)).toEqual(['Already live']);
    expect(page.waiting[0]).toMatchObject({ player: 'Alice', mine: false, voted: false });
  });

  it('never exposes emails or pull request links', async () => {
    const alice = await player('Alice');
    await idea(alice.id, 'Waiting for review', 'pr_open');
    const raw = await (await app.request('/api/community')).text();
    expect(raw).not.toContain('@example.com');
    expect(raw).not.toContain('github.com');
  });

  it('sorts waiting ideas by votes, most wanted first', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const cara = await player('Cara');
    const few = await idea(alice.id, 'Fewer votes', 'pr_open');
    const many = await idea(alice.id, 'More votes', 'pr_open');
    await post(`/api/community/${many}/vote`, { vote: true }, bob.cookie);
    await post(`/api/community/${many}/vote`, { vote: true }, cara.cookie);
    await post(`/api/community/${few}/vote`, { vote: true }, bob.cookie);
    const page = await community(bob.cookie);
    expect(page.waiting.map((i) => [i.text, i.votes, i.voted])).toEqual([
      ['More votes', 2, true],
      ['Fewer votes', 1, true],
    ]);
  });
});

describe('voting', () => {
  it('needs a signed-in player', async () => {
    const alice = await player('Alice');
    const id = await idea(alice.id, 'An idea', 'pr_open');
    expect((await post(`/api/community/${id}/vote`, { vote: true })).status).toBe(401);
  });

  it('counts one vote per player, and a vote can be taken back', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const id = await idea(alice.id, 'An idea', 'pr_open');
    await post(`/api/community/${id}/vote`, { vote: true }, bob.cookie);
    const twice = await post(`/api/community/${id}/vote`, { vote: true }, bob.cookie);
    expect(await twice.json()).toEqual({ votes: 1, voted: true });
    const undo = await post(`/api/community/${id}/vote`, { vote: false }, bob.cookie);
    expect(await undo.json()).toEqual({ votes: 0, voted: false });
  });

  it("doesn't let players vote for their own idea", async () => {
    const alice = await player('Alice');
    const id = await idea(alice.id, 'My own idea', 'pr_open');
    expect((await post(`/api/community/${id}/vote`, { vote: true }, alice.cookie)).status).toBe(403);
    expect((await community(alice.cookie)).waiting[0]).toMatchObject({ mine: true, votes: 0 });
  });

  it('only allows votes while an idea waits for review', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const live = await idea(alice.id, 'Already live', 'merged');
    const declined = await idea(alice.id, 'Declined', 'declined');
    expect((await post(`/api/community/${live}/vote`, { vote: true }, bob.cookie)).status).toBe(409);
    expect((await post(`/api/community/${declined}/vote`, { vote: true }, bob.cookie)).status).toBe(404);
    expect((await post('/api/community/99999/vote', { vote: true }, bob.cookie)).status).toBe(404);
  });

  it('rejects malformed votes', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const id = await idea(alice.id, 'An idea', 'pr_open');
    expect((await post(`/api/community/${id}/vote`, { vote: 'yes' }, bob.cookie)).status).toBe(400);
    expect((await post('/api/community/abc/vote', { vote: true }, bob.cookie)).status).toBe(400);
  });
});
