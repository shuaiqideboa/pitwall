import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIT_BOX_INDEX, PIT_ENTRY_INDEX, TOTAL_LAPS, TRACK_LENGTH } from './board';
import { GAME_CONFIG } from './config';
import { type GameState, chooseTyre, decideOvertake, newGame, rollStart, takeTurn, toggleBox } from './engine';

// Everyone on Hards: faces [3, 3, 4, 4, 5, 5], so face index 4 rolls a 5.
const ROLL_5 = 4;
const ROLL_3 = 0;

/** A race in progress with cars at the given progress values. */
function race(progress: number[], current = 0, patch: Partial<GameState> = {}): GameState {
  let st = newGame();
  while (st.tyreQueue.length) st = chooseTyre(st, 'hard');
  while (st.stage === 'grid') st = rollStart(st);
  return {
    ...st,
    ...patch,
    current,
    players: st.players.map((p, i) => ({ ...p, progress: progress[i], fittedAt: progress[i] })),
  };
}

/** Make the next Math.random() calls return these values. */
const randomReturns = (...values: number[]) => {
  const spy = vi.spyOn(Math, 'random');
  values.forEach((v) => spy.mockReturnValueOnce(v));
};

afterEach(() => vi.restoreAllMocks());

describe('starting a race', () => {
  it('waits for all tyres and rolls, then launches everyone together with the slowest moving first', () => {
    let st = newGame();
    expect(st.stage).toBe('grid');
    expect(rollStart(st)).toBe(st); // not before everyone has tyres
    for (let i = 0; i < 4; i++) st = chooseTyre(st, 'hard');
    expect(st.players.every((p) => p.tyre === 'hard')).toBe(true);
    expect(st.stage).toBe('grid');
    expect(st.players.every((p) => p.progress === 0)).toBe(true);
    expect(takeTurn(st)).toBe(st); // no normal turns before the start
    // Hards: faces [3, 3, 4, 4, 5, 5].
    for (const [face, next] of [[ROLL_5, 1], [2, 2], [ROLL_3, 3]]) {
      st = rollStart(st, face);
      expect(st.stage).toBe('grid');
      expect(st.current).toBe(next);
      expect(st.players.every((p) => p.progress === 0)).toBe(true);
      expect(st.trace).toHaveLength(0);
    }
    expect(st.startRolls).toEqual([5, 4, 3]);

    // The last roll ties for slowest; the later car moves first.
    randomReturns(0.99);
    st = rollStart(st, ROLL_3);
    expect(st.stage).toBe('race');
    expect(st.players.map((p) => p.progress)).toEqual([5, 4, 3, 3]);
    expect(st.current).toBe(3);
    expect(st.overtake).toBeNull();
    expect(st.trace).toHaveLength(15);
    // Every car's move starts at the same moment.
    const starts = st.trace.filter((h) => h.pause);
    expect(starts.map((h) => h.id)).toEqual([0, 1, 2, 3]);
    expect(starts.slice(1).every((h) => h.together)).toBe(true);
  });
});

