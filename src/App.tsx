import { useEffect, useRef, useState } from 'react';
import { CenterPanel } from './components/CenterPanel';
import { TrackMap } from './components/TrackMap';
import { TyrePicker } from './components/Tyres';
import { DIE_ROLL_MS } from './components/Die3D';
import { type CarAnim, type CarPos, Cars, useCarPoses } from './components/Cars';
import { FOLLOW_ZOOM, LOOK_AHEAD, useCamera } from './components/camera';
import { MiniMap } from './components/MiniMap';
import { Home } from './components/Home';
import { useAccount } from './account';
import { type Cue, cueLog, isMuted, playCue, setMuted } from './audio';
import { TOTAL_LAPS, TRACK_LENGTH } from './game/board';
import { GAME_CONFIG } from './game/config';
import { type GameState, type Hop, chooseTyre, decideOvertake, lapOf, lightsOut, newGame, takeTurn, toggleBox } from './game/engine';
import type { Compound } from './game/tyres';

// Design size. The board stretches to the window's shape, and everything is
// scaled so the shorter side matches this size.
const DESIGN_W = 1440;
const DESIGN_H = 860;
// Theme accent from the design's `accent` tweak (options: #D7261E, #E8742A, #1E9E8F, #3366D6).
const ACCENT = '#D7261E';

// Pacing (see GAME_CONFIG.pacing): slow enough that everyone at the table can follow each move.
const { settleMs: SETTLE_MS, hopMs: HOP_MS, pitHopMs: PIT_HOP_MS, minDriveMs: MIN_DRIVE_MS } = GAME_CONFIG.pacing;
const { segmentPauseMs: SEGMENT_PAUSE_MS, endPauseMs: END_PAUSE_MS } = GAME_CONFIG.pacing;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (import.meta.env.DEV) (window as unknown as { __f1Cues: Cue[] }).__f1Cues = cueLog;

/** Music for a caption, timed to the moment it appears on screen. */
function cueFor(caption: string): Cue | null {
  if (/RED FLAG/.test(caption)) return 'red-flag';
  if (/SAFETY CAR/.test(caption)) return 'safety-car';
  if (/overtakes/.test(caption)) return 'overtake';
  return null;
}

const leaderLap = (s: GameState) => Math.max(...s.players.map(lapOf));
const positionsOf = (s: GameState): CarPos[] => s.players.map((p) => ({ progress: p.progress, pit: p.inPit }));

interface Drive {
  id: number;
  label?: string;
  steps: CarPos[];
  /** Driven at pit lane speed. */
  pit: boolean;
  /** Continues the previous drive without a pause (track ↔ pit lane). */
  chained: boolean;
}

/**
 * Group the turn's hops into drives: each starts at a `pause` hop, and a
 * drive is split where its speed changes, so hops in the pit lane (and the
 * hop out of it) run at pit lane speed.
 */
function toDrives(trace: Hop[]) {
  const drives: Drive[] = [];
  trace.forEach((hop, i) => {
    const prev = trace[i - 1];
    const pitSpeed = hop.pit || (!hop.pause && prev?.pit === true);
    const last = drives[drives.length - 1];
    if (hop.pause || !last) {
      drives.push({ id: hop.id, label: hop.label, steps: [], pit: pitSpeed, chained: false });
    } else if (pitSpeed !== last.pit) {
      drives.push({ id: hop.id, steps: [], pit: pitSpeed, chained: true });
    }
    drives[drives.length - 1].steps.push({ progress: hop.progress, pit: hop.pit });
  });
  return drives;
}

export type Phase = 'idle' | 'rolling' | 'moving';

/** Window size, falling back to the design size while the window has none (a hidden tab). */
function useViewport() {
  const read = () => ({ w: window.innerWidth || DESIGN_W, h: window.innerHeight || DESIGN_H });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    // A ResizeObserver also fires when a tab that opened hidden is first shown.
    const update = () => setVp(read());
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return vp;
}

