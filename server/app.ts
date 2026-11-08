import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from './auth';
import type { Db } from './db';

export const SESSION_COOKIE = 'pw_session';
const SESSION_DAYS = 30;
/** Failed sign-ins allowed per email + address before a pause. */
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface User {
  id: number;
  email: string;
  name: string;
}

interface Options {
  /** Send cookies only over HTTPS (on in production). */
  secureCookies: boolean;
  /** Called when a player submits a request, so the agent can start on it right away. */
  onRequest?: () => void;
}

/** Requests a player may send per day (keeps one player from using up the agent). */
export const DAILY_REQUEST_LIMIT = 5;
export const REQUEST_MIN = 10;
export const REQUEST_MAX = 2000;

/** How many recently merged ideas the community page shows. */
export const COMMUNITY_LIVE_LIMIT = 20;

/** An idea as the community page shows it: no emails, no pull request links. */
export interface CommunityIdea {
  id: number;
  text: string;
  status: string;
  reply: string | null;
  player: string;
  votes: number;
  voted: boolean;
  mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlayerRequest {
  id: number;
  text: string;
  status: string;
  reply: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The request's JSON object, or an empty object if it isn't one. */
async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (err) {
    // Not JSON at all: treat as empty. Anything else (e.g. too large) is a real error.
    if (err instanceof SyntaxError) return {};
    throw err;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function validate(body: Record<string, unknown>, needName: boolean): string | null {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!EMAIL.test(email) || email.length > 254) return 'Please enter a valid email address.';
  if (needName && (name.length < 1 || name.length > 30)) return 'Please choose a name of 1–30 characters.';
  if (password.length < 8) return 'Passwords need at least 8 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** The HTTP API. Everything lives under /api; the game's files are served separately. */
export function createApp(db: Db, { secureCookies, onRequest }: Options) {
  const app = new Hono();
  const failedLogins = new Map<string, { count: number; since: number }>();

  async function startSession(c: Context, userId: number) {
    const token = newSessionToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      userId,
      expires.toISOString(),
    ]);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'Lax',
      path: '/',
      expires,
    });
  }

  async function currentUser(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const { rows } = await db.query<User>(
      `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    return rows[0] ?? null;
  }

  app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));

  // Only accept JSON for changes. Browsers can't send JSON to another site
  // without asking first, so this (with SameSite cookies) blocks forged requests.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' && !(c.req.header('content-type') ?? '').includes('application/json')) {
      return c.json({ error: 'Expected JSON.' }, 415);
    }
    await next();
  });

  app.post('/api/signup', async (c) => {
    const body = await readJson(c);
    const problem = validate(body, true);
    if (problem) return c.json({ error: problem }, 400);
    const email = String(body.email).trim().toLowerCase();
    const name = String(body.name).trim();
    const hash = await hashPassword(String(body.password));
    const { rows } = await db.query<User>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id, email, name`,
      [email, name, hash],
    );
    if (!rows[0]) return c.json({ error: 'An account with this email already exists.' }, 409);
    await startSession(c, rows[0].id);
    return c.json({ user: rows[0] }, 201);
  });

  app.post('/api/login', async (c) => {
    const body = await readJson(c);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${c.req.header('x-forwarded-for') ?? 'local'}|${email}`;
    const tries = failedLogins.get(key);
    if (tries && Date.now() - tries.since < LOGIN_WINDOW_MS && tries.count >= MAX_FAILED_LOGINS) {
      return c.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429);
    }

    const { rows } = await db.query<User & { password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email],
    );
    const found = rows[0];
    if (!found || !(await verifyPassword(password, found.password_hash))) {
      const fresh = !tries || Date.now() - tries.since >= LOGIN_WINDOW_MS;
      failedLogins.set(key, fresh ? { count: 1, since: Date.now() } : { ...tries, count: tries.count + 1 });
      // The same message either way, so the form doesn't reveal which emails have accounts.
      return c.json({ error: 'Email or password is incorrect.' }, 401);
    }
    failedLogins.delete(key);
    await startSession(c, found.id);
    return c.json({ user: { id: found.id, email: found.email, name: found.name } });
  });

  app.post('/api/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/me', async (c) => c.json({ user: await currentUser(getCookie(c, SESSION_COOKIE)) }));

  // ---- requests to the Pit Wall agent (signed-in players only) ----

  app.post('/api/requests', async (c) => {
    const user = await currentUser(getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'Please sign in to send a request.' }, 401);
    const body = await readJson(c);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < REQUEST_MIN) return c.json({ error: `Please describe your idea in at least ${REQUEST_MIN} characters.` }, 400);
    if (text.length > REQUEST_MAX) return c.json({ error: `Please keep it under ${REQUEST_MAX} characters.` }, 400);
    const { rows: today } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM requests WHERE user_id = $1 AND created_at > now() - interval '1 day'`,
      [user.id],
    );
    if (today[0].n >= DAILY_REQUEST_LIMIT) {
      return c.json({ error: `You can send ${DAILY_REQUEST_LIMIT} requests a day. Please try again tomorrow.` }, 429);
    }
    const { rows } = await db.query<PlayerRequest>(
      `INSERT INTO requests (user_id, text) VALUES ($1, $2)
       RETURNING id, text, status, reply, pr_url, created_at, updated_at`,
      [user.id, text],
    );
    onRequest?.();
    return c.json({ request: rows[0] }, 201);
  });

  app.get('/api/requests', async (c) => {
    const user = await currentUser(getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'Please sign in.' }, 401);
    const { rows } = await db.query<PlayerRequest>(
      `SELECT id, text, status, reply, pr_url, created_at, updated_at FROM requests
       WHERE user_id = $1 ORDER BY id DESC LIMIT 50`,
      [user.id],
    );
    return c.json({ requests: rows });
  });

  // ---- community: ideas the agent has turned into a change, and votes ----

  // Only ideas that became a proposed or merged change are public; declined,
  // failed or unanswered ones never appear.
  app.get('/api/community', async (c) => {
    const user = await currentUser(getCookie(c, SESSION_COOKIE));
    const { rows } = await db.query<CommunityIdea>(
      `SELECT r.id, r.text, r.status, r.reply, r.created_at, r.updated_at, u.name AS player,
              (SELECT count(*)::int FROM votes v WHERE v.request_id = r.id) AS votes,
              EXISTS (SELECT 1 FROM votes v WHERE v.request_id = r.id AND v.user_id = $1) AS voted,
              COALESCE(r.user_id = $1, false) AS mine
       FROM requests r JOIN users u ON u.id = r.user_id
       WHERE r.status IN ('pr_open', 'merged')
       ORDER BY r.id`,
      [user?.id ?? null],
    );
    const waiting = rows
      .filter((r) => r.status === 'pr_open')
      .sort((a, b) => b.votes - a.votes || a.id - b.id);
    const live = rows
      .filter((r) => r.status === 'merged')
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, COMMUNITY_LIVE_LIMIT);
    return c.json({ waiting, live, signedIn: Boolean(user) });
  });

  app.post('/api/community/:id/vote', async (c) => {
    const user = await currentUser(getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'Please sign in to vote.' }, 401);
    const id = Number(c.req.param('id'));
    const body = await readJson(c);
    if (!Number.isInteger(id) || typeof body.vote !== 'boolean') return c.json({ error: 'Bad vote.' }, 400);
    const { rows } = await db.query<{ user_id: number; status: string }>(
      'SELECT user_id, status FROM requests WHERE id = $1',
      [id],
    );
    const idea = rows[0];
    if (!idea || !['pr_open', 'merged'].includes(idea.status)) return c.json({ error: 'Idea not found.' }, 404);
    if (idea.status !== 'pr_open') return c.json({ error: 'Voting is only open while an idea waits for review.' }, 409);
    if (idea.user_id === user.id) return c.json({ error: "You can't vote for your own idea." }, 403);
    if (body.vote) {
      await db.query('INSERT INTO votes (request_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, user.id]);
    } else {
      await db.query('DELETE FROM votes WHERE request_id = $1 AND user_id = $2', [id, user.id]);
    }
    const { rows: count } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM votes WHERE request_id = $1', [id]);
    return c.json({ votes: count[0].n, voted: body.vote });
  });

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.text('Not found', 404)));

  return app;
}
