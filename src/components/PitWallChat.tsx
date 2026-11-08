import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type { Account } from '../account';

// "Pit Wall": where players suggest changes to the game. Requests go to the
// Pit Wall agent; answers usually arrive within an hour or two, so players
// don't wait here: they see the reply next time they open it.

interface PlayerRequest {
  id: number;
  text: string;
  status: string;
  reply: string | null;
  created_at: string;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: 'In the queue', tone: 'wait' },
  working: { label: 'The agent is on it', tone: 'wait' },
  answered: { label: 'Answered', tone: 'done' },
  pr_open: { label: 'With the team for review', tone: 'review' },
  merged: { label: 'Live in the game', tone: 'done' },
  rejected: { label: 'Not going ahead', tone: 'no' },
  declined: { label: 'Declined', tone: 'no' },
  failed: { label: 'Something went wrong', tone: 'no' },
};

const MIN = 10;
const MAX = 2000;
const REFRESH_MS = 30_000;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.');
  return data;
}

/** The Pit Wall panel, opened from the home page. */
export function PitWallChat({
  account,
  onSignIn,
  onClose,
}: {
  account: Account | null | undefined;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [requests, setRequests] = useState<PlayerRequest[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      setRequests((await api<{ requests: PlayerRequest[] }>('/api/requests')).requests);
    } catch {
      // Keep what we have; the next refresh will try again.
    }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [account, refresh]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/requests', { text });
      setText('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const waiting = requests.some((r) => r.status === 'queued' || r.status === 'working');

  return (
    <section className="pitwall" aria-labelledby="pitwall-title">
      <header className="pitwall__head">
        <h2 id="pitwall-title" className="pitwall__title">
          Pit Wall
        </h2>
        <button type="button" className="pitwall__close" onClick={onClose} aria-label="Close Pit Wall">
          ×
        </button>
      </header>
      <p className="pitwall__lead">
        Tell us what you'd change about Pitwall. Our AI pit crew reads every idea, makes the good ones, and the team
        reviews each change before it goes live. You'll usually get an answer within an hour or two.
      </p>

      {account === null ? (
        <div className="pitwall__signin">
          <p>Sign in to suggest a change and follow your ideas.</p>
          <button type="button" className="pitwall__send" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      ) : (
        <>
          <form className="pitwall__form" onSubmit={send}>
            <label htmlFor="pitwall-text" className="pitwall__label">
              Your idea
            </label>
            <textarea
              id="pitwall-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. The Safety Car comes out too often. Could it be rarer?"
              rows={4}
              maxLength={MAX}
            />
            <div className="pitwall__row">
              <span className="pitwall__count">
                {text.trim().length}/{MAX}
              </span>
              <button type="submit" className="pitwall__send" disabled={busy || text.trim().length < MIN}>
                {busy ? 'Sending…' : 'Send to the Pit Wall'}
              </button>
            </div>
            {error && (
              <p className="pitwall__error" role="alert">
                {error}
              </p>
            )}
            <p className="pitwall__public">
              If our pit crew builds your idea, it appears on the Community page with your name, so other players can
              vote for it. Ideas that aren't taken up stay private.
            </p>
          </form>

          <h3 className="pitwall__subtitle">Your ideas</h3>
          {requests.length === 0 ? (
            <p className="pitwall__empty">Nothing yet. Your first idea could be the next change in the game.</p>
          ) : (
            <ol className="pitwall__list" aria-live="polite">
              {requests.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, tone: 'wait' };
                return (
                  <li key={r.id} className="pitwall__item">
                    <div className="pitwall__meta">
                      <span className={`pitwall__status pitwall__status--${s.tone}`}>{s.label}</span>
                      <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString()}</time>
                    </div>
                    <p className="pitwall__text">{r.text}</p>
                    {r.reply && <p className="pitwall__reply">{r.reply}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          {waiting && <p className="pitwall__note">Answers appear here automatically. Feel free to keep racing.</p>}
        </>
      )}
    </section>
  );
}