describe('overtaking', () => {
  it('asks before passing and respects either choice', () => {
    const asked = takeTurn(race([10, 12, 0, 0]), ROLL_5);
    expect(asked.overtake?.rivals).toEqual([1]);
    expect(asked.players[0].progress).toBe(11);
    const stayed = decideOvertake(asked, false);
    expect(stayed.players[0].progress).toBe(11);
    expect(stayed.current).toBe(1);

    randomReturns(0.99); // no incident
    const st = decideOvertake(asked, true);
    expect(st.incident).toBeNull();
    // 1 block to catch up, 2 to pass, 2 more: 10 + 5.
    expect(st.players[0].progress).toBe(15);
  });

  it('a failed pass brings out the Safety Car and the car stays behind', () => {
    const asked = takeTurn(race([10, 12, 0, 0]), ROLL_5);
    randomReturns(0.01); // inside the Safety Car chance
    const st = decideOvertake(asked, true);
    expect(st.incident?.kind).toBe('safety-car');
    expect(st.scUntilLap).not.toBeNull();
    expect(st.players[0].progress).toBeLessThan(st.players[1].progress);
  });

  it('a red flag restarts the field nose-to-tail and offers everyone tyres', () => {
    // Blocks 6–8 (Turns 3–5) are outside the DRS zones, so the normal odds apply.
    const asked = takeTurn(race([6, 8, 2, 0]), ROLL_5);
    expect(asked.overtake?.drs).toBe(false);
    randomReturns(GAME_CONFIG.overtaking.risk['safety-car'] + 0.001); // just into the red flag band
    const st = decideOvertake(asked, true);
    expect(st.incident?.kind).toBe('red-flag');
    const sorted = st.players.map((p) => p.progress).sort((a, b) => b - a);
    expect(sorted).toEqual([8, 7, 6, 5]);
    expect(st.tyreQueue.map((r) => r.reason)).toEqual(['red-flag', 'red-flag', 'red-flag', 'red-flag']);
  });

  it('with only 1 block left the car just follows', () => {
    const st = takeTurn(race([10, 15, 0, 0]), ROLL_5); // reaches 14 with 1 to spare
    expect(st.overtake).toBeNull();
    expect(st.players[0].progress).toBe(14);
  });

  it('uses blue flags only when passing a car a lap behind', () => {
    const behind = takeTurn(race([10, TRACK_LENGTH + 11, 0, 0]), ROLL_5);
    expect(behind.overtake?.rivals).toEqual([1]);
    const st = takeTurn(race([TRACK_LENGTH + 10, 11, 0, 0]), ROLL_5);
    expect(st.overtake).toBeNull();
    expect(st.players[0].progress).toBe(TRACK_LENGTH + 15);
  });

  it('nobody overtakes behind the Safety Car', () => {
    const st = takeTurn(race([10, 12, 0, 0], 0, { scUntilLap: 3 }), ROLL_5);
    expect(st.overtake).toBeNull();
    expect(st.players[0].progress).toBe(11);
  });
});

describe('pit lane', () => {
  it('a called car takes the pit entry and is held by the limiter', () => {
    let st = race([PIT_ENTRY_INDEX - 1, 0, 0, 0]);
    st = toggleBox(st);
    st = takeTurn(st, ROLL_5);
    const me = st.players[0];
    expect(me.inPit).toBe(true);
    // One block to the entry, then the limiter allows this many boxes.
    expect(me.progress).toBe(PIT_ENTRY_INDEX + GAME_CONFIG.pitLane.speedLimit);
  });

  it('stops at the box for new tyres, which counts as the stop', () => {
    let st = race([TRACK_LENGTH + PIT_BOX_INDEX - 2, 0, 0, 0]);
    st = { ...st, players: st.players.map((p, i) => (i === 0 ? { ...p, inPit: true } : p)) };
    st = takeTurn(st, ROLL_5);
    expect(st.tyreQueue).toEqual([{ id: 0, reason: 'pit-stop' }]);
    st = chooseTyre(st, 'soft');
    expect(st.players[0].stops).toBe(1);
    expect(st.players[0].tyre).toBe('soft');
  });

  it('a car that has not stopped is called in on its final lap', () => {
    const st = takeTurn(race([(TOTAL_LAPS - 1) * TRACK_LENGTH + PIT_ENTRY_INDEX - 1, 0, 0, 0]), ROLL_3);
    expect(st.players[0].inPit).toBe(true);
    expect(st.stage).toBe('race');
  });

  it('can win across the finish line only after making a stop', () => {
    // Already past the pit entry: forced entry must not mask the finish-rule check.
    const crossedWithoutStop = race([TOTAL_LAPS * TRACK_LENGTH, 0, 0, 0]);
    expect(takeTurn(crossedWithoutStop, ROLL_3)).toMatchObject({ stage: 'race', winner: null });
    const almost = race([TOTAL_LAPS * TRACK_LENGTH - 2, 0, 0, 0]);
    const stopped = { ...almost, players: almost.players.map((p, i) => (i === 0 ? { ...p, stops: 1 } : p)) };
    expect(takeTurn(stopped, ROLL_5)).toMatchObject({ stage: 'finished', winner: 0 });
  });
});
