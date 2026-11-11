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

describe('community', () => {
  it('publicly shows only proposed or shipped ideas without emails or PR links', async () => {
    const alice = await player('Alice');
    await idea(alice.id, 'Waiting for review', 'pr_open');
    await idea(alice.id, 'Already live', 'merged');
    for (const status of ['queued', 'working', 'answered', 'declined', 'failed', 'rejected']) {
      await idea(alice.id, `Hidden ${status}`, status);
    }
    const page = await community();
    expect(page.signedIn).toBe(false);
    expect(page.waiting.map((i) => i.text)).toEqual(['Waiting for review']);
    expect(page.live.map((i) => i.text)).toEqual(['Already live']);
    expect(page.waiting[0]).toMatchObject({ player: 'Alice', mine: false, voted: false });
    expect(JSON.stringify(page)).not.toContain('@example.com');
    expect(JSON.stringify(page)).not.toContain('github.com');
  });

  it('ranks ideas by unique votes and supports withdrawing a vote', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const cara = await player('Cara');
    const few = await idea(alice.id, 'Fewer votes', 'pr_open');
    const many = await idea(alice.id, 'More votes', 'pr_open');
    await post(`/api/community/${many}/vote`, { vote: true }, bob.cookie);
    const repeated = await post(`/api/community/${many}/vote`, { vote: true }, bob.cookie);
    expect(await repeated.json()).toEqual({ votes: 1, voted: true });
    await post(`/api/community/${many}/vote`, { vote: true }, cara.cookie);
    await post(`/api/community/${few}/vote`, { vote: true }, bob.cookie);
    const page = await community(bob.cookie);
    expect(page.waiting.map((i) => [i.text, i.votes, i.voted])).toEqual([
      ['More votes', 2, true],
      ['Fewer votes', 1, true],
    ]);
    const undo = await post(`/api/community/${few}/vote`, { vote: false }, bob.cookie);
    expect(await undo.json()).toEqual({ votes: 0, voted: false });
  });

  it('rejects unauthenticated, self, closed, hidden and malformed votes', async () => {
    const alice = await player('Alice');
    const bob = await player('Bob');
    const open = await idea(alice.id, 'My own idea', 'pr_open');
    const live = await idea(alice.id, 'Already live', 'merged');
    const declined = await idea(alice.id, 'Declined', 'declined');
    const cases = [
      { label: 'signed out', id: open, vote: true, cookie: undefined, status: 401 },
      { label: 'own idea', id: open, vote: true, cookie: alice.cookie, status: 403 },
      { label: 'merged', id: live, vote: true, cookie: bob.cookie, status: 409 },
      { label: 'hidden', id: declined, vote: true, cookie: bob.cookie, status: 404 },
      { label: 'missing', id: 99999, vote: true, cookie: bob.cookie, status: 404 },
      { label: 'invalid vote', id: open, vote: 'yes', cookie: bob.cookie, status: 400 },
      { label: 'invalid id', id: 'abc', vote: true, cookie: bob.cookie, status: 400 },
    ];
    for (const test of cases) {
      expect.soft((await post(`/api/community/${test.id}/vote`, { vote: test.vote }, test.cookie)).status, test.label).toBe(test.status);
    }
    expect((await community(alice.cookie)).waiting[0]).toMatchObject({ mine: true, votes: 0 });
  });
});
