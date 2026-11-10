import type { Phase } from '../App';
import { type GameState, type Player, cleanChance, mustBox } from '../game/engine';
import { TYRES, dieFaces, isWorn, tyreLaps } from '../game/tyres';
import { Die3D } from './Die3D';
import { TyreIcon } from './Tyres';

interface RollBarProps {
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

/** The dice roll section along the bottom of the screen: the die, ROLL and BOX (or the overtake call), and what's happening. */
export function RollBar({ state, accent, phase, face, rollId, caption, onRoll, onBox, onOvertake }: RollBarProps) {
  const me = state.players[state.current];
  const faces = dieFaces(me);
  const faceIndex = face ?? state.lastFace ?? 4;
  const racing = state.stage === 'race';
  const choice = phase === 'idle' ? state.overtake : null;
  const canAct = phase === 'idle' && state.tyreQueue.length === 0 && !state.overtake;
  const boxLabel = me.inPit ? 'IN PIT' : mustBox(me) ? 'BOX DUE' : me.boxCalled ? 'CANCEL' : null;

  return (
    <section className="rollbar" aria-label="Dice roll">
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
        <>
          <div className="roll-row">
            <Die3D faces={faces} face={faceIndex} rollId={rollId} rim={me.tyre ? TYRES[me.tyre].color : '#CFCBC0'} />
            <button
              type="button"
              className="roll-btn"
              style={{ background: accent }}
              onClick={onRoll}
              disabled={!(canAct || (phase === 'idle' && state.stage === 'finished'))}
            >
              {phase === 'rolling'
                ? 'ROLLING…'
                : phase === 'moving'
                  ? 'DRIVING…'
                  : state.stage === 'finished'
                    ? 'NEW RACE'
                    : state.stage === 'grid'
                      ? 'LIGHTS OUT'
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
          <div className="rollbar__info">
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
          </div>
        </>
      )}
    </section>
  );
}
