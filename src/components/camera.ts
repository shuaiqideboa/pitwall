import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '../game/config';
import { MAP_VIEWBOX, type Point } from '../game/track';

/** A window onto the map, in map units (an SVG viewBox). */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the follow camera zooms in on the car. */
export const FOLLOW_ZOOM = GAME_CONFIG.camera.followZoom;
/** How far ahead of the car (map units, along its heading) the camera looks. */
export const LOOK_AHEAD = GAME_CONFIG.camera.lookAhead;
/** Camera smoothing: about 63% of the way to the target every this many ms. */
const SMOOTHING_MS = GAME_CONFIG.camera.smoothingMs;

const MAP_CENTER = { x: MAP_VIEWBOX.x + MAP_VIEWBOX.w / 2, y: MAP_VIEWBOX.y + MAP_VIEWBOX.h / 2 };

function toView(cx: number, cy: number, zoom: number): View {
  const w = MAP_VIEWBOX.w / zoom;
  const h = MAP_VIEWBOX.h / zoom;
  // Keep the view over the map rather than drifting off its edge.
  const x = Math.min(Math.max(cx - w / 2, MAP_VIEWBOX.x), MAP_VIEWBOX.x + MAP_VIEWBOX.w - w);
  const y = Math.min(Math.max(cy - h / 2, MAP_VIEWBOX.y), MAP_VIEWBOX.y + MAP_VIEWBOX.h - h);
  return { x, y, w, h };
}

/**
 * A camera that glides toward `target` at `zoom` (1 = the whole map). It
 * eases every animation frame, so following a driving car stays smooth.
 */
export function useCamera(target: Point | null, zoom: number): View {
  const goal = useRef({ x: MAP_CENTER.x, y: MAP_CENTER.y, z: 1 });
  goal.current = target && zoom > 1 ? { x: target.x, y: target.y, z: zoom } : { x: MAP_CENTER.x, y: MAP_CENTER.y, z: 1 };

  const cam = useRef({ ...goal.current });
  const [view, setView] = useState(() => toView(cam.current.x, cam.current.y, cam.current.z));

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const k = 1 - Math.exp(-(now - last) / SMOOTHING_MS);
      last = now;
      const c = cam.current;
      const g = goal.current;
      const moving = Math.abs(g.x - c.x) > 0.05 || Math.abs(g.y - c.y) > 0.05 || Math.abs(g.z - c.z) > 0.001;
      if (moving) {
        c.x += (g.x - c.x) * k;
        c.y += (g.y - c.y) * k;
        c.z += (g.z - c.z) * k;
        setView(toView(c.x, c.y, c.z));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return view;
}
