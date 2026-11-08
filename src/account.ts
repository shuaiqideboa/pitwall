import { useEffect, useState } from 'react';

// Player accounts, talking to the server's /api (see server/app.ts).

export interface Account {
  id: number;
  email: string;
  name: string;
}

async function call(path: string, body?: unknown): Promise<{ user: Account | null }> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { user?: Account | null; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return { user: data.user ?? null };
}

export const signUp = (email: string, name: string, password: string) => call('/api/signup', { email, name, password });
export const signIn = (email: string, password: string) => call('/api/login', { email, password });
export const signOut = () => call('/api/logout', {});

/** The signed-in player (null when signed out; undefined while checking). */
export function useAccount() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  useEffect(() => {
    call('/api/me')
      .then(({ user }) => setAccount(user))
      .catch(() => setAccount(null)); // no server (e.g. plain `vite` dev): just play signed out
  }, []);
  return [account, setAccount] as const;
}
