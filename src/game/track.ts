import { PIT_LENGTH, TRACK_LENGTH } from './board';

// Map geometry for Albert Park, in SVG user units (see MAP_VIEWBOX). The
// track is a smooth closed curve through the centre of each block, so the
// cars' driving curve (through the same points) follows the drawn road.
// It's a stylised trace of the circuit's layout, run clockwise round the lake.

export type Point = { x: number; y: number };

export const MAP_VIEWBOX = { x: 30, y: 40, w: 940, h: 560 };

/** Centre of each track block, Start/Finish first, clockwise. */
export const BLOCK_CENTERS: Point[] = [
  { x: 640, y: 552 }, // Start / Finish
  { x: 530, y: 552 }, // main straight
  { x: 420, y: 552 }, // main straight
  { x: 325, y: 548 }, // T1
  { x: 266, y: 518 }, // T2 · pit exit
  { x: 198, y: 512 }, // short straight
  { x: 126, y: 503 }, // T3
  { x: 110, y: 442 }, // T4
  { x: 142, y: 378 }, // T5
  { x: 126, y: 300 }, // T6
  { x: 160, y: 224 }, // T7
  { x: 230, y: 168 }, // T8
  { x: 340, y: 138 }, // lakeside straight
  { x: 460, y: 120 }, // lakeside straight
  { x: 575, y: 110 }, // T9
  { x: 668, y: 130 }, // T10
  { x: 752, y: 168 }, // straight
  { x: 818, y: 228 }, // T11
  { x: 792, y: 300 }, // T12
  { x: 840, y: 364 }, // back section
  { x: 902, y: 424 }, // T13
  { x: 870, y: 502 }, // T14
  { x: 765, y: 540 }, // pit entry
];

if (BLOCK_CENTERS.length !== TRACK_LENGTH) throw new Error('track.ts: one centre per block');

/** Centre of each pit lane box (alongside blocks 0…), between the pit entry and exit. */
export const PIT_CENTERS: Point[] = [
  { x: 640, y: 504 },
  { x: 525, y: 506 },
  { x: 410, y: 506 },
  { x: 318, y: 500 },
];

if (PIT_CENTERS.length !== PIT_LENGTH) throw new Error('track.ts: one centre per pit box');

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const crd = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (-p0 + p2 + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t * t);

/** Point on the closed track curve, `i` = segment from block i to i+1, `t` in [0, 1]. */
function trackAt(i: number, t: number): Point {
  const n = BLOCK_CENTERS.length;
  const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => BLOCK_CENTERS[(((i + k) % n) + n) % n]);
  return { x: cr(p0.x, p1.x, p2.x, p3.x, t), y: cr(p0.y, p1.y, p2.y, p3.y, t) };
}

function trackTangent(i: number, t: number): Point {
  const n = BLOCK_CENTERS.length;
  const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => BLOCK_CENTERS[(((i + k) % n) + n) % n]);
  return { x: crd(p0.x, p1.x, p2.x, p3.x, t), y: crd(p0.y, p1.y, p2.y, p3.y, t) };
}

const toPath = (pts: Point[], close = false) =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');

const SAMPLES = 16;

/** The whole track as an SVG path. */
export const TRACK_PATH = (() => {
  const pts: Point[] = [];
  for (let i = 0; i < BLOCK_CENTERS.length; i++) for (let k = 0; k < SAMPLES; k++) pts.push(trackAt(i, k / SAMPLES));
  return toPath(pts, true);
})();

/** Path of block i: from halfway back to the previous block to halfway on to the next. */
export function blockPath(i: number): string {
  const n = BLOCK_CENTERS.length;
  const prev = (i - 1 + n) % n;
  const pts: Point[] = [];
  for (let k = SAMPLES / 2; k <= SAMPLES; k++) pts.push(trackAt(prev, k / SAMPLES));
  for (let k = 1; k <= SAMPLES / 2; k++) pts.push(trackAt(i, k / SAMPLES));
  return toPath(pts);
}

/** Path covering a run of blocks (e.g. a DRS zone), first to last inclusive. */
export function runPath(first: number, last: number): string {
  const n = BLOCK_CENTERS.length;
  const pts: Point[] = [];
  for (let i = first - 1; i <= last; i++) {
    const seg = (i + n) % n;
    const from = i === first - 1 ? SAMPLES / 2 : 0;
    const to = i === last ? SAMPLES / 2 : SAMPLES - 1;
    for (let k = from; k <= to; k++) pts.push(trackAt(seg, k / SAMPLES));
  }
  return toPath(pts);
}

const unit = (v: Point) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Direction of travel at block i (unit vector). */
export const blockTangent = (i: number) => unit(trackTangent(i, 0));
/** Heading of travel at block i, degrees (0 = right, 90 = down). */
export const blockHeading = (i: number) => {
  const t = blockTangent(i);
  return (Math.atan2(t.y, t.x) * 180) / Math.PI;
};
/** Point where block i starts (the line between block i-1 and i). */
export const blockStart = (i: number) => trackAt((i - 1 + BLOCK_CENTERS.length) % BLOCK_CENTERS.length, 0.5);
export const blockStartTangent = (i: number) =>
  unit(trackTangent((i - 1 + BLOCK_CENTERS.length) % BLOCK_CENTERS.length, 0.5));

/** Pit lane drawn from the pit entry block, past the boxes, to the exit block. */
export const PIT_PATH = (() => {
  const entry = BLOCK_CENTERS[TRACK_LENGTH - 1];
  const exit = BLOCK_CENTERS[PIT_LENGTH];
  const way = [entry, ...PIT_CENTERS, exit];
  const pts: Point[] = [];
  for (let i = 0; i < way.length - 1; i++) {
    const [p0, p1, p2, p3] = [way[Math.max(0, i - 1)], way[i], way[i + 1], way[Math.min(way.length - 1, i + 2)]];
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES;
      pts.push({ x: cr(p0.x, p1.x, p2.x, p3.x, t), y: cr(p0.y, p1.y, p2.y, p3.y, t) });
    }
  }
  pts.push(exit);
  return toPath(pts);
})();
