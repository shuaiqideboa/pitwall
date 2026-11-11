import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOTAL_LAPS } from './board';
import { type Compound } from './config';
import { type GameState, type Player, chooseTyre, decideOvertake, lapOf, newGame, rollStart, takeTurn, toggleBox } from './engine';
import { TYRES, tyreLaps } from './tyres';

// Plays thousands of seeded races between scripted strategies and checks the
// game stays healthy and balanced. If a config change breaks this test, the
// change made the race unfinishable or one-sided; the failure says which.

const GAMES = 3000;
const MAX_TURNS = 2000;

/** Small seeded random generator (mulberry32), so every run plays the same races. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TyrePlan {
  name: string;
  start: Compound;
  next: Compound;
  /** Call the box this lap? */
  box: (p: Player) => boolean;
}

/** Box while the set still has under a lap of life left. */
const nearWorn = (p: Player) => {
  const life = p.tyre ? TYRES[p.tyre].lifeLaps : null;
  return life !== null && life - tyreLaps(p) <= 1;
};

const TYRE_PLANS: TyrePlan[] = [
  { name: 'Softs every lap', start: 'soft', next: 'soft', box: (p) => nearWorn(p) && lapOf(p) < TOTAL_LAPS - 1 },
  { name: 'Soft → Hard', start: 'soft', next: 'hard', box: (p) => p.stops === 0 && nearWorn(p) },
  { name: 'Medium → Medium', start: 'medium', next: 'medium', box: (p) => p.stops === 0 && nearWorn(p) },
  { name: 'Hard → late Softs', start: 'hard', next: 'soft', box: (p) => p.stops === 0 && lapOf(p) >= TOTAL_LAPS - 2 },
  { name: 'Hard → Hard', start: 'hard', next: 'hard', box: (p) => p.stops === 0 && lapOf(p) >= 2 },
];

const OVERTAKE_STYLES = ['always', 'DRS only', 'never'] as const;
type Style = (typeof OVERTAKE_STYLES)[number];

interface Results {
  plays: Record<string, number>;
  wins: Record<string, number>;
  winnersWithoutStop: number;
  unfinished: number;
}

function simulate(): Results {
  const rand = Math.random;
  const r: Results = { plays: {}, wins: {}, winnersWithoutStop: 0, unfinished: 0 };
  const add = (rec: Record<string, number>, key: string) => (rec[key] = (rec[key] ?? 0) + 1);

  for (let g = 0; g < GAMES; g++) {
    const plans = Array.from({ length: 4 }, () => TYRE_PLANS[Math.floor(rand() * TYRE_PLANS.length)]);
    const styles = Array.from({ length: 4 }, () => OVERTAKE_STYLES[Math.floor(rand() * OVERTAKE_STYLES.length)]);
    plans.forEach((p) => add(r.plays, p.name));
    plans.forEach((_, seat) => add(r.plays, `seat ${seat + 1}`));
    styles.forEach((s) => add(r.plays, `overtake: ${s}`));

    let st: GameState = newGame();
    let turns = 0;
    while (st.stage !== 'finished' && turns < MAX_TURNS) {
      if (st.tyreQueue.length) {
        const req = st.tyreQueue[0];
        const plan = plans[req.id];
        st = chooseTyre(st, req.reason === 'grid' ? plan.start : req.reason === 'red-flag' ? null : plan.next);
        continue;
      }
      if (st.stage === 'grid') {
        st = rollStart(st);
        continue;
      }
      if (st.overtake) {
        const style: Style = styles[st.overtake.id];
        st = decideOvertake(st, style === 'always' || (style === 'DRS only' && st.overtake.drs));
      } else {
        const me = st.players[st.current];
        if (!me.inPit && !me.boxCalled && plans[me.id].box(me)) st = toggleBox(st);
        st = takeTurn(st);
        turns++;
      }
    }

    if (st.winner === null) {
      r.unfinished++;
      continue;
    }
    if (st.players[st.winner].stops === 0) r.winnersWithoutStop++;
    add(r.wins, plans[st.winner].name);
    add(r.wins, `overtake: ${styles[st.winner]}`);
    add(r.wins, `seat ${st.winner + 1}`);
  }
  return r;
}

let results: Results;
const winRate = (key: string) => (results.wins[key] ?? 0) / results.plays[key];

beforeAll(() => {
  vi.spyOn(Math, 'random').mockImplementation(seeded(2611));
  results = simulate();
});
afterAll(() => vi.restoreAllMocks());

describe(`balance over ${GAMES} simulated races`, () => {
  it('every race finishes and its winner has made the mandatory stop', () => {
    expect.soft(results.unfinished, 'unfinished races').toBe(0);
    expect.soft(results.winnersWithoutStop, 'winners without a stop').toBe(0);
  });

  it('every tyre plan stays a contender (10–50% wins)', () => {
    for (const { name } of TYRE_PLANS) {
      expect.soft(winRate(name), name).toBeGreaterThan(0.1);
      expect.soft(winRate(name), name).toBeLessThan(0.5);
    }
  });

  it('every seat has a fair chance (15–35% wins)', () => {
    for (const seat of [1, 2, 3, 4]) {
      expect.soft(winRate(`seat ${seat}`), `seat ${seat}`).toBeGreaterThan(0.15);
      expect.soft(winRate(`seat ${seat}`), `seat ${seat}`).toBeLessThan(0.35);
    }
  });

  it('going for overtakes pays off, but not overwhelmingly', () => {
    expect(winRate('overtake: always')).toBeGreaterThan(winRate('overtake: never'));
    expect(winRate('overtake: always')).toBeLessThan(0.65);
    expect(winRate('overtake: never')).toBeGreaterThan(0.03);
  });
});
