import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { TRACK_LENGTH } from '../game/board';
import type { Player } from '../game/engine';
import { BLOCK_CENTERS, PIT_CENTERS, type Point, blockHeading } from '../game/track';

/** Where a car is: progress plus whether it is in the pit lane. */
export interface CarPos {
  progress: number;
  pit: boolean;
}

function CarToken({ color, ink, num }: { color: string; ink: string; num: number }) {
  return (
    <svg className="car__svg" x="-18" y="-9" width="36" height="18" viewBox="0 0 44 22">
      <rect x="6" y="0" width="10" height="6" rx="2" fill="#0B0B0E" />
      <rect x="6" y="16" width="10" height="6" rx="2" fill="#0B0B0E" />
      <rect x="29" y="1.5" width="8" height="5" rx="1.8" fill="#0B0B0E" />
      <rect x="29" y="15.5" width="8" height="5" rx="1.8" fill="#0B0B0E" />
      <rect x="1" y="2.5" width="5" height="17" rx="1.2" fill={color} stroke="#FFFFFF" strokeWidth="0.8" />
      <path
        d="M5 8.2 L14 6.4 Q22 3.4 30 7 L40 9.6 L40 12.4 L30 15 Q22 18.6 14 15.6 L5 13.8 Z"
        fill={color}
        stroke="#FFFFFF"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <ellipse cx="24" cy="11" rx="3.6" ry="2.4" fill="#0B0B0E" />
      <rect x="38.5" y="3" width="4" height="16" rx="1" fill="#F3F0E8" stroke={color} strokeWidth="0.8" />
      <circle cx="14" cy="11" r="4.4" fill={ink === '#FFFFFF' ? '#FFFFFF' : '#16171B'} />
      <text
        x="14"
        y="11"
        dy="0.35em"
        textAnchor="middle"
        fontFamily="Barlow Condensed, sans-serif"
        fontSize="7"
        fontWeight="800"
        fill={ink === '#FFFFFF' ? color : '#FFFFFF'}
      >
        {num}
      </text>
    </svg>
  );
}

/** The Safety Car: silver, with a light bar that flashes amber. */
function SafetyCarToken() {
  return (
    <svg className="car__svg" x="-20" y="-10" width="40" height="20" viewBox="0 0 44 22">
      <rect x="7" y="0" width="9" height="5.5" rx="2" fill="#0B0B0E" />
      <rect x="7" y="16.5" width="9" height="5.5" rx="2" fill="#0B0B0E" />
      <rect x="28" y="0" width="9" height="5.5" rx="2" fill="#0B0B0E" />
      <rect x="28" y="16.5" width="9" height="5.5" rx="2" fill="#0B0B0E" />
      <path d="M3 6 Q3 3 7 3 L36 3 Q42 3 42 8 L42 14 Q42 19 36 19 L7 19 Q3 19 3 16 Z" fill="#C9CCD3" stroke="#FFFFFF" strokeWidth="0.8" />
      <rect x="15" y="5.5" width="12" height="11" rx="2.5" fill="#2A2C33" />
      <rect className="sc-lights" x="18.5" y="4" width="5" height="14" rx="1.5" fill="#F2C230" />
      <rect x="4" y="9.5" width="10" height="3" fill="#D7261E" />
    </svg>
  );
}

/** One continuous drive: the car follows `path` (progress values) over `duration` ms. */
export interface CarAnim {
  id: number;
  path: CarPos[];
  duration: number;
  /** Unique per drive, so a new drive restarts the clock. */
  key: number;
}

/** Offsets of up to four cars sharing a block: along the road, and across it. */
const CLUSTER = [
  { along: 18, across: -9 },
  { along: -18, across: 9 },
  { along: 18, across: 9 },
  { along: -18, across: -9 },
];

/** Where a car sits on the map, and which way it faces (degrees). */
function carPose(pos: CarPos, slot: number, count: number): { point: Point; heading: number } {
  const i = pos.progress % TRACK_LENGTH;
  const base = pos.pit ? PIT_CENTERS[i] : BLOCK_CENTERS[i];
  const heading = pos.pit ? 180 : blockHeading(i);
  if (count <= 1) return { point: base, heading };
  const rad = (heading * Math.PI) / 180;
  const t = { x: Math.cos(rad), y: Math.sin(rad) };
  const n = { x: -t.y, y: t.x };
  const off = CLUSTER[slot % 4];
  return { point: { x: base.x + t.x * off.along + n.x * off.across, y: base.y + t.y * off.along + n.y * off.across }, heading };
}

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/**
 * A smooth curve through the waypoints, sampled by arc length so the car
 * travels at an even speed and rounds the board corners instead of snapping.
 */
function buildCurve(points: Point[]) {
  const samples: Point[] = [];
  const PER_SEGMENT = 24;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    for (let k = 0; k < PER_SEGMENT; k++) {
      const t = k / PER_SEGMENT;
      samples.push({ x: catmullRom(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom(p0.y, p1.y, p2.y, p3.y, t) });
    }
  }
  samples.push(points[points.length - 1]);

  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  const total = lengths[lengths.length - 1];

  return (f: number): { point: Point; angle: number | null } => {
    if (total < 0.5) return { point: samples[samples.length - 1], angle: null };
    const target = f * total;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < target) i++;
    const a = samples[i - 1];
    const b = samples[i];
    const span = lengths[i] - lengths[i - 1] || 1;
    const u = Math.min(1, Math.max(0, (target - lengths[i - 1]) / span));
    // Look a little ahead for the heading so the nose leads into corners.
    const ahead = samples[Math.min(i + 3, samples.length - 1)];
    const dx = ahead.x - a.x;
    const dy = ahead.y - a.y;
    return {
      point: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u },
      angle: Math.hypot(dx, dy) > 0.01 ? (Math.atan2(dy, dx) * 180) / Math.PI : null,
    };
  };
}

