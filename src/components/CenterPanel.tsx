import { SECTOR_COLORS, TOTAL_LAPS, TRACK_LENGTH } from '../game/board';
import type { Phase } from '../App';
import { type GameState, type Player, lapOf, mustBox, raceOrder } from '../game/engine';
import { isWorn } from '../game/tyres';
import { TyreIcon } from './Tyres';

interface CenterPanelProps {
  state: GameState;
  accent: string;
  phase: Phase;
  /** Back to the home page (the race waits there). */
  onHome: () => void;
}

function StatusTag({ p }: { p: Player }) {
  if (p.inPit) return <span className="order__tag order__tag--pit">PIT</span>;
  if (mustBox(p)) return <span className="order__tag order__tag--warn">BOX DUE</span>;
  if (p.boxCalled) return <span className="order__tag order__tag--warn">BOX</span>;
  if (p.stops > 0) return <span className="order__tag">{p.stops} STOP</span>;
  return null;
}

/** The game's side panel: the race, the lap count and the race order. */
export function CenterPanel({ state, accent, phase, onHome }: CenterPanelProps) {
  // Whose turn it is: in the race, or to roll for the start once everyone has tyres.
  const onTurn = state.stage === 'race' || (state.stage === 'grid' && state.tyreQueue.length === 0);

  const order = raceOrder(state.players);
  const leader = order[0];
  const leaderLap = Math.min(lapOf(leader) + 1, TOTAL_LAPS);

  const gapLabel = (i: number) => {
    const p = order[i];
    if (i === 0) return `L${Math.min(lapOf(p) + 1, TOTAL_LAPS)}`;
    const gap = leader.progress - p.progress;
    if (gap >= TRACK_LENGTH) {
      const laps = Math.floor(gap / TRACK_LENGTH);
      return `+${laps} lap${laps > 1 ? 's' : ''}`;
    }
    return `+${gap}`;
  };

  return (
    <aside className="panel">
      <div className="panel__heading">
        <div className="panel__topline">
          <span className="eyebrow" style={{ color: accent }}>
            ROUND 1 · ALBERT PARK
          </span>
          <button type="button" className="account__btn" onClick={onHome} disabled={phase !== 'idle'}>
            HOME
          </button>
        </div>
        <h1 className="panel__title">Australian Grand Prix</h1>
        <span className="panel__sub">5 laps · 3 tyre compounds · 1 mandatory stop</span>
      </div>

      <div className="lap-box">
        <span className="lap-box__label">
          LAP {leaderLap} / {TOTAL_LAPS}
        </span>
        {state.scUntilLap !== null && (
          <span className="flag-chip" title="Safety Car: max 3 blocks a turn, no overtaking, quick pit stops. In when the leader crosses the line.">
            SAFETY CAR
          </span>
        )}
        <div className="lights">
          {Array.from({ length: TOTAL_LAPS }, (_, i) => (
            <span
              key={i}
              className="light"
              style={i < leaderLap ? { background: accent, boxShadow: `0 0 10px ${accent}` } : undefined}
            />
          ))}
        </div>
      </div>

      <div className="order">
        <div className="order__head">
          <span className="order__label">RACE ORDER</span>
          <div className="legend">
            {([1, 2, 3] as const).map((s) => (
              <span key={s} className="legend__row">
                <span className="legend__swatch" style={{ background: SECTOR_COLORS[s] }} />S{s}
              </span>
            ))}
            <span className="legend__row">
              <span className="legend__swatch legend__swatch--drs" />
              DRS
            </span>
          </div>
        </div>
        {order.map((p, i) => (
          <div key={p.id} className={`order__row ${i === 0 ? 'order__row--lead' : ''}`}>
            <span className="order__pos">P{i + 1}</span>
            <span className="order__dot" style={{ background: p.color }} />
            <span className="order__name">
              {p.name}
              {state.current === p.id && onTurn ? ' ◂' : ''}
            </span>
            {p.tyre && <TyreIcon compound={p.tyre} size={18} worn={isWorn(p)} />}
            <StatusTag p={p} />
            <div className="order__laps">
              {Array.from({ length: TOTAL_LAPS }, (_, l) => (
                <span key={l} className={l < lapOf(p) ? 'on' : ''} />
              ))}
            </div>
            <span className="order__gap">{gapLabel(i)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
