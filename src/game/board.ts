import { GAME_CONFIG } from './config';

// Round 1 · Albert Park. The lap is split into blocks that run clockwise
// from the Start/Finish line; where each block sits on the map is in track.ts.

export const SECTOR_COLORS = {
  1: '#E8742A',
  2: '#3366D6',
  3: '#8C55D0',
} as const;

export type Sector = keyof typeof SECTOR_COLORS;

export interface Tile {
  num: number;
  name: string;
  sector?: Sector;
  /** Overtakes into this block are much safer (DRS zone). */
  drs?: boolean;
  start?: boolean;
  /** Pit lane box. */
  pit?: boolean;
}

const b = (num: number, name: string, sector: Sector, drs = false): Tile => ({ num, name, sector, drs });

export const TILES: Tile[] = [
  { num: 1, name: 'Start / Finish', sector: 1, start: true },
  b(2, 'Main straight', 1, true),
  b(3, 'Main straight', 1, true),
  b(4, 'Turn 1', 1),
  b(5, 'Turn 2 · pit exit', 1),
  b(6, 'Short straight', 1, true),
  b(7, 'Turn 3', 1),
  b(8, 'Turn 4', 1),
  b(9, 'Turn 5', 2),
  b(10, 'Turn 6', 2),
  b(11, 'Turn 7', 2),
  b(12, 'Turn 8', 2),
  b(13, 'Lakeside straight', 2, true),
  b(14, 'Lakeside straight', 2, true),
  b(15, 'Turn 9', 2),
  b(16, 'Turn 10', 3),
  b(17, 'Straight', 3, true),
  b(18, 'Turn 11', 3),
  b(19, 'Turn 12', 3),
  b(20, 'Back section', 3),
  b(21, 'Turn 13', 3),
  b(22, 'Turn 14', 3),
  b(23, 'Pit entry', 3),
];

export const TRACK_LENGTH = TILES.length;
export const TOTAL_LAPS = GAME_CONFIG.race.laps;

/** Where cars stop to change tyres. */
export const PIT_BOX_INDEX = 2;

/**
 * Pit lane boxes, entered from the last block (Pit entry) and rejoining at
 * the pit exit. Box k runs alongside track block k of the next lap, so a
 * car's lap count and race position work the same in the lane as on track.
 */
export const PIT_TILES: Tile[] = [0, 1, 2, 3].map((k) => ({
  num: k + 1,
  name: k === PIT_BOX_INDEX ? 'Box' : `Pit lane`,
  pit: true,
}));

export const PIT_ENTRY_INDEX = TRACK_LENGTH - 1;
export const PIT_LENGTH = PIT_TILES.length;
/** Pit lane speed limiter: most boxes a car can cover in one turn. */
export const PIT_SPEED_LIMIT = GAME_CONFIG.pitLane.speedLimit;
