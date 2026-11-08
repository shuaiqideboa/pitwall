import { describe, expect, it } from 'vitest';
import { CONFIG_RULES, GAME_CONFIG, type GameConfig, validateConfig } from './config';

const withChange = (change: (c: GameConfig) => void): GameConfig => {
  const copy = structuredClone(GAME_CONFIG);
  change(copy);
  return copy;
};

describe('game config', () => {
  it('ships a valid default config', () => {
    expect(validateConfig(GAME_CONFIG)).toEqual([]);
  });

  it('rejects values outside their allowed range', () => {
    expect(validateConfig(withChange((c) => (c.race.laps = 50)))).toEqual([
      'race.laps must be between 1 and 10 (got 50)',
    ]);
    expect(validateConfig(withChange((c) => (c.pitLane.speedLimit = 0)))[0]).toMatch(/pitLane.speedLimit/);
  });

  it('rejects fractions where a whole number is needed', () => {
    expect(validateConfig(withChange((c) => (c.overtaking.cost = 1.5)))).toEqual([
      'overtaking.cost must be a whole number (got 1.5)',
    ]);
  });

  it('checks every die face', () => {
    expect(validateConfig(withChange((c) => (c.tyres.soft.faces = [3, 4, 5, 6, 7])))).toEqual([
      'tyres.soft.faces must be six numbers',
    ]);
    expect(validateConfig(withChange((c) => (c.tyres.hard.faces[2] = 12)))).toEqual([
      'tyres.hard.faces[2] must be between 1 and 9 (got 12)',
    ]);
  });

  it('keeps tyre wear consistent', () => {
    expect(validateConfig(withChange((c) => (c.tyres.hard.lifeLaps = 2)))).toEqual([
      'tyres.hard: wornFaces and lifeLaps must both be set, or both be null',
    ]);
  });

  it('always leaves a real chance of a clean pass, even at the riskiest allowed odds', () => {
    const max = (path: string) => CONFIG_RULES.find((r) => r.path === path)!.max;
    for (const key of ['risk', 'drsRisk']) {
      const worst = max(`overtaking.${key}.safety-car`) + max(`overtaking.${key}.red-flag`);
      expect(1 - worst).toBeGreaterThanOrEqual(0.2 - 1e-9); // at least a 20% clean pass
    }
  });

  it('rejects things that are not numbers at all', () => {
    const broken = withChange((c) => ((c.camera as unknown as Record<string, unknown>).followZoom = 'very close'));
    expect(validateConfig(broken)).toEqual(['camera.followZoom must be a number']);
  });
});
