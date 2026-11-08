import { TRACK_LENGTH } from './board';

export type Compound = 'soft' | 'medium' | 'hard';

export interface TyreSpec {
  name: string;
  letter: string;
  /** Sidewall color: red, yellow, white. */
  color: string;
  /** The six faces of this compound's die. */
  faces: number[];
  /** Faces once the set is worn out; null for a set that never wears. */
  wornFaces: number[] | null;
  /** Laps a set lasts before it is worn. */
  lifeLaps: number;
  blurb: string;
}

// Softs are fastest but fall off a cliff after one lap, so they need extra
// stops; mediums last most of the race; hards are steady and never wear.
// Tuned by simulating fixed strategies through the pit lane: softs every
// lap, soft→hard, medium→medium and hard→late softs each win ~38–41% of
// four-car races; never boxing (so being called in on the last lap) ~0%.
export const TYRES: Record<Compound, TyreSpec> = {
  soft: {
    name: 'Soft',
    letter: 'S',
    color: '#D7261E',
    faces: [3, 4, 5, 6, 6, 7],
    wornFaces: [1, 1, 2, 2, 3, 3],
    lifeLaps: 1,
    blurb: 'Fastest. Worn after 1 lap.',
  },
  medium: {
    name: 'Medium',
    letter: 'M',
    color: '#F2C230',
    faces: [2, 3, 4, 5, 5, 6],
    wornFaces: [1, 2, 2, 3, 3, 4],
    lifeLaps: 3,
    blurb: 'Balanced. Worn after 3 laps.',
  },
  hard: {
    name: 'Hard',
    letter: 'H',
    color: '#F3F0E8',
    faces: [3, 3, 4, 4, 5, 5],
    wornFaces: null,
    lifeLaps: Infinity,
    blurb: 'Slowest. Never wears out.',
  },
};

export const COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];

export interface TyreState {
  tyre: Compound | null;
  /** Progress when the current set was fitted. */
  fittedAt: number;
}

/** Laps driven on the current set (fractional). */
export const tyreLaps = (p: TyreState & { progress: number }) => (p.progress - p.fittedAt) / TRACK_LENGTH;

export const isWorn = (p: TyreState & { progress: number }) =>
  p.tyre !== null && TYRES[p.tyre].wornFaces !== null && tyreLaps(p) >= TYRES[p.tyre].lifeLaps;

/** The die this car rolls right now. */
export function dieFaces(p: TyreState & { progress: number }): number[] {
  if (p.tyre === null) return TYRES.medium.faces;
  const spec = TYRES[p.tyre];
  return isWorn(p) ? spec.wornFaces! : spec.faces;
}
