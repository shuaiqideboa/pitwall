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
  it('signs up, starts a session, and knows who you are', async () => {
    const res = await post('/api/signup', alice);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(body.user).not.toHaveProperty('password_hash');
    expect((await me(sessionCookie(res))).user).toMatchObject({ name: 'Alice' });
  });

  it('sets a cookie scripts cannot read, sent only over HTTPS', async () => {
    const header = (await post('/api/signup', alice)).headers.get('set-cookie') ?? '';
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });

  it('never stores the password or the session token itself', async () => {
    const res = await post('/api/signup', alice);
    const token = sessionCookie(res).split('=')[1];
    const { rows: users } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users');
    expect(users[0].password_hash).not.toContain(alice.password);
    expect(users[0].password_hash).toMatch(/^scrypt\$/);
    const { rows: sessions } = await db.query<{ token_hash: string }>('SELECT token_hash FROM sessions');
    expect(sessions[0].token_hash).not.toBe(token);
  });

  it('refuses a second account with the same email, whatever the case', async () => {
    await post('/api/signup', alice);
    const res = await post('/api/signup', { ...alice, email: 'ALICE@example.com' });
    expect(res.status).toBe(409);
  });

  it('checks the details on sign-up', async () => {
    expect((await post('/api/signup', { ...alice, email: 'not-an-email' })).status).toBe(400);
    expect((await post('/api/signup', { ...alice, password: 'short' })).status).toBe(400);
    expect((await post('/api/signup', { ...alice, name: '   ' })).status).toBe(400);
    expect((await post('/api/signup', 'just a string')).status).toBe(400);
  });

  it('signs in with the right password only, without revealing which part was wrong', async () => {
    await post('/api/signup', alice);
    const wrong = await post('/api/login', { email: alice.email, password: 'wrong password' });
    const nobody = await post('/api/login', { email: 'nobody@example.com', password: 'whatever123' });
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(await wrong.json()).toEqual(await nobody.json());

    const right = await post('/api/login', { email: 'alice@example.com', password: alice.password });
    expect(right.status).toBe(200);
    expect((await me(sessionCookie(right))).user).toMatchObject({ name: 'Alice' });
  });

  it('signs out, and the old cookie stops working', async () => {
    const cookie = sessionCookie(await post('/api/signup', alice));
    await post('/api/logout', {}, cookie);
    expect((await me(cookie)).user).toBeNull();
  });

  it('pauses sign-in after too many wrong passwords', async () => {
    await post('/api/signup', alice);
    for (let i = 0; i < 10; i++) await post('/api/login', { email: alice.email, password: 'nope-nope' });
    const res = await post('/api/login', { email: alice.email, password: alice.password });
    expect(res.status).toBe(429);
  });

  it('only accepts JSON, which blocks forged form posts from other sites', async () => {
    const res = await app.request('/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a@b.co&name=A&password=12345678',
    });
    expect(res.status).toBe(415);
  });

  it('answers unknown API addresses with 404', async () => {
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('turns away oversized requests', async () => {
    const res = await post('/api/signup', { ...alice, name: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
  });
});
