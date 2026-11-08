import { useCallback, useEffect, useState } from 'react';
import type { Account } from '../account';

// The community page: ideas the Pit Wall agent has already built on their own
// branch (nothing reaches the game until the team approves), sorted by votes
// so the most wanted ones get reviewed first, plus what recently went live.

interface Idea {
  id: number;
  text: string;
  reply: string | null;
  player: string;
  votes: number;
  voted: boolean;
  mine: boolean;
  updated_at: string;
}

interface CommunityData {
  waiting: Idea[];
  live: Idea[];
}

const REFRESH_MS = 30_000;

async function load(): Promise<CommunityData> {
  const res = await fetch('/api/community', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not load the community page.');
  return (await res.json()) as CommunityData;
}

async function sendVote(id: number, vote: boolean) {
  const res = await fetch(`/api/community/${id}/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vote }),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as { votes?: number; voted?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Could not save your vote.');
  return data as { votes: number; voted: boolean };
}

function VoteButton({ idea, account, onSignIn, onVoted }: {
  idea: Idea;
  account: Account | null | undefined;
  onSignIn: () => void;
  onVoted: (id: number, votes: number, voted: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const label = `${idea.votes} vote${idea.votes === 1 ? '' : 's'}`;
  if (idea.mine) {
    return (
      <span className="vote vote--mine" title="Your idea">
        <span className="vote__count">{idea.votes}</span>
        <span className="vote__label">your idea</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`vote ${idea.voted ? 'vote--on' : ''}`}
      aria-pressed={idea.voted}
      aria-label={idea.voted ? `Remove your vote (${label})` : `Vote for this idea (${label})`}
      disabled={busy}
      onClick={async () => {
        if (!account) return onSignIn();
        setBusy(true);
        try {
          const r = await sendVote(idea.id, !idea.voted);
          onVoted(idea.id, r.votes, r.voted);
        } catch {
          // Leave it as it was; the next refresh shows the real count.
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 15l6-6 6 6" />
      </svg>
      <span className="vote__count">{idea.votes}</span>
      <span className="vote__label">{idea.voted ? 'voted' : 'vote'}</span>
    </button>
  );
}

export function Community({ account, onSignIn, onClose }: {
  account: Account | null | undefined;
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<CommunityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Reload when the player signs in or out (their votes change), and every so often.
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, account]);

  const onVoted = (id: number, votes: number, voted: boolean) =>
    setData((d) =>
      d && {
        ...d,
        waiting: d.waiting
          .map((i) => (i.id === id ? { ...i, votes, voted } : i))
          .sort((a, b) => b.votes - a.votes || a.id - b.id),
      },
    );

  return (
    <section className="community" aria-labelledby="community-title">
      <header className="community__head">
        <div>
          <h2 id="community-title" className="community__title">
            Community
          </h2>
          <p className="community__lead">
            Ideas from players that our AI pit crew has already built. Nothing goes live until the team approves it,
            and the most-voted ideas get reviewed first.
          </p>
        </div>
        <button type="button" className="pitwall__close" onClick={onClose} aria-label="Close community">
          ×
        </button>
      </header>

      {account === null && (
        <p className="community__note">
          <button type="button" className="community__link" onClick={onSignIn}>
            Sign in
          </button>{' '}
          to vote for the ideas you want most.
        </p>
      )}
      {error && (
        <p className="pitwall__error" role="alert">
          {error}
        </p>
      )}

      <h3 className="pitwall__subtitle">Waiting for review · most wanted first</h3>
      {!data ? (
        <p className="pitwall__empty">Loading…</p>
      ) : data.waiting.length === 0 ? (
        <p className="pitwall__empty">No ideas are waiting right now. Suggest one from the Pit Wall.</p>
      ) : (
        <ol className="community__list">
          {data.waiting.map((idea) => (
            <li key={idea.id} className="community__item">
              <VoteButton idea={idea} account={account} onSignIn={onSignIn} onVoted={onVoted} />
              <div className="community__body">
                <p className="pitwall__text">{idea.text}</p>
                <span className="community__by">Suggested by {idea.player}</span>
                {idea.reply && <p className="pitwall__reply">{idea.reply}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {data && data.live.length > 0 && (
        <>
          <h3 className="pitwall__subtitle">Live in the game</h3>
          <ul className="community__list community__list--live">
            {data.live.map((idea) => (
              <li key={idea.id} className="community__item community__item--live">
                <span className="pitwall__status pitwall__status--done">Live</span>
                <div className="community__body">
                  <p className="pitwall__text">{idea.text}</p>
                  <span className="community__by">Suggested by {idea.player}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
