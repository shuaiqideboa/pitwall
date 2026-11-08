import type { ReactNode } from 'react';
import type { View } from './camera';
import { PIT_BOX_INDEX, PIT_SPEED_LIMIT, SECTOR_COLORS, TILES } from '../game/board';
import {
  BLOCK_CENTERS,
  MAP_VIEWBOX,
  PIT_CENTERS,
  PIT_PATH,
  TRACK_PATH,
  blockPath,
  blockStart,
  blockStartTangent,
  blockTangent,
  runPath,
} from '../game/track';

const LAKE = { x: 470, y: 330 };
const ROAD = 40;

/** Runs of consecutive DRS blocks, e.g. [[1, 2], [5, 5], …]. */
const DRS_RUNS = TILES.reduce<[number, number][]>((runs, tile, i) => {
  if (!tile.drs) return runs;
  const last = runs[runs.length - 1];
  if (last && last[1] === i - 1) last[1] = i;
  else runs.push([i, i]);
  return runs;
}, []);

/** Unit normal at block i pointing away from the lake (outside the track). */
function outward(i: number) {
  const t = blockTangent(i);
  const n = { x: -t.y, y: t.x };
  const c = BLOCK_CENTERS[i];
  const away = (c.x - LAKE.x) * n.x + (c.y - LAKE.y) * n.y > 0;
  return away ? n : { x: -n.x, y: -n.y };
}

/** A short line across the road at the start of block i. */
function crossLine(i: number, half = ROAD / 2) {
  const p = blockStart(i);
  const t = blockStartTangent(i);
  const n = { x: -t.y, y: t.x };
  return { x1: p.x + n.x * half, y1: p.y + n.y * half, x2: p.x - n.x * half, y2: p.y - n.y * half };
}

interface TrackMapProps {
  /** The part of the map to show (the camera); the whole map by default. */
  view?: View;
  activeBlock: number | null;
  activeBox: number | null;
  children?: ReactNode;
}

export function TrackMap({ view = MAP_VIEWBOX, activeBlock, activeBox, children }: TrackMapProps) {
  const { x, y, w, h } = view;
  const finish = crossLine(0, ROAD / 2);
  const finishC = BLOCK_CENTERS[0];

  return (
    <svg className="map" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Albert Park circuit">
      <defs>
        <pattern id="chequer" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#F3F0E8" />
          <rect width="4" height="4" fill="#16171B" />
          <rect x="4" y="4" width="4" height="4" fill="#16171B" />
        </pattern>
      </defs>

      {/* Albert Park Lake */}
      <path
        d="M250 320 C 255 245, 380 205, 520 212 C 640 218, 735 250, 715 320 C 700 380, 735 420, 640 440 C 520 462, 360 450, 290 420 C 255 400, 248 360, 250 320 Z"
        className="map__lake"
      />
      <text x="480" y="335" className="map__lake-label">
        ALBERT PARK LAKE
      </text>

      {/* Pit lane */}
      <path d={PIT_PATH} className="map__pit-edge" />
      <path d={PIT_PATH} className="map__pit" />
      {PIT_CENTERS.map((c, k) => (
        <g key={k}>
          <rect
            x={c.x - 22}
            y={c.y - 12}
            width="44"
            height="24"
            rx="4"
            className={['map__pit-box', k === PIT_BOX_INDEX ? 'map__pit-box--box' : '', activeBox === k ? 'is-active' : ''].join(' ')}
          />
          {k === PIT_BOX_INDEX && (
            <text x={c.x} y={c.y - 18} className="map__pit-label">
              BOX
            </text>
          )}
        </g>
      ))}
      <g transform={`translate(${PIT_CENTERS[0].x + 70} ${PIT_CENTERS[0].y - 26})`}>
        <circle r="12" className="map__limiter" />
        <text y="4.5" className="map__limiter-num">
          {PIT_SPEED_LIMIT}
        </text>
      </g>
      <text x={(PIT_CENTERS[1].x + PIT_CENTERS[2].x) / 2} y={PIT_CENTERS[1].y - 18} className="map__pit-label map__pit-label--lane">
        PIT LANE
      </text>

      {/* Track: white edges under the asphalt */}
      <path d={TRACK_PATH} className="map__edge" />
      <path d={TRACK_PATH} className="map__road" />

      {/* DRS zones */}
      {DRS_RUNS.map(([a, b2]) => {
        const mid = Math.round((a + b2) / 2);
        const o = outward(mid);
        const c = BLOCK_CENTERS[mid];
        return (
          <g key={a}>
            <path d={runPath(a, b2)} className="map__drs" />
            <text x={c.x + o.x * 44} y={c.y + o.y * 44 + 4} className="map__drs-label">
              DRS
            </text>
          </g>
        );
      })}

      {/* Highlight the block in play */}
      {activeBlock !== null && <path d={blockPath(activeBlock)} className="map__active" />}

      {/* Block dividers and numbers */}
      {BLOCK_CENTERS.map((c, i) => {
        const line = crossLine(i);
        const o = outward(i);
        const tile = TILES[i];
        const color = tile.sector ? SECTOR_COLORS[tile.sector] : '#9A9CA4';
        const lx = c.x + o.x * 30;
        const ly = c.y + o.y * 30;
        return (
          <g key={i}>
            {i !== 0 && <line {...line} className="map__divider" />}
            <circle cx={lx} cy={ly} r="9.5" fill={color} className="map__num-bg" />
            <text x={lx} y={ly + 3.6} className="map__num">
              {tile.num}
            </text>
            {/turn/i.test(tile.name) && (
              <text x={c.x + o.x * 52} y={c.y + o.y * 52 + 3} className="map__turn">
                {tile.name.replace('Turn ', 'T').replace(' · pit exit', '')}
              </text>
            )}
          </g>
        );
      })}

      {/* Start / Finish */}
      <line {...finish} className="map__finish" />
      <text x={finishC.x} y={finishC.y + 42} className="map__finish-label">
        START / FINISH
      </text>

      {children}
    </svg>
  );
}