export default function App() {
  const [state, setState] = useState(newGame);
  const [positions, setPositions] = useState(() => positionsOf(state));
  const [phase, setPhase] = useState<Phase>('idle');
  const [face, setFace] = useState<number | null>(null);
  const [rollId, setRollId] = useState(0);
  const [mover, setMover] = useState<number | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [anim, setAnim] = useState<CarAnim | null>(null);
  const [follow, setFollow] = useState(true);
  const [account, setAccount] = useAccount();
  const [screen, setScreen] = useState<'home' | 'race'>('home');
  const busy = useRef(false);
  const driveCount = useRef(0);

  const vp = useViewport();
  const scale = Math.min(vp.w / DESIGN_W, vp.h / DESIGN_H);

  /** Animate the hops of `next` (from the cars' current places), then commit it. */
  const play = async (from: GameState, next: GameState) => {
    setPhase('moving');
    const pos = positionsOf(from);
    for (const [i, drive] of toDrives(next.trace).entries()) {
      if (i > 0 && !drive.chained) await sleep(SEGMENT_PAUSE_MS);
      if (drive.label) {
        setCaption(drive.label);
        const cue = cueFor(drive.label);
        if (cue) playCue(cue);
      }
      const path = [pos[drive.id], ...drive.steps];
      const duration = Math.max(MIN_DRIVE_MS, (path.length - 1) * (drive.pit ? PIT_HOP_MS : HOP_MS));
      setMover(drive.id);
      setAnim({ id: drive.id, path, duration, key: ++driveCount.current });
      await sleep(duration);
      pos[drive.id] = path[path.length - 1];
      setPositions([...pos]);
      setAnim(null);
    }
    if (next.trace.length > 0) await sleep(END_PAUSE_MS);

    setState(next);
    if (next.stage === 'finished' && from.stage !== 'finished') playCue('win');
    else if (leaderLap(from) < TOTAL_LAPS - 1 && leaderLap(next) >= TOTAL_LAPS - 1) playCue('final-lap');
    setPositions(positionsOf(next));
    setMover(null);
    setCaption(null);
    setPhase('idle');
  };

  const onRoll = async () => {
    if (busy.current) return;
    if (state.stage === 'finished') {
      const fresh = newGame();
      setState(fresh);
      setPositions(positionsOf(fresh));
      return;
    }
    busy.current = true;
    if (state.stage === 'grid') {
      // Everyone is ready: lights out, and the whole field gets away together.
      playCue('lights-out');
      await play(state, lightsOut(state));
      busy.current = false;
      return;
    }
    const next = takeTurn(state);

    // The 3D die spins toward the rolled face, so the result is set up front.
    setPhase('rolling');
    setFace(next.lastFace);
    setRollId((n) => n + 1);
    await sleep(DIE_ROLL_MS + SETTLE_MS);

    await play(state, next);
    setFace(null);
    busy.current = false;
  };

  const onOvertake = async (go: boolean) => {
    if (busy.current || !state.overtake) return;
    busy.current = true;
    await play(state, decideOvertake(state, go));
    busy.current = false;
  };

  const onBox = () => setState((s) => toggleBox(s));
  const onChooseTyre = (c: Compound | null) => {
    if (state.tyreQueue[0]?.reason === 'pit-stop') playCue('pit-stop');
    setState((s) => chooseTyre(s, c));
  };
  const [musicOff, setMusicOff] = useState(isMuted);
  const toggleMusic = () => {
    setMuted(!musicOff);
    setMusicOff(!musicOff);
    if (musicOff) playCue('music-on');
  };

  // The Safety Car leads the field: one block ahead of the leading car on track.
  const leaderOnTrack = positions.filter((p) => !p.pit).reduce((m, p) => Math.max(m, p.progress), -1);
  const safetyCarAt: CarPos | null =
    state.scUntilLap !== null && leaderOnTrack >= 0 ? { progress: leaderOnTrack + 1, pit: false } : null;

  const poses = useCarPoses({ players: state.players, positions, anim, safetyCar: safetyCarAt });
  // The camera follows the car that's moving (or whose turn it is), looking ahead along its heading.
  const focusPose = poses.cars[mover ?? state.current];
  const rad = (focusPose.angle * Math.PI) / 180;
  const ahead = focusPose.driving ? LOOK_AHEAD : LOOK_AHEAD / 2;
  const view = useCamera(
    { x: focusPose.point.x + Math.cos(rad) * ahead, y: focusPose.point.y + Math.sin(rad) * ahead },
    follow ? FOLLOW_ZOOM : 1,
  );

  const focus = positions[mover ?? state.current];
  const live = state.stage !== 'finished';
  const activeBlock = !focus.pit && live ? focus.progress % TRACK_LENGTH : null;
  const activeBox = focus.pit && live ? focus.progress % TRACK_LENGTH : null;
  const request = phase === 'idle' ? state.tyreQueue[0] : undefined;

  if (screen === 'home') {
    return (
      <Home
        accent={ACCENT}
        raceStarted={state.stage !== 'grid' || state.players.some((p) => p.tyre !== null)}
        onPlay={() => setScreen('race')}
        account={account}
        onAccountChange={setAccount}
      />
    );
  }

  return (
    <div className="stage">
      <div
        className="artboard"
        style={{ width: vp.w / scale, height: vp.h / scale, transform: `scale(${scale})` }}
      >
        <div className={`layout ${state.scUntilLap !== null ? 'layout--yellow' : ''}`} style={{ ['--accent' as string]: ACCENT }}>
          <div className="map-wrap">
            <TrackMap view={view} activeBlock={activeBlock} activeBox={activeBox}>
              <Cars players={state.players} poses={poses} mover={mover} />
            </TrackMap>
            {follow && <MiniMap players={state.players} poses={poses} view={view} />}
            <button
              type="button"
              className="cam-toggle cam-toggle--music"
              onClick={toggleMusic}
              aria-pressed={!musicOff}
              title="Music cues play at the big moments: lights out, overtakes, Safety Car, red flag, pit stops, final lap and the win."
            >
              {musicOff ? 'MUSIC OFF' : 'MUSIC ON'}
            </button>
            <button type="button" className="cam-toggle" onClick={() => setFollow((f) => !f)} aria-pressed={follow}>
              {follow ? 'FULL MAP' : 'FOLLOW CAR'}
            </button>
          </div>
          <CenterPanel
            state={state}
            accent={ACCENT}
            phase={phase}
            face={face}
            rollId={rollId}
            caption={caption}
            onRoll={onRoll}
            onBox={onBox}
            onOvertake={onOvertake}
            onHome={() => setScreen('home')}
          />
          {request && <TyrePicker request={request} player={state.players[request.id]} onChoose={onChooseTyre} />}
        </div>
      </div>
    </div>
  );
}
