// Every number that shapes the race, in one place. This is the "menu" a
// player (through the AI) will be allowed to change: CONFIG_RULES says what
// each setting means and the range it may take, and validateConfig() rejects
// anything outside it. The structure of the track (blocks, DRS zones, pit
// lane layout) lives in board.ts and track.ts and is not tunable here.

export type Compound = 'soft' | 'medium' | 'hard';
export type IncidentKind = 'safety-car' | 'red-flag';
/** Chance of each incident when attempting an overtake; the rest is a clean pass. */
export type Risk = Record<IncidentKind, number>;

export interface TyreNumbers {
  /** The six faces of this compound's die. */
  faces: number[];
  /** Faces once the set is worn out; null for a set that never wears. */
  wornFaces: number[] | null;
  /** Laps a set lasts before it is worn; null for a set that never wears. */
  lifeLaps: number | null;
}

export interface GameConfig {
  race: { laps: number };
  tyres: Record<Compound, TyreNumbers>;
  pitLane: {
    /** Most pit lane boxes a car can cover in one turn (the pit limiter). */
    speedLimit: number;
    /** The same, while the Safety Car is out (stops are quicker). */
    safetyCarSpeedLimit: number;
  };
  overtaking: {
    /** Blocks of the roll a clean pass uses: onto the rival's block and past it. */
    cost: number;
    risk: Risk;
    /** Risk when the pass happens in a DRS zone. */
    drsRisk: Risk;
  };
  safetyCar: {
    /** Most blocks any car moves in a turn behind the Safety Car. */
    speedLimit: number;
    /** Gaps (blocks) the field closes up to when it comes out. */
    maxGap: number;
  };
  /** Animation timing, in milliseconds. */
  pacing: {
    dieRollMs: number;
    settleMs: number;
    hopMs: number;
    pitHopMs: number;
    minDriveMs: number;
    segmentPauseMs: number;
    endPauseMs: number;
  };
  camera: {
    /** How far the follow camera zooms in (1 = whole map). */
    followZoom: number;
    /** How far ahead of the car the camera looks (map units). */
    lookAhead: number;
    /** How quickly the camera catches up (ms to cover ~63% of the gap). */
    smoothingMs: number;
  };
}

// Tyres: Softs are fastest but fall off a cliff after one lap, Mediums last
// most of the race, Hards are steady and never wear. Tuned by simulating
// fixed strategies (see src/game/balance.test.ts): every sensible plan stays
// a contender.
export const GAME_CONFIG: GameConfig = {
  race: { laps: 5 },
  tyres: {
    soft: { faces: [3, 4, 5, 6, 6, 7], wornFaces: [1, 1, 2, 2, 3, 3], lifeLaps: 1 },
    medium: { faces: [2, 3, 4, 5, 5, 6], wornFaces: [1, 2, 2, 3, 3, 4], lifeLaps: 3 },
    hard: { faces: [3, 3, 4, 4, 5, 5], wornFaces: null, lifeLaps: null },
  },
  pitLane: { speedLimit: 2, safetyCarSpeedLimit: 3 },
  overtaking: {
    cost: 2,
    risk: { 'safety-car': 0.25, 'red-flag': 0.02 },
    drsRisk: { 'safety-car': 0.092, 'red-flag': 0.017 },
  },
  safetyCar: { speedLimit: 3, maxGap: 2 },
  pacing: {
    dieRollMs: 1400,
    settleMs: 600,
    hopMs: 380,
    pitHopMs: 850,
    minDriveMs: 600,
    segmentPauseMs: 900,
    endPauseMs: 700,
  },
  camera: { followZoom: 2.4, lookAhead: 55, smoothingMs: 220 },
};

/** One tunable setting: where it is, what it means, and what values are allowed. */
export interface ConfigRule {
  path: string;
  description: string;
  min: number;
  max: number;
  integer?: boolean;
}

const COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];

