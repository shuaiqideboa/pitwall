import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Passwords are stored only as salted scrypt hashes: "scrypt$N$r$p$salt$hash".
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A random session token for the cookie; only its hash is stored. */
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
