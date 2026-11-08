// Short music cues for the big moments of a race, synthesised with the Web
// Audio API (original motifs, no audio files). Browsers only allow sound
// after the player has clicked something, so the context is created lazily.

export type Cue = 'lights-out' | 'overtake' | 'safety-car' | 'red-flag' | 'pit-stop' | 'final-lap' | 'win';

type Wave = OscillatorType;
/** [midi note, start beat, length in beats] */
type Note = [number, number, number];

const MUTE_KEY = 'f1-music-muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
/** Cues played, newest last (lets tests and debugging see what fired). */
export const cueLog: Cue[] = [];

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Storage blocked: the setting just lasts for this visit.
  }
  if (master) master.gain.value = value ? 0 : 0.5;
}

function audio() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Play notes on one oscillator voice. */
function voice(notes: Note[], { wave = 'square', bpm = 150, gain = 0.18, at = 0 }: { wave?: Wave; bpm?: number; gain?: number; at?: number }) {
  const a = audio();
  if (!a || !master) return;
  const beat = 60 / bpm;
  const t0 = a.currentTime + 0.03 + at;
  for (const [midi, start, len] of notes) {
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = wave;
    osc.frequency.value = hz(midi);
    const s = t0 + start * beat;
    const e = s + len * beat;
    env.gain.setValueAtTime(0, s);
    env.gain.linearRampToValueAtTime(gain, s + 0.012);
    env.gain.setValueAtTime(gain, Math.max(s + 0.012, e - 0.05));
    env.gain.exponentialRampToValueAtTime(0.0001, e);
    osc.connect(env).connect(master);
    osc.start(s);
    osc.stop(e + 0.02);
  }
}

/** Short bursts of filtered noise: a pit crew's wheel gun. */
function wheelGun(times: number[], at = 0) {
  const a = audio();
  if (!a || !master) return;
  const len = 0.09;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  for (const t of times) {
    const src = a.createBufferSource();
    const band = a.createBiquadFilter();
    const env = a.createGain();
    src.buffer = buffer;
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 1.2;
    env.gain.value = 0.5;
    src.connect(band).connect(env).connect(master);
    src.start(a.currentTime + 0.03 + at + t);
  }
}

const CUES: Record<Cue, () => void> = {
  // Five start lights, a beat of silence, then lights out and away.
  'lights-out': () => {
    voice([[69, 0, 0.35], [69, 1, 0.35], [69, 2, 0.35], [69, 3, 0.35], [69, 4, 0.35]], { wave: 'sine', bpm: 140, gain: 0.25 });
    voice([[60, 0, 0.5], [64, 0.5, 0.5], [67, 1, 0.5], [72, 1.5, 2]], { wave: 'sawtooth', bpm: 180, gain: 0.12, at: 2.6 });
    voice([[48, 0, 3.5]], { wave: 'triangle', bpm: 180, gain: 0.2, at: 2.6 });
  },
  overtake: () => {
    voice([[67, 0, 0.5], [71, 0.5, 0.5], [74, 1, 0.5], [79, 1.5, 1.5]], { bpm: 220, gain: 0.12 });
    voice([[55, 0, 3]], { wave: 'triangle', bpm: 220, gain: 0.18 });
  },
  'safety-car': () => {
    voice([[76, 0, 1], [72, 1, 1], [69, 2, 1], [68, 3, 2]], { wave: 'triangle', bpm: 150, gain: 0.22 });
    voice([[45, 0, 1], [45, 1, 1], [45, 2, 1], [44, 3, 2]], { wave: 'square', bpm: 150, gain: 0.08 });
  },
  'red-flag': () => {
    voice([[45, 0, 4]], { wave: 'sawtooth', bpm: 100, gain: 0.12 });
    voice([[52, 0, 4]], { wave: 'sawtooth', bpm: 100, gain: 0.1 });
    voice([[57, 0, 1], [56, 1, 3]], { wave: 'triangle', bpm: 100, gain: 0.2 });
  },
  'pit-stop': () => {
    wheelGun([0, 0.11, 0.22, 0.6, 0.71, 0.82]);
    voice([[79, 0, 0.6], [84, 0.6, 1.2]], { wave: 'sine', bpm: 160, gain: 0.2, at: 1.05 });
  },
  'final-lap': () => {
    voice([[62, 0, 0.5], [66, 0.5, 0.5], [69, 1, 0.5], [74, 1.5, 0.5], [78, 2, 2]], { wave: 'square', bpm: 200, gain: 0.11 });
    voice([[50, 0, 4]], { wave: 'triangle', bpm: 200, gain: 0.2 });
  },
  win: () => {
    voice([[60, 0, 0.5], [64, 0.5, 0.5], [67, 1, 0.5], [72, 1.5, 1], [67, 2.5, 0.5], [72, 3, 3]], { wave: 'square', bpm: 160, gain: 0.12 });
    voice([[76, 3, 3]], { wave: 'square', bpm: 160, gain: 0.08 });
    voice([[79, 3, 3]], { wave: 'sine', bpm: 160, gain: 0.12 });
    voice([[48, 0, 1.5], [43, 1.5, 1.5], [48, 3, 3]], { wave: 'triangle', bpm: 160, gain: 0.22 });
  },
};

export function playCue(cue: Cue) {
  cueLog.push(cue);
  if (muted) return;
  try {
    CUES[cue]();
  } catch {
    // Audio unavailable (e.g. blocked by the browser): play silently on.
  }
}
