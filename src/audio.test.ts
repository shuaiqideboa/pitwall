import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A stand-in for the browser's audio. Like a real AudioContext created
// outside a click, it starts suspended; it records what gets played.
const started = vi.fn();
const created: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  constructor() {
    created.push(this);
  }
  private node() {
    const param = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
    return { gain: param, frequency: param, Q: param, buffer: null, connect: (next: unknown) => next, start: started, stop() {} };
  }
  createDynamicsCompressor = () => this.node();
  createGain = () => this.node();
  createOscillator = () => this.node();
  createBiquadFilter = () => this.node();
  createBufferSource = () => this.node();
  createBuffer = () => ({ getChannelData: () => new Float32Array(1) });
}

let audio: typeof import('./audio');
const page = new EventTarget();

beforeAll(async () => {
  vi.stubGlobal('window', Object.assign(page, { AudioContext: FakeAudioContext }));
  audio = await import('./audio');
});
afterAll(() => vi.unstubAllGlobals());

describe('music cues', () => {
  it('stays silent when muted, plays when enabled, and resumes after browser suspension', () => {
    audio.setMuted(true);
    page.dispatchEvent(new Event('click'));
    audio.playCue('overtake');
    expect(created).toHaveLength(0);
    expect(started).not.toHaveBeenCalled();

    audio.setMuted(false);
    audio.playCue('music-on');
    expect(created).toHaveLength(1);
    expect(created[0].resume).toHaveBeenCalled();
    expect(started).toHaveBeenCalled();

    const ctx = created[0];
    for (const type of ['click', 'keydown']) {
      ctx.state = 'suspended';
      ctx.resume.mockClear();
      page.dispatchEvent(new Event(type));
      expect(ctx.resume).toHaveBeenCalledTimes(1);
      expect(ctx.state).toBe('running');
    }
    expect(created).toHaveLength(1); // the same audio, not a new one each time
  });
});
