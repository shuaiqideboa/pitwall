import { SECTOR_COLORS, TOTAL_LAPS, TRACK_LENGTH } from '../game/board';
import type { Phase } from '../App';
import { type GameState, type Player, cleanChance, lapOf, mustBox, raceOrder } from '../game/engine';
import { TYRES, dieFaces, isWorn, tyreLaps } from '../game/tyres';
import { Die3D } from './Die3D';
import { TyreIcon } from './Tyres';

interface CenterPanelProps {
  state: GameState;
  accent: string;
  phase: Phase;
  /** Index of the die face being rolled (set while the die is tossed). */
  face: number | null;
  /** Increments on every roll to toss the die. */
  rollId: number;
  /** Live description of the move being animated. */
  caption: string | null;
  onRoll: () => void;
  onBox: () => void;
  onOvertake: (go: boolean) => void;
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

function tyreSummary(p: Player) {
  if (!p.tyre) return '';
  const spec = TYRES[p.tyre];
  if (isWorn(p)) return 'WORN, box soon';
  if (spec.lifeLaps === null) return 'never wear';
  return `${Math.max(0, spec.lifeLaps - tyreLaps(p)).toFixed(1)} laps left`;
}

const captionTone = (caption: string) =>
  /RED FLAG/.test(caption)
    ? 'caption--red'
    : /SAFETY CAR/.test(caption)
      ? 'caption--sc'
      : /overtakes/.test(caption)
        ? 'caption--clean'
        : '';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The game's side panel: race order, die and controls, and the overtake call. */
export function CenterPanel({
  state,
  accent,
  phase,
  face,
  rollId,
  caption,
  onRoll,
  onBox,
  onOvertake,
  onHome,
}: CenterPanelProps) {
  const me = state.players[state.current];
  const faces = dieFaces(me);
  const faceIndex = face ?? state.lastFace ?? 4;
  const racing = state.stage === 'race';
  const choice = phase === 'idle' ? state.overtake : null;
  const canAct = phase === 'idle' && state.tyreQueue.length === 0 && !state.overtake;

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

  const boxLabel = me.inPit ? 'IN PIT' : mustBox(me) ? 'BOX DUE' : me.boxCalled ? 'CANCEL' : null;

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
              {state.current === p.id && racing ? ' ◂' : ''}
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

      {choice ? (
        <div className={`overtake ${choice.drs ? 'overtake--drs' : ''}`} role="group" aria-labelledby="overtake-title">
          <div className="overtake__head">
            <span className="order__dot" style={{ background: state.players[choice.id].color }} />
            <h2 id="overtake-title" className="overtake__title">
              Overtake {choice.rivals.map((id) => state.players[id].name).join(' and ')}?
            </h2>
            {choice.drs && <span className="drs-chip">DRS</span>}
          </div>
          <div className="odds" aria-label="Chances for this overtake">
            <span className="odds__clean">Clean pass {pct(cleanChance(choice.risk))}</span>
            <span className="odds__sc">Safety Car {pct(choice.risk['safety-car'])}</span>
            <span className="odds__red">Red flag {pct(choice.risk['red-flag'])}</span>
          </div>
          <p className="overtake__note">
            A clean pass uses 2 of your remaining {choice.turn.budget} blocks. If it goes wrong you stay behind, and the
            incident affects everyone.
          </p>
          <div className="overtake__actions">
            <button type="button" className="overtake__go" style={{ background: accent }} onClick={() => onOvertake(true)}>
              OVERTAKE
            </button>
            <button type="button" className="overtake__stay" onClick={() => onOvertake(false)}>
              STAY BEHIND
            </button>
          </div>
        </div>
      ) : (
        <div className="roll-row">
          <Die3D faces={faces} face={faceIndex} rollId={rollId} rim={me.tyre ? TYRES[me.tyre].color : '#CFCBC0'} />
          <button
            type="button"
            className="roll-btn"
            style={{ background: accent }}
            onClick={onRoll}
            disabled={!(canAct || (phase === 'idle' && state.stage === 'finished')) || state.stage === 'grid'}
          >
            {phase === 'rolling'
              ? 'ROLLING…'
              : phase === 'moving'
                ? 'DRIVING…'
                : state.stage === 'finished'
                  ? 'NEW RACE'
                  : 'ROLL'}
          </button>
          <button
            type="button"
            className={`box-btn ${me.boxCalled || mustBox(me) ? 'box-btn--called' : ''}`}
            onClick={onBox}
            disabled={!canAct || !racing || me.inPit || mustBox(me)}
            aria-pressed={me.boxCalled}
            title={
              me.inPit
                ? 'Already in the pit lane'
                : mustBox(me)
                  ? 'Mandatory stop: you will be called in at the pit entry'
                  : 'Take the pit entry next time you pass it'
            }
          >
            {boxLabel ?? (
              <>
                BOX
                <br />
                BOX
              </>
            )}
          </button>
        </div>
      )}

      {me.tyre && racing && (
        <div className="tyre-line">
          <TyreIcon compound={me.tyre} size={22} worn={isWorn(me)} />
          <span>
            <strong>{TYRES[me.tyre].name}s</strong> · {tyreSummary(me)}
            {me.stops === 0 ? ' · no stop yet' : ''}
          </span>
          <span className="tyre-line__faces">{faces.join(' ')}</span>
        </div>
      )}
      <span className="status" aria-live="polite">
        {phase === 'rolling' ? `${me.name} is rolling…` : phase === 'moving' && face !== null ? `${me.name} rolled ${faces[faceIndex]}` : state.log}
      </span>
      {phase === 'moving' && caption && (
        <span key={caption} className={`caption ${captionTone(caption)}`}>
          {caption}
        </span>
      )}
    </aside>
  );
}
