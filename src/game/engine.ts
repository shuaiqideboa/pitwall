import {
  PIT_BOX_INDEX,
  PIT_ENTRY_INDEX,
  PIT_LENGTH,
  PIT_SPEED_LIMIT,
  PIT_TILES,
  TILES,
  TOTAL_LAPS,
  TRACK_LENGTH,
  type Tile,
} from './board';
import { GAME_CONFIG, type IncidentKind, type Risk } from './config';
import { type Compound, TYRES, type TyreState, dieFaces } from './tyres';

export type { IncidentKind, Risk };

export interface Player extends TyreState {
  id: number;
  name: string;
  color: string;
  /** Text color on top of `color` (for the numbered token). */
  ink: string;
  /**
   * Total blocks travelled; lap = floor(progress / TRACK_LENGTH). In the pit
   * lane it is the progress of the track block alongside the car's box.
   */
  progress: number;
  inPit: boolean;
  /** The car will take the pit entry next time it passes it. */
  boxCalled: boolean;
  /** Tyre stops made this race (at least one is mandatory). */
  stops: number;
}

/** A player who has to pick tyres before play continues. */
export interface TyreRequest {
  id: number;
  reason: 'grid' | 'pit-stop' | 'red-flag';
}

/** One block of movement, for animating cars. `pause` marks the start of a new move. */
export interface Hop {
  id: number;
  progress: number;
  pit: boolean;
  pause: boolean;
  /** What caused this move; set on the first hop of each move. */
  label?: string;
  /** This move starts at the same moment as the one before it (the field getting away at lights out). */
  together?: boolean;
}


export interface Incident {
  kind: IncidentKind;
  /** The car that tried the overtake, then the car(s) it was passing. */
  cars: number[];
  tile: string;
}

/** The current turn, carried across an overtake decision. */
interface TurnState {
  id: number;
  roll: number;
  /** Blocks still to drive this turn. */
  budget: number;
  /** Boxes covered in the pit lane this turn (for the limiter). */
  pitSteps: number;
  sc: boolean;
  notes: string[];
  tyreQueue: TyreRequest[];
}

/** A car has caught the one in front and its player must decide. */
export interface OvertakeChoice {
  id: number;
  /** The car(s) directly ahead, on the next block. */
  rivals: number[];
  /** The pass happens in a DRS zone (lower risk). */
  drs: boolean;
  risk: Risk;
  turn: TurnState;
}

export interface GameState {
  players: Player[];
  stage: 'grid' | 'race' | 'finished';
  current: number;
  lastRoll: number | null;
  /** Which face of the die came up (0–5), so the 3D die can land on it. */
  lastFace: number | null;
  /** On the grid: each player's start roll so far, in seat order. */
  startRolls: number[];
  /** Tyre choices waiting to be made, first one shown. */
  tyreQueue: TyreRequest[];
  /**
   * While the Safety Car is out: the lap the leader must reach for it to come
   * in (it stays out until the leader next crosses Start/Finish). Else null.
   */
  scUntilLap: number | null;
  /** Waiting for the current player to decide whether to overtake. */
  overtake: OvertakeChoice | null;
  /** Incident caused by the last action, if any. */
  incident: Incident | null;
  /** Every hop made during the last action, in order. */
  trace: Hop[];
  log: string;
  winner: number | null;
}

export const PLAYER_SETUP: Pick<Player, 'name' | 'color' | 'ink'>[] = [
  { name: 'Player 1', color: '#D7261E', ink: '#FFFFFF' },
  { name: 'Player 2', color: '#3366D6', ink: '#FFFFFF' },
  { name: 'Player 3', color: '#E8742A', ink: '#16171B' },
  { name: 'Player 4', color: '#1E9E8F', ink: '#FFFFFF' },
];

/** Behind the Safety Car every car moves at most this many blocks a turn. */
export const SC_SPEED_LIMIT = GAME_CONFIG.safetyCar.speedLimit;
/** When the Safety Car comes out the field closes up to at most this gap (blocks). */
export const SC_MAX_GAP = GAME_CONFIG.safetyCar.maxGap;
/**
 * Pitting under the Safety Car is cheap, as in real F1: the pit limiter is
 * raised and the crew is ready, so the tyre change doesn't end the move.
 */
