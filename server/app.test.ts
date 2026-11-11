import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, createApp } from './app';
import { type Db, connect, migrate } from './db';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await connect(); // fresh in-memory Postgres per test
  await migrate(db);
  app = createApp(db, { secureCookies: true });
});
afterEach(() => db.close());

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const me = async (cookie?: string) =>
  (await (await app.request('/api/me', { headers: cookie ? { cookie } : {} })).json()) as { user: unknown };

/** The `name=value` part of the session cookie a response set. */
const sessionCookie = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

const alice = { email: 'Alice@Example.com', name: 'Alice', password: 'correct horse' };

describe('accounts', () => {
  it('creates one account with a secure session and stores neither password nor token in plaintext', async () => {
    const res = await post('/api/signup', alice);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(body.user).not.toHaveProperty('password_hash');
    expect((await me(sessionCookie(res))).user).toMatchObject({ name: 'Alice' });
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Lax/i);
    const token = sessionCookie(res).split('=')[1];
    const { rows: users } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users');
    expect(users[0].password_hash).not.toContain(alice.password);
    const { rows: sessions } = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(sessions[0].token_hash).not.toBe(token);
    expect((await post('/api/signup', { ...alice, email: 'ALICE@example.com' })).status).toBe(409);
  });

  it('checks the details on sign-up', async () => {
    expect((await post('/api/signup', { ...alice, email: 'not-an-email' })).status).toBe(400);
    expect((await post('/api/signup', { ...alice, password: 'short' })).status).toBe(400);
    expect((await post('/api/signup', { ...alice, name: '   ' })).status).toBe(400);
    expect((await post('/api/signup', 'just a string')).status).toBe(400);
  });

  it('authenticates without leaking account existence, then invalidates the session on logout', async () => {
    await post('/api/signup', alice);
    const wrong = await post('/api/login', { email: alice.email, password: 'wrong password' });
    const nobody = await post('/api/login', { email: 'nobody@example.com', password: 'whatever123' });
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(await wrong.json()).toEqual(await nobody.json());

    const right = await post('/api/login', { email: 'alice@example.com', password: alice.password });
    expect(right.status).toBe(200);
    const cookie = sessionCookie(right);
    expect((await me(cookie)).user).toMatchObject({ name: 'Alice' });
    await post('/api/logout', {}, cookie);
    expect((await me(cookie)).user).toBeNull();
  });

  it('pauses sign-in after too many wrong passwords', async () => {
    await post('/api/signup', alice);
    for (let i = 0; i < 10; i++) await post('/api/login', { email: alice.email, password: 'nope-nope' });
    const res = await post('/api/login', { email: alice.email, password: alice.password });
    expect(res.status).toBe(429);
  });

  it('rejects form posts and oversized JSON at the API boundary', async () => {
    const res = await app.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a@b.co&name=A&password=12345678',
    });
    expect(res.status).toBe(415);
    expect((await post('/api/signup', { ...alice, name: 'x'.repeat(20_000) })).status).toBe(413);
  });
});
