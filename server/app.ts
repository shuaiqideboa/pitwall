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
export function createApp(db: Db, { secureCookies }: Options) {
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

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.text('Not found', 404)));

  return app;
}