export const SC_PIT_SPEED_LIMIT = GAME_CONFIG.pitLane.safetyCarSpeedLimit;

/** Risk of an overtake attempt anywhere but a DRS zone. */
export const OVERTAKE_RISK: Risk = GAME_CONFIG.overtaking.risk;
/** Risk of an overtake attempt into a DRS zone. */
export const DRS_RISK: Risk = GAME_CONFIG.overtaking.drsRisk;
/** Passing takes this many blocks of the roll: onto the rival's block and past it. */
export const OVERTAKE_COST = GAME_CONFIG.overtaking.cost;

export const cleanChance = (risk: Risk) => 1 - risk['safety-car'] - risk['red-flag'];

function rollIncident(risk: Risk): IncidentKind | null {
  let r = Math.random();
  for (const kind of ['safety-car', 'red-flag'] as const) {
    r -= risk[kind];
    if (r < 0) return kind;
  }
  return null;
}

export const lapOf = (p: Player) => Math.floor(p.progress / TRACK_LENGTH);
export const indexOf = (p: { progress: number }) => p.progress % TRACK_LENGTH;
/** The block a car is on: a track block, or a pit lane box. */
export const tileAt = (progress: number, pit: boolean): Tile =>
  pit ? PIT_TILES[progress % TRACK_LENGTH] : TILES[progress % TRACK_LENGTH];

/** A car that hasn't stopped is called in on its final lap. */
export const mustBox = (p: Player) => p.stops === 0 && lapOf(p) >= TOTAL_LAPS - 1;

export function newGame(): GameState {
  const players: Player[] = PLAYER_SETUP.map((p, id) => ({
    ...p,
    id,
    progress: 0,
    inPit: false,
    boxCalled: false,
    stops: 0,
    tyre: null,
    fittedAt: 0,
  }));
  return {
    players,
    stage: 'grid',
    current: 0,
    lastRoll: null,
    lastFace: null,
    startRolls: [],
    tyreQueue: players.map((p) => ({ id: p.id, reason: 'grid' })),
    scUntilLap: null,
    overtake: null,
    incident: null,
    trace: [],
    log: 'Choose starting tyres',
    winner: null,
  };
}

export function raceOrder(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.progress - a.progress || a.id - b.id);
}

const rollFace = () => Math.floor(Math.random() * 6);
const nextPlayer = (players: Player[], from: number) => (from + 1) % players.length;
/** Over the line on track, with the mandatory stop done. A car without a
 * stop just keeps going and is called in at the next pit entry. */
const isFinished = (p: Player) => lapOf(p) >= TOTAL_LAPS && !p.inPit && p.stops > 0;

/** Call the car in (or cancel the call) for the next pass of the pit entry. */
export function toggleBox(state: GameState): GameState {
  const me = state.players[state.current];
  if (state.stage !== 'race' || state.tyreQueue.length > 0 || state.overtake || me.inPit || mustBox(me)) return state;
  const players = state.players.map((p) => (p.id === me.id ? { ...p, boxCalled: !p.boxCalled } : p));
  return {
    ...state,
    players,
    trace: [],
    log: players[me.id].boxCalled ? `${me.name}: box, box! Pit this lap.` : `${me.name} stays out.`,
  };
}

/**
 * Answer the first tyre request. `compound` null keeps the current set
 * (only offered under a red flag).
 */
export function chooseTyre(state: GameState, compound: Compound | null): GameState {
  const [request, ...rest] = state.tyreQueue;
  if (!request) return state;
  const players = state.players.map((p) => ({ ...p }));
  const p = players[request.id];
  if (compound !== null) {
    p.tyre = compound;
    p.fittedAt = p.progress;
  }
  const tyre = compound ? `${TYRES[compound].name}s` : 'the same tyres';

  if (request.reason === 'grid') {
    const ready = rest.length === 0 ? ` All cars on the grid: ${players[state.current].name} to roll for the start.` : '';
    return { ...state, players, tyreQueue: rest, log: `${p.name} starts on ${tyre}.${ready}` };
  }

  // A pit stop always counts; under a red flag only an actual change does.
  if (request.reason === 'pit-stop' || compound !== null) p.stops += 1;
  const log = request.reason === 'pit-stop' ? `${p.name} fits ${tyre}.` : `${p.name} restarts on ${tyre}.`;
  const resumed = rest.length === 0 ? ` ${players[state.current].name} to move.` : '';
  return { ...state, players, tyreQueue: rest, log: log + resumed };
}

