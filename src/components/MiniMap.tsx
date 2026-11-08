import type { Player } from '../game/engine';
import { MAP_VIEWBOX, PIT_PATH, TRACK_PATH } from '../game/track';
import type { View } from './camera';
import type { Poses } from './Cars';

/** The whole circuit in a corner: every car as a dot, and the camera's view as a box. */
export function MiniMap({ players, poses, view }: { players: Player[]; poses: Poses; view: View }) {
  const { x, y, w, h } = MAP_VIEWBOX;
  return (
    <svg className="minimap" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label="Whole track overview">
      <path d={TRACK_PATH} className="minimap__road" />
      <path d={PIT_PATH} className="minimap__pit" />
      {poses.safetyCar && <circle cx={poses.safetyCar.point.x} cy={poses.safetyCar.point.y} r="13" className="minimap__sc" />}
      {poses.cars.map((c) => (
        <circle key={c.id} cx={c.point.x} cy={c.point.y} r="15" fill={players[c.id].color} className="minimap__car" />
      ))}
      <rect x={view.x} y={view.y} width={view.w} height={view.h} className="minimap__view" />
    </svg>
  );
}