export const CONFIG_RULES: ConfigRule[] = [
  { path: 'race.laps', description: 'Laps in the race', min: 1, max: 10, integer: true },
  ...COMPOUNDS.flatMap((c): ConfigRule[] => [
    { path: `tyres.${c}.faces`, description: `${c} tyre die: six faces`, min: 1, max: 9, integer: true },
    { path: `tyres.${c}.wornFaces`, description: `${c} tyre die once worn (or null: never wears)`, min: 1, max: 9, integer: true },
    { path: `tyres.${c}.lifeLaps`, description: `Laps before ${c} tyres wear out (or null: never)`, min: 0.5, max: 10 },
  ]),
  { path: 'pitLane.speedLimit', description: 'Pit limiter: boxes per turn', min: 1, max: 5, integer: true },
  { path: 'pitLane.safetyCarSpeedLimit', description: 'Pit limiter under the Safety Car', min: 1, max: 6, integer: true },
  { path: 'overtaking.cost', description: 'Blocks a clean pass uses', min: 1, max: 3, integer: true },
  { path: 'overtaking.risk.safety-car', description: 'Overtake: chance of a Safety Car', min: 0, max: 0.6 },
  { path: 'overtaking.risk.red-flag', description: 'Overtake: chance of a red flag', min: 0, max: 0.2 },
  { path: 'overtaking.drsRisk.safety-car', description: 'DRS overtake: chance of a Safety Car', min: 0, max: 0.6 },
  { path: 'overtaking.drsRisk.red-flag', description: 'DRS overtake: chance of a red flag', min: 0, max: 0.2 },
  { path: 'safetyCar.speedLimit', description: 'Blocks per turn behind the Safety Car', min: 1, max: 6, integer: true },
  { path: 'safetyCar.maxGap', description: 'Gap the field closes up to under the Safety Car', min: 1, max: 6, integer: true },
  ...(['dieRollMs', 'settleMs', 'hopMs', 'pitHopMs', 'minDriveMs', 'segmentPauseMs', 'endPauseMs'] as const).map(
    (k): ConfigRule => ({ path: `pacing.${k}`, description: `Animation timing: ${k}`, min: 0, max: 5000, integer: true }),
  ),
  { path: 'camera.followZoom', description: 'Follow camera zoom', min: 1, max: 4 },
  { path: 'camera.lookAhead', description: 'Camera look-ahead', min: 0, max: 150 },
  { path: 'camera.smoothingMs', description: 'Camera smoothing', min: 50, max: 1000 },
];

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined), obj);

/** Problems with a config, in plain words; empty when it is valid. */
export function validateConfig(config: GameConfig): string[] {
  const errors: string[] = [];
  const checkNumber = (rule: ConfigRule, v: unknown, where = rule.path) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return errors.push(`${where} must be a number`);
    if (v < rule.min || v > rule.max) errors.push(`${where} must be between ${rule.min} and ${rule.max} (got ${v})`);
    if (rule.integer && !Number.isInteger(v)) errors.push(`${where} must be a whole number (got ${v})`);
  };

  for (const rule of CONFIG_RULES) {
    const value = get(config, rule.path);
    if (/\.(faces|wornFaces)$/.test(rule.path)) {
      if (value === null && rule.path.endsWith('wornFaces')) continue;
      if (!Array.isArray(value) || value.length !== 6) {
        errors.push(`${rule.path} must be six numbers`);
        continue;
      }
      value.forEach((v, i) => checkNumber(rule, v, `${rule.path}[${i}]`));
    } else if (value === null && rule.path.endsWith('lifeLaps')) {
      continue;
    } else {
      checkNumber(rule, value);
    }
  }

  for (const c of COMPOUNDS) {
    const t = config.tyres[c];
    if ((t.wornFaces === null) !== (t.lifeLaps === null)) {
      errors.push(`tyres.${c}: wornFaces and lifeLaps must both be set, or both be null`);
    }
  }
  return errors;
}