/**
 * The start, once every car has its starting tyres: each player in turn
 * rolls their start die, and nobody moves yet. When the last player has
 * rolled, the lights go out and the whole field gets away together, so
 * nobody gains from moving first off the grid. Cars can share a block. The
 * car that got away slowest (a random one of them, if tied) makes the first
 * move; play then carries on in seat order.
 */
export function rollStart(state: GameState, face = rollFace()): GameState {
  if (state.stage !== 'grid' || state.tyreQueue.length > 0) return state;
  const me = state.players[state.current];
  const rolls = [...state.startRolls, dieFaces(me)[face]];
  if (rolls.length < state.players.length) {
    const next = nextPlayer(state.players, state.current);
    return {
      ...state,
      current: next,
      startRolls: rolls,
      lastRoll: rolls[rolls.length - 1],
      lastFace: face,
      trace: [],
      log: `${me.name} rolls ${rolls[rolls.length - 1]} for the start. ${state.players[next].name} to roll.`,
    };
  }

  const players = state.players.map((p) => ({ ...p }));
  const trace: Hop[] = [];
  const label = `LIGHTS OUT! ${players.map((p, i) => `${p.name} rolls ${rolls[i]}`).join(' · ')}`;
  players.forEach((p, i) => {
    for (let step = 0; step < rolls[i]; step++) {
      p.progress += 1;
      const first = step === 0;
      trace.push({ id: p.id, progress: p.progress, pit: false, pause: first, together: first && i > 0, label: first && i === 0 ? label : undefined });
    }
  });
  const slowest = Math.min(...rolls);
  const tied = players.filter((_, i) => rolls[i] === slowest);
  const first = tied[Math.floor(Math.random() * tied.length)];
  return {
    ...state,
    players,
    stage: 'race',
    current: first.id,
    startRolls: rolls,
    lastRoll: rolls[rolls.length - 1],
    lastFace: face,
    trace,
    log: `Lights out! ${first.name} got away slowest, so moves first.`,
  };
}

/** Roll and drive. The move may stop behind another car and ask for an overtake decision. */
export function takeTurn(state: GameState, face = rollFace()): GameState {
  if (state.stage !== 'race' || state.tyreQueue.length > 0 || state.overtake) return state;

  const me = state.players[state.current];
  const roll = dieFaces(me)[face];
  const sc = state.scUntilLap !== null;
  const limit = sc ? SC_SPEED_LIMIT : Infinity;
  const budget = Math.min(roll, limit);
  const turn: TurnState = {
    id: me.id,
    roll,
    budget,
    pitSteps: 0,
    sc,
    notes: [`${me.name} rolled ${roll}`],
    tyreQueue: [],
  };
  if (budget < roll) turn.notes.push(`Safety Car: limited to ${budget}`);
  const under = sc ? ' behind the Safety Car' : '';
  const label = `${me.name} drives ${budget} block${budget === 1 ? '' : 's'}${under}`;

  const next: GameState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    lastRoll: roll,
    lastFace: face,
    incident: null,
    trace: [],
  };
  return drive(next, turn, label);
}

