import { lazy, Suspense, useState } from 'react';
import { type Account, signOut } from '../account';
import { TOTAL_LAPS } from '../game/board';
import { MAP_VIEWBOX, TRACK_PATH } from '../game/track';
import { type Theme, applyTheme, readTheme } from '../theme';
import { type AuthMode, AuthDialog } from './Account';
import { Community } from './Community';
import { PitWallChat } from './PitWallChat';
import { FilmTeaser } from './FilmTeaser';

const ProductFilm = lazy(() => import('./ProductFilm'));

/** The first screen: start (or resume) the race, sign in, the Pit Wall for suggesting changes, and the community. */
export function Home({
  accent,
  raceStarted,
  onPlay,
  account,
  onAccountChange,
}: {
  accent: string;
  /** A race is under way, so the play button resumes it. */
  raceStarted: boolean;
  onPlay: () => void;
  /** The signed-in player (null: signed out; undefined: still checking). */
  account: Account | null | undefined;
  onAccountChange: (a: Account | null) => void;
}) {
  const [auth, setAuth] = useState<AuthMode | null>(null);
  const [panel, setPanel] = useState<'pitwall' | 'community' | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [filmOpen, setFilmOpen] = useState(false);
  const switchTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  };
  const { x, y, w, h } = MAP_VIEWBOX;

  return (
    <main className="home" style={{ ['--accent' as string]: accent }}>
      <div className="home__with-film">
      <section className="home__card" aria-labelledby="home-title">
        <svg className="home__track" viewBox={`${x} ${y} ${w} ${h}`} aria-hidden="true">
          <path d={TRACK_PATH} />
        </svg>
        <span className="eyebrow" style={{ color: accent }}>
          ROUND 1 · ALBERT PARK
        </span>
        <h1 id="home-title" className="home__title">
          Pitwall
        </h1>
        <p className="home__sub">Australian Grand Prix · {TOTAL_LAPS} laps · 3 tyre compounds · 1 mandatory stop</p>

        <button type="button" className="home__play" onClick={onPlay}>
          {raceStarted ? 'RESUME RACE' : 'START RACE'}
        </button>
        <button type="button" className="home__btn" onClick={() => setPanel('pitwall')} aria-expanded={panel === 'pitwall'}>
          PIT WALL · SUGGEST A CHANGE
        </button>
        <button type="button" className="home__btn" onClick={() => setPanel('community')} aria-expanded={panel === 'community'}>
          COMMUNITY · VOTE ON IDEAS
        </button>

        {account === undefined ? null : account ? (
          <div className="home__account">
            <span>
              Signed in as <strong title={account.email}>{account.name}</strong>
            </span>
            <button type="button" className="account__btn" onClick={() => signOut().finally(() => onAccountChange(null))}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="home__account">
            <button type="button" className="account__btn account__btn--primary" onClick={() => setAuth('signin')}>
              Sign in
            </button>
            <button type="button" className="account__btn" onClick={() => setAuth('signup')}>
              Create account
            </button>
          </div>
        )}
        <button type="button" className="home__theme" onClick={switchTheme} aria-pressed={theme === 'light'}>
          {theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        </button>
      </section>
      <FilmTeaser onPlay={() => setFilmOpen(true)} />
      </div>

      {filmOpen && <Suspense fallback={<div className="film-opening" role="status">Opening the film…</div>}>
        <ProductFilm onClose={() => setFilmOpen(false)} />
      </Suspense>}

      {panel === 'pitwall' && (
        <PitWallChat account={account} onSignIn={() => setAuth('signin')} onClose={() => setPanel(null)} />
      )}
      {panel === 'community' && (
        <Community account={account} onSignIn={() => setAuth('signin')} onClose={() => setPanel(null)} />
      )}
      {auth && (
        <AuthDialog
          initialMode={auth}
          onClose={() => setAuth(null)}
          onDone={(a) => {
            setAuth(null);
            onAccountChange(a);
          }}
        />
      )}
    </main>
  );
}
