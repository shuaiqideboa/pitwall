import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOTAL_LAPS } from './board';
import { type Compound } from './config';
import { type GameState, type Player, chooseTyre, decideOvertake, lapOf, lightsOut, newGame, takeTurn, toggleBox } from './engine';
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
  turns: number[];
  safetyCars: number;
  redFlags: number;
  winnersWithoutStop: number;
  unfinished: number;
}

function simulate(): Results {
  const rand = Math.random;
  const r: Results = { plays: {}, wins: {}, turns: [], safetyCars: 0, redFlags: 0, winnersWithoutStop: 0, unfinished: 0 };
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
        st = lightsOut(st);
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
      if (st.incident?.kind === 'safety-car') r.safetyCars++;
      if (st.incident?.kind === 'red-flag') r.redFlags++;
    }

    if (st.winner === null) {
      r.unfinished++;
      continue;
    }
    r.turns.push(turns);
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
  it('every race finishes', () => {
    expect(results.unfinished).toBe(0);
  });

  it('nobody wins without making the mandatory stop', () => {
    expect(results.winnersWithoutStop).toBe(0);
  });

  it('races take a sensible number of turns', () => {
    const avg = results.turns.reduce((a, b) => a + b, 0) / results.turns.length;
    expect(avg).toBeGreaterThan(80);
    expect(avg).toBeLessThan(160);
  });

  it.each(TYRE_PLANS.map((p) => p.name))('tyre plan "%s" stays a contender (10–50% wins)', (name) => {
    expect(winRate(name)).toBeGreaterThan(0.1);
    expect(winRate(name)).toBeLessThan(0.5);
  });

  it.each([1, 2, 3, 4])('seat %i has a fair chance (15–35% wins)', (seat) => {
    expect(winRate(`seat ${seat}`)).toBeGreaterThan(0.15);
    expect(winRate(`seat ${seat}`)).toBeLessThan(0.35);
  });

  it('going for overtakes pays off, but not overwhelmingly', () => {
    expect(winRate('overtake: always')).toBeGreaterThan(winRate('overtake: never'));
    expect(winRate('overtake: always')).toBeLessThan(0.65);
    expect(winRate('overtake: never')).toBeGreaterThan(0.03);
  });

  it('Safety Cars and red flags happen, but stay occasional', () => {
    const sc = results.safetyCars / GAMES;
    const rf = results.redFlags / GAMES;
    expect(sc).toBeGreaterThan(0.3);
    expect(sc).toBeLessThan(2);
    expect(rf).toBeGreaterThan(0.02);
    expect(rf).toBeLessThan(0.4);
  });
});