/** Answer the overtake question: go for it, or stay behind and end the move. */
export function decideOvertake(state: GameState, go: boolean): GameState {
  const choice = state.overtake;
  if (!choice) return state;
  const next: GameState = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    overtake: null,
    incident: null,
    trace: [],
  };
  const turn: TurnState = { ...choice.turn, notes: [...choice.turn.notes], tyreQueue: [...choice.turn.tyreQueue] };
  const me = next.players[choice.id];
  const rivals = choice.rivals.map((id) => next.players[id]);
  const names = rivals.map((p) => p.name).join(' and ');

  if (!go) {
    turn.notes.push(`stays behind ${names}`);
    next.trace.push({ id: me.id, progress: me.progress, pit: false, pause: true, label: `${me.name} stays behind ${names}` });
    return finishTurn(next, turn);
  }

  const tile = TILES[(indexOf(me) + 1) % TRACK_LENGTH].name;
  const kind = rollIncident(choice.risk);
  if (kind === null) {
    turn.notes.push(`overtakes ${names}${choice.drs ? ' with DRS' : ''}`);
    const label = `${me.name} overtakes ${names}${choice.drs ? ' with DRS' : ''}!`;
    for (let i = 0; i < OVERTAKE_COST; i++) {
      me.progress += 1;
      next.trace.push({ id: me.id, progress: me.progress, pit: false, pause: i === 0, label: i === 0 ? label : undefined });
    }
    turn.budget -= OVERTAKE_COST;
    return drive(next, turn, `${me.name} drives on`, true);
  }

  // The move fails: the car stays behind, and the incident hits the whole field.
  next.incident = { kind, cars: [me.id, ...choice.rivals], tile };
  const who = `${me.name} and ${names} touch at ${tile}`;
  if (kind === 'safety-car') {
    next.scUntilLap = lapOf(raceOrder(next.players)[0]) + 1;
    turn.notes.push(`${who}: SAFETY CAR`);
    safetyCar(next.players, next.trace, `${who}! SAFETY CAR: the field closes up, no overtaking`);
  } else {
    next.scUntilLap = null;
    turn.notes.push(`${who}: RED FLAG`);
    redFlag(next.players, next.trace, `${who}! RED FLAG: the field restarts nose-to-tail`);
    for (const p of raceOrder(next.players)) turn.tyreQueue.push({ id: p.id, reason: 'red-flag' });
  }
  return finishTurn(next, turn);
}

/**
 * Drive the rest of the turn block by block. Stops behind a car that is
 * directly ahead and asks the player whether to overtake (only when racing
 * and with enough of the roll left to get past).
 */
function drive(state: GameState, turn: TurnState, label: string, resumed = false): GameState {
  const me = state.players[turn.id];
  let pause = !resumed;
  const hop = () => {
    state.trace.push({ id: me.id, progress: me.progress, pit: me.inPit, pause, label: pause ? label : undefined });
    pause = false;
  };

  while (turn.budget > 0) {
    if (me.inPit) {
      if (turn.pitSteps >= (turn.sc ? SC_PIT_SPEED_LIMIT : PIT_SPEED_LIMIT)) {
        turn.notes.push('held by the pit limiter');
        break;
      }
      if (indexOf(me) === PIT_LENGTH - 1) {
        me.inPit = false; // rejoin at the pit exit
        turn.notes.push('rejoins the track');
      }
      me.progress += 1;
      turn.pitSteps += 1;
      turn.budget -= 1;
      hop();
      if (me.inPit && indexOf(me) === PIT_BOX_INDEX) {
        turn.tyreQueue.push({ id: me.id, reason: 'pit-stop' });
        if (!turn.sc) {
          turn.notes.push('stops at the box');
          break;
        }
        turn.notes.push('quick stop under the Safety Car');
      }
      continue;
    }

    if (indexOf(me) === PIT_ENTRY_INDEX && (me.boxCalled || mustBox(me))) {
      if (!me.boxCalled) turn.notes.push('called in for the mandatory stop');
      me.inPit = true;
      me.boxCalled = false;
      turn.pitSteps = 1;
      turn.notes.push('enters the pit lane');
      me.progress += 1;
      turn.budget -= 1;
      hop();
      continue;
    }

    // Cars racing me on the next block. Lapped cars wave me through (blue flags).
    const ahead = state.players.filter(
      (p) => p.id !== me.id && !p.inPit && indexOf(p) === (indexOf(me) + 1) % TRACK_LENGTH && p.progress > me.progress,
    );
    if (ahead.length > 0) {
      const names = ahead.map((p) => p.name).join(' and ');
      if (turn.sc) {
        turn.notes.push('no overtaking behind the Safety Car');
        break;
      }
      if (turn.budget < OVERTAKE_COST) {
        turn.notes.push(`follows ${names}`);
        break;
      }
      const drs = TILES[(indexOf(me) + 1) % TRACK_LENGTH].drs === true;
      turn.notes.push(`catches ${names}`);
      return {
        ...state,
        overtake: { id: me.id, rivals: ahead.map((p) => p.id), drs, risk: drs ? DRS_RISK : OVERTAKE_RISK, turn },
        log: `${me.name} is right behind ${names}${drs ? ' in a DRS zone' : ''}. Overtake?`,
      };
    }

    me.progress += 1;
    turn.budget -= 1;
    hop();
    if (isFinished(me)) break;
  }
  return finishTurn(state, turn);
}