// Gentle acceleration out of the start and braking into the stop.
const easeInOut = (f: number) => -(Math.cos(Math.PI * f) - 1) / 2;

/** Unwrap `target` so it is within ±180° of `prev` (cars turn the short way). */
const nearestAngle = (prev: number, target: number) => prev + ((((target - prev) % 360) + 540) % 360) - 180;

const keyOf = (pos: CarPos) => `${pos.pit ? 'p' : 't'}${pos.progress % TRACK_LENGTH}`;

function slotsFor(players: Player[], positions: CarPos[]) {
  const byBlock = new Map<string, number[]>();
  players.forEach((p) => {
    const key = keyOf(positions[p.id]);
    byBlock.set(key, [...(byBlock.get(key) ?? []), p.id]);
  });
  return (id: number) => {
    const group = byBlock.get(keyOf(positions[id]))!;
    return { slot: group.indexOf(id), count: group.length };
  };
}

/** Fraction (0–1) of the current drive, ticking every animation frame. */
function useDriveClock(anim: CarAnim | null) {
  const [clock, setClock] = useState({ key: -1, f: 0 });
  useEffect(() => {
    if (!anim) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const f = Math.min(1, (now - start) / anim.duration);
      setClock({ key: anim.key, f });
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim]);
  return anim && clock.key === anim.key ? clock.f : 0;
}

export interface CarPose {
  id: number;
  point: Point;
  /** Facing, degrees (0 = right). */
  angle: number;
  driving: boolean;
}

export interface Poses {
  cars: CarPose[];
  safetyCar: { point: Point; angle: number } | null;
}

interface PoseInput {
  players: Player[];
  /** Parked position of every car (the driving car's start, while `anim` runs). */
  positions: CarPos[];
  anim: CarAnim | null;
  /** Where the Safety Car is, while it is out. */
  safetyCar: CarPos | null;
}

/**
 * Where every car is right now, in map units. Parked cars sit in their block
 * (sharing it in a cluster); the driving car moves each frame along a curve
 * through the blocks it passes, which follows the drawn road.
 */
export function useCarPoses({ players, positions, anim, safetyCar }: PoseInput): Poses {
  const f = useDriveClock(anim);
  // Last applied angle per car, so turns go the short way round.
  const angles = useRef<number[]>([]);

  // Park everyone else as if the driving car had already arrived, so its
  // destination slot is free and cars it leaves behind close up at once.
  const destination = useMemo(() => {
    if (!anim) return positions;
    const out = [...positions];
    out[anim.id] = anim.path[anim.path.length - 1];
    return out;
  }, [anim, positions]);
  const slotOf = slotsFor(players, destination);

  const curve = useMemo(() => {
    if (!anim) return null;
    const start = slotsFor(players, positions)(anim.id);
    const end = slotOf(anim.id);
    const waypoints = anim.path.map((pos, i) => {
      if (i === 0) return carPose(pos, start.slot, start.count).point;
      if (i === anim.path.length - 1) return carPose(pos, end.slot, end.count).point;
      return carPose(pos, 0, 1).point;
    });
    return buildCurve(waypoints);
  }, [anim, players, positions, destination]); // slotOf derives from destination

  const cars = players.map((p): CarPose => {
    const driving = anim?.id === p.id && curve !== null;
    let point: Point;
    let target: number;
    if (driving) {
      const pose = curve!(easeInOut(f));
      point = pose.point;
      target = pose.angle ?? angles.current[p.id] ?? 0;
    } else {
      const { slot, count } = slotOf(p.id);
      const pose = carPose(positions[p.id], slot, count);
      point = pose.point;
      target = pose.heading;
    }
    const prev = angles.current[p.id] ?? target;
    const angle = nearestAngle(prev, target);
    angles.current[p.id] = angle;
    return { id: p.id, point, angle, driving };
  });

  const sc = safetyCar ? carPose(safetyCar, 0, 1) : null;
  return { cars, safetyCar: sc && { point: sc.point, angle: sc.heading } };
}

const carTransform = (point: Point, angle: number, lift: boolean) =>
  `translate(${point.x}px, ${point.y}px) rotate(${angle}deg) scale(${lift ? 1.35 : 1})`;

/** The cars, drawn inside the track map's SVG. Parked cars ease between places with CSS. */
export function Cars({ players, poses, mover }: { players: Player[]; poses: Poses; mover: number | null }) {
  return (
    <g className="cars" aria-hidden="true">
      {poses.safetyCar && (
        <g className="car car--safety" style={{ transform: carTransform(poses.safetyCar.point, poses.safetyCar.angle, false) }}>
          <SafetyCarToken />
        </g>
      )}
      {poses.cars.map((c) => {
        const p = players[c.id];
        return (
          <g
            key={c.id}
            className={['car', c.driving ? 'car--driving' : '', mover === c.id ? 'car--moving' : ''].join(' ')}
            style={{ transform: carTransform(c.point, c.angle, mover === c.id) } as CSSProperties}
          >
            <CarToken color={p.color} ink={p.ink} num={p.id + 1} />
          </g>
        );
      })}
    </g>
  );
}
