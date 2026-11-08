import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '../game/config';

// Cube sides in face-index order (0–5), and the cube rotation that brings
// each side to the front.
const SIDES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;

const FRONT_ROTATION: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0, y: 180 },
  { x: 0, y: -90 },
  { x: 0, y: 90 },
  { x: -90, y: 0 },
  { x: 90, y: 0 },
];

export const DIE_ROLL_MS = GAME_CONFIG.pacing.dieRollMs;

/** Smallest angle ≥ `from + minTurns·360` that is congruent to `target` mod 360. */
function spinTo(from: number, target: number, minTurns: number) {
  const floor = from + minTurns * 360;
  return target + Math.ceil((floor - target) / 360) * 360;
}

interface DieProps {
  /** The six numbers on this die (a tyre compound's faces). */
  faces: number[];
  /** Index of the face that is up. */
  face: number;
  /** Bumped for every roll; each bump tosses the die again. */
  rollId: number;
  /** Sidewall color of the tyre the die belongs to. */
  rim: string;
}

export function Die3D({ faces, face, rollId, rim }: DieProps) {
  const [rot, setRot] = useState(() => FRONT_ROTATION[face]);
  const lastRoll = useRef(rollId);

  useEffect(() => {
    if (rollId === lastRoll.current) return;
    lastRoll.current = rollId;
    const target = FRONT_ROTATION[face];
    // A few full turns on both axes, plus a random extra so no two tosses look alike.
    setRot((prev) => ({
      x: spinTo(prev.x, target.x, 2 + Math.floor(Math.random() * 2)),
      y: spinTo(prev.y, target.y, 3 + Math.floor(Math.random() * 2)),
    }));
  }, [rollId, face]);

  const tossing = rollId > 0;
  const style = {
    '--rx': `${rot.x}deg`,
    '--ry': `${rot.y}deg`,
    '--roll-ms': `${DIE_ROLL_MS}ms`,
    '--rim': rim,
  } as CSSProperties;

  return (
    <div className="die3d" role="img" aria-label={`Die showing ${faces[face]}`} style={style}>
      <span key={`shadow-${rollId}`} className={`die3d__shadow ${tossing ? 'is-tossing' : ''}`} />
      <div key={`toss-${rollId}`} className={`die3d__toss ${tossing ? 'is-tossing' : ''}`}>
        <div className="die3d__cube">
          {SIDES.map((side, i) => (
            <div key={side} className={`die3d__face die3d__face--${side}`}>
              <span className="die3d__num">{faces[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