function finishTurn(state: GameState, turn: TurnState): GameState {
  const { players } = state;
  const notes = turn.notes;

  // The Safety Car comes in once the leader has crossed Start/Finish again.
  if (turn.sc && state.scUntilLap !== null && lapOf(raceOrder(players)[0]) >= state.scUntilLap) {
    state.scUntilLap = null;
    notes.push('Safety Car in, racing resumes');
  }

  const finished = raceOrder(players).find(isFinished);
  if (finished) {
    return {
      ...state,
      stage: 'finished',
      current: finished.id,
      tyreQueue: [],
      overtake: null,
      log: `${finished.name} wins the Australian GP!`,
      winner: finished.id,
    };
  }

  const next = nextPlayer(players, state.current);
  return {
    ...state,
    stage: 'race',
    current: next,
    overtake: null,
    tyreQueue: turn.tyreQueue,
    log: `${notes.join(' · ').replace(/\.?$/, '.')} ${players[next].name} to move.`,
    winner: null,
  };
}

/**
 * Safety Car: the field closes up behind it, every gap cut to at most
 * SC_MAX_GAP blocks, keeping the order. Cars in the pit lane carry on there.
 * Nobody is retired or penalised; tyres aren't changed (but a stop now
 * costs less, see SC_PIT_SPEED_LIMIT).
 */
function safetyCar(players: Player[], trace: Hop[], label: string) {
  const onTrack = raceOrder(players).filter((p) => !p.inPit);
  let labelled = false;
  onTrack.forEach((p, i) => {
    if (i === 0) return;
    const ahead = onTrack[i - 1].progress;
    // Close up to the gap limit, single file behind the car ahead.
    const progress = Math.min(ahead - 1, Math.max(p.progress, ahead - SC_MAX_GAP));
    if (progress === p.progress) return;
    if (progress < p.progress) {
      // Sharing a block: drop in one behind (a glide, not a reverse).
      p.progress = progress;
      trace.push({ id: p.id, progress, pit: false, pause: true, label: labelled ? undefined : label });
      labelled = true;
      return;
    }
    let pause = true;
    while (p.progress !== progress) {
      p.progress += 1;
      trace.push({ id: p.id, progress: p.progress, pit: false, pause, label: pause && !labelled ? label : undefined });
      pause = false;
    }
    labelled = true;
  });
  if (!labelled) {
    const leader = onTrack[0] ?? players[0];
    trace.push({ id: leader.id, progress: leader.progress, pit: leader.inPit, pause: true, label });
  }
}

/**
 * Red flag: the race is suspended and restarts with the field nose-to-tail
 * behind the leader, every gap closed but the order kept. Nobody is retired
 * or penalised. Cars in the pit lane rejoin the track, and every team may
 * change tyres (queued by the caller).
 */
function redFlag(players: Player[], trace: Hop[], label: string) {
  const order = raceOrder(players);
  const leader = order[0].progress;
  order.forEach((p, i) => {
    const progress = Math.max(0, leader - i);
    p.fittedAt += progress - p.progress; // the regroup doesn't age tyres
    p.inPit = false;
    p.boxCalled = false;
    p.progress = progress;
    trace.push({ id: p.id, progress: p.progress, pit: false, pause: true, label: i === 0 ? label : undefined });
  });
}
