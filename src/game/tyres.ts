import { TRACK_LENGTH } from './board';
import { type Compound, GAME_CONFIG, type TyreNumbers } from './config';

export type { Compound };

export interface TyreSpec extends TyreNumbers {
  name: string;
  letter: string;
  /** Sidewall color: red, yellow, white. */
  color: string;
  blurb: string;
}

const LOOKS: Record<Compound, Pick<TyreSpec, 'name' | 'letter' | 'color'> & { pace: string }> = {
  soft: { name: 'Soft', letter: 'S', color: '#D7261E', pace: 'Fastest' },
  medium: { name: 'Medium', letter: 'M', color: '#F2C230', pace: 'Balanced' },
  hard: { name: 'Hard', letter: 'H', color: '#F3F0E8', pace: 'Slowest' },
};

const blurb = (pace: string, t: TyreNumbers) =>
  t.lifeLaps === null ? `${pace}. Never wears out.` : `${pace}. Worn after ${t.lifeLaps} lap${t.lifeLaps === 1 ? '' : 's'}.`;

/** Each compound: how it looks, plus its dice and wear from GAME_CONFIG. */
export const TYRES = Object.fromEntries(
  (Object.keys(LOOKS) as Compound[]).map((c) => {
    const { pace, ...look } = LOOKS[c];
    const numbers = GAME_CONFIG.tyres[c];
    return [c, { ...look, ...numbers, blurb: blurb(pace, numbers) }];
  }),
) as Record<Compound, TyreSpec>;

export const COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];

export interface TyreState {
  tyre: Compound | null;
  /** Progress when the current set was fitted. */
  fittedAt: number;
}

/** Laps driven on the current set (fractional). */
export const tyreLaps = (p: TyreState & { progress: number }) => (p.progress - p.fittedAt) / TRACK_LENGTH;

export const isWorn = (p: TyreState & { progress: number }) => {
  if (p.tyre === null) return false;
  const { wornFaces, lifeLaps } = TYRES[p.tyre];
  return wornFaces !== null && lifeLaps !== null && tyreLaps(p) >= lifeLaps;
};

/** The die this car rolls right now. */
export function dieFaces(p: TyreState & { progress: number }): number[] {
  if (p.tyre === null) return TYRES.medium.faces;
  const spec = TYRES[p.tyre];
  return isWorn(p) ? spec.wornFaces! : spec.faces;
}
