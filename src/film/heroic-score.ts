import { FILM_DURATION } from './script';

const FLOOR = 0.00001;
const BEAT = 7 / 16; // Four bars land exactly on the seven-second middle acts.
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) | 0;
    return (value >>> 0) / 4_294_967_296;
  };
}

/**
 * Original orchestral-action cue, composed for this film's seven acts.
 * Its six-note fanfare, voicings and rhythms are newly composed; no film theme,
 * recording, soundfont or external instrument sample is used. The caller owns
 * narration ducking and the final mix. All synthesis is seeded and seekable
 * after the OfflineAudioContext has rendered it into a single audio buffer.
 */
export function scheduleHeroicScore(audio: OfflineAudioContext, destination: AudioNode): void {
  const orchestra = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  compressor.threshold.value = -13;
  compressor.knee.value = 15;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.17;
  const tone = audio.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 9_000;
  tone.Q.value = 0.4;
  const master = audio.createGain();
  master.gain.setValueAtTime(FLOOR, 0);
  master.gain.linearRampToValueAtTime(0.88, 0.12);
  master.gain.setValueAtTime(0.88, 46.6);
  master.gain.exponentialRampToValueAtTime(FLOOR, 47.96);
  orchestra.connect(compressor).connect(tone).connect(master).connect(destination);

  // A compact hall, with distinct early reflections instead of an endless pad.
  const hall = audio.createConvolver();
  const impulse = audio.createBuffer(2, Math.ceil(audio.sampleRate * 1.45), audio.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const noise = seeded(9701 + channel * 391);
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      low = low * 0.63 + (noise() * 2 - 1) * 0.37;
      const t = i / audio.sampleRate;
      data[i] = t < 0.022 ? 0 : low * Math.exp(-t * 4.7);
    }
    for (const [delay, level] of [[0.031, 0.5], [0.059, 0.31], [0.087, 0.19]]) {
      data[Math.floor((delay + channel * 0.006) * audio.sampleRate)] += level;
    }
  }
  hall.buffer = impulse;
  const hallLowpass = audio.createBiquadFilter();
  hallLowpass.type = 'lowpass';
  hallLowpass.frequency.value = 4_500;
  const hallLevel = audio.createGain();
  hallLevel.gain.value = 0.24;
  hall.connect(hallLowpass).connect(hallLevel).connect(orchestra);

  const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  const random = seeded(0x50495457);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = random() * 2 - 1;

  const brassPartials = new Float32Array(25);
  const stringPartials = new Float32Array(33);
  for (let n = 1; n < brassPartials.length; n++) {
    // Strong low harmonics and a restrained upper formant, softened by the bell.
    brassPartials[n] = (1 / n ** 0.85) * (n < 7 ? 1 : 0.65);
  }
  for (let n = 1; n < stringPartials.length; n++) {
    stringPartials[n] = (n % 2 ? 1 : 0.78) / n ** 1.1;
  }
  const brassWave = audio.createPeriodicWave(new Float32Array(brassPartials.length), brassPartials);
  const stringWave = audio.createPeriodicWave(new Float32Array(stringPartials.length), stringPartials);

  function route(node: AudioNode, pan: number, wet = 0.2) {
    const stereo = audio.createStereoPanner();
    stereo.pan.value = pan;
    node.connect(stereo).connect(orchestra);
    if (wet > 0) {
      const send = audio.createGain();
      send.gain.value = wet;
      stereo.connect(send).connect(hall);
    }
  }

  function brass(note: number, at: number, length: number, level = 0.08, pan = 0, bright = false) {
    if (at >= FILM_DURATION) return;
    const end = Math.min(at + length, FILM_DURATION - 0.01);
    const duration = end - at;
    if (duration < 0.04) return;
    const attack = Math.min(0.075, duration * 0.17);
    const envelope = audio.createGain();
    const bell = audio.createBiquadFilter();
    bell.type = 'lowpass';
    bell.Q.value = 0.6;
    bell.frequency.setValueAtTime(bright ? 750 : 430, at);
    bell.frequency.exponentialRampToValueAtTime(bright ? 3_300 : 2_100, at + attack * 1.8);
    bell.frequency.exponentialRampToValueAtTime(bright ? 1_650 : 1_100, end);
    envelope.gain.setValueAtTime(FLOOR, at);
    envelope.gain.linearRampToValueAtTime(level, at + attack);
    envelope.gain.linearRampToValueAtTime(level * 0.78, at + duration * 0.43);
    envelope.gain.setValueAtTime(level * 0.74, Math.max(at + duration * 0.43, end - 0.13));
    envelope.gain.exponentialRampToValueAtTime(FLOOR, end);
    bell.connect(envelope);
    route(envelope, pan, 0.55);
    [-6, 1, 7].forEach((detune, index) => {
      const oscillator = audio.createOscillator();
      const voice = audio.createGain();
      oscillator.setPeriodicWave(brassWave);
      oscillator.frequency.value = hz(note);
      // A tiny ensemble scoop makes the attack breathe rather than beep.
      oscillator.detune.setValueAtTime(detune - 13, at);
      oscillator.detune.linearRampToValueAtTime(detune, at + attack * 1.7);
      oscillator.detune.linearRampToValueAtTime(detune + (index - 1) * 1.5, end);
      voice.gain.value = index === 1 ? 0.4 : 0.3;
      oscillator.connect(voice).connect(bell);
      oscillator.start(at);
      oscillator.stop(end + 0.01);
    });
  }

  function strings(note: number, at: number, length: number, level = 0.032, pan = -0.35, legato = false) {
    if (at >= FILM_DURATION) return;
    const end = Math.min(at + length, FILM_DURATION - 0.01);
    const duration = end - at;
    if (duration < 0.035) return;
    const envelope = audio.createGain();
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.45;
    filter.frequency.setValueAtTime(legato ? 2_500 : 4_000, at);
    filter.frequency.exponentialRampToValueAtTime(legato ? 2_200 : 1_750, end);
    const attack = Math.min(legato ? 0.22 : 0.018, duration * 0.3);
    envelope.gain.setValueAtTime(FLOOR, at);
    envelope.gain.linearRampToValueAtTime(level, at + attack);
    if (legato) envelope.gain.setValueAtTime(level * 0.85, Math.max(at + attack, end - 0.2));
    else envelope.gain.exponentialRampToValueAtTime(level * 0.42, at + duration * 0.55);
    envelope.gain.exponentialRampToValueAtTime(FLOOR, end);
    filter.connect(envelope);
    route(envelope, pan, legato ? 0.4 : 0.23);
    [-9, 0, 8].forEach((detune, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.setPeriodicWave(stringWave);
      oscillator.frequency.value = hz(note);
      oscillator.detune.value = detune;
      gain.gain.value = index === 1 ? 0.44 : 0.28;
      oscillator.connect(gain).connect(filter);
      oscillator.start(at + index * 0.0015);
      oscillator.stop(end + 0.01);
    });
    // Brief bow friction on accented notes keeps the section from sounding like an organ.
    if (level > 0.034) {
      const bow = audio.createBufferSource();
      const band = audio.createBiquadFilter();
      const gain = audio.createGain();
      bow.buffer = noiseBuffer;
      band.type = 'bandpass';
      band.frequency.value = 2_700;
      band.Q.value = 0.7;
      gain.gain.setValueAtTime(level * 0.14, at);
      gain.gain.exponentialRampToValueAtTime(FLOOR, at + Math.min(0.07, duration));
      bow.connect(band).connect(gain).connect(envelope);
      bow.start(at, (at * 0.113) % 1);
      bow.stop(at + Math.min(0.08, duration));
    }
  }

  function lowDrum(at: number, level: number, pitch = 70, pan = 0) {
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(FLOOR, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.007);
    envelope.gain.exponentialRampToValueAtTime(FLOOR, at + 0.68);
    route(envelope, pan, 0.3);
    [[1, 0.8], [1.58, 0.19], [2.17, 0.1]].forEach(([ratio, volume]) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.setValueAtTime(pitch * ratio * 1.5, at);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * ratio, at + 0.075);
      gain.gain.value = volume;
      oscillator.connect(gain).connect(envelope);
      oscillator.start(at);
      oscillator.stop(Math.min(FILM_DURATION, at + 0.7));
    });
    const attack = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    attack.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.value = 1_200;
    gain.gain.setValueAtTime(level * 0.22, at);
    gain.gain.exponentialRampToValueAtTime(FLOOR, at + 0.055);
    attack.connect(filter).connect(gain).connect(orchestra);
    attack.start(at, (at * 0.39) % 1);
    attack.stop(Math.min(FILM_DURATION, at + 0.06));
  }

  function snare(at: number, level: number, pan = 0.12) {
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const envelope = audio.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 2_400;
    filter.Q.value = 0.45;
    envelope.gain.setValueAtTime(level, at);
    envelope.gain.exponentialRampToValueAtTime(FLOOR, at + 0.15);
    source.connect(filter).connect(envelope);
    route(envelope, pan, 0.35);
    source.start(at, (at * 0.27) % 1);
    source.stop(Math.min(FILM_DURATION, at + 0.17));
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    body.frequency.setValueAtTime(210, at);
    body.frequency.exponentialRampToValueAtTime(150, at + 0.08);
    bodyGain.gain.setValueAtTime(level * 0.35, at);
    bodyGain.gain.exponentialRampToValueAtTime(FLOOR, at + 0.11);
    body.connect(bodyGain).connect(orchestra);
    body.start(at); body.stop(Math.min(FILM_DURATION, at + 0.12));
  }

  function cymbal(at: number, level = 0.1, length = 1.25, reverse = false) {
    const source = audio.createBufferSource();
    const highpass = audio.createBiquadFilter();
    const envelope = audio.createGain();
    source.buffer = noiseBuffer;
    source.loop = true;
    highpass.type = 'highpass';
    highpass.frequency.value = reverse ? 2_500 : 4_200;
    highpass.Q.value = 0.5;
    envelope.gain.setValueAtTime(reverse ? FLOOR : level, at);
    if (reverse) {
      envelope.gain.exponentialRampToValueAtTime(level, at + length - 0.035);
      envelope.gain.linearRampToValueAtTime(FLOOR, at + length);
    } else envelope.gain.exponentialRampToValueAtTime(FLOOR, at + length);
    source.connect(highpass).connect(envelope);
    route(envelope, -0.1, 0.45);
    source.start(at);
    source.stop(Math.min(FILM_DURATION, at + length + 0.01));
  }

  const harmonies = [
    { root: 38, notes: [62, 65, 69] }, // D minor: determined, rather than ominous.
    { root: 34, notes: [62, 65, 70] }, // B-flat major.
    { root: 41, notes: [60, 65, 69] }, // F major.
    { root: 36, notes: [60, 64, 67] }, // C major.
  ];

  function rhythmicAct(start: number, end: number, strength: number, sequence = [0, 1, 2, 3]) {
    const bar = BEAT * 4;
    for (let b = 0; start + b * bar < end; b++) {
      const at = start + b * bar;
      const harmony = harmonies[sequence[b % sequence.length]];
      const remaining = end - at;
      brass(harmony.root + 12, at, Math.min(BEAT * 1.5, remaining), 0.07 * strength, -0.18);
      lowDrum(at, 0.24 * strength, b % 2 ? 79 : 63, -0.1);
      for (let eighth = 0; eighth < 8; eighth++) {
        const t = at + eighth * BEAT / 2;
        if (t > end - 0.08) continue;
        const accented = eighth === 0 || eighth === 3 || eighth === 6;
        const pattern = [0, 1, 2, 0, 2, 1, 0, 2];
        const note = harmony.notes[pattern[eighth]];
        strings(note + 12, t, Math.min(BEAT * 0.44, end - t), (accented ? 0.043 : 0.027) * strength, -0.35);
        if (eighth % 2 === 0) {
          strings(harmony.root + 12, t + 0.008, Math.min(BEAT * 0.75, end - t), 0.041 * strength, 0.28);
        }
        if (eighth === 3 || eighth === 6) lowDrum(t, 0.105 * strength, eighth === 3 ? 89 : 74, 0.25);
        if (eighth === 2 || eighth === 6) snare(t, 0.065 * strength);
        if (eighth === 7 && b % 2 === 1 && t + BEAT / 4 < end) snare(t + BEAT / 4, 0.04 * strength, -0.1);
      }
    }
  }

  /** Original rising fanfare: D–F–B-flat–A–G–D, with a syncopated answer. */
  function fanfare(at: number, strength = 1, major = false, pace = BEAT) {
    const notes = major ? [62, 66, 71, 69, 67, 74] : [62, 65, 70, 69, 67, 74];
    const starts = [0, 1, 1.5, 2.5, 3.25, 4];
    const lengths = [0.78, 0.38, 0.78, 0.52, 0.52, 1.65];
    notes.forEach((note, index) => {
      brass(note, at + starts[index] * pace, lengths[index] * pace, 0.105 * strength, -0.08, true);
      if (index === 0 || index === 2 || index === 5) {
        brass(note - 12, at + starts[index] * pace + 0.012, lengths[index] * pace, 0.065 * strength, 0.2);
      }
    });
  }

  // 0–6: a clear identity statement and a breath before the story begins.
  lowDrum(0.08, 0.31, 58);
  cymbal(0.08, 0.065, 1.4);
  [38, 50, 57, 62].forEach((note, i) => brass(note, 0.08 + i * 0.025, 1.25, 0.055, (i - 1.5) * 0.16));
  [62, 69, 74].forEach((note, i) => strings(note, 1.2 + i * 0.23, 0.8, 0.021, -0.35 + i * 0.3, true));
  fanfare(3.45, 0.72, false, 0.36);
  cymbal(5.35, 0.045, 0.65, true);

  // 6–13: articulate movement, leaving room for a player to speak.
  rhythmicAct(6, 13, 0.69);
  fanfare(10.05, 0.62);
  cymbal(12.2, 0.07, 0.8, true);

  // 13–22: the build gains pace. A short pickup leads to four exact bars.
  lowDrum(13, 0.3, 59);
  cymbal(13, 0.09, 1.15);
  for (let i = 0; i < 8; i++) {
    strings([62, 69, 65, 74][i % 4], 13 + i * 0.25, 0.19, 0.043, i % 2 ? 0.3 : -0.3);
  }
  rhythmicAct(15, 22, 0.96, [0, 1, 3, 0]);
  fanfare(18.55, 0.88);
  for (let i = 0; i < 6; i++) snare(21.25 + i * 0.115, 0.035 + i * 0.008, i % 2 ? 0.15 : -0.15);
  cymbal(21.2, 0.075, 0.8, true);

  // 22–29: a broad, brighter answer for the community.
  cymbal(22, 0.11, 1.4);
  rhythmicAct(22, 29, 1.0, [1, 2, 3, 0]);
  [65, 69, 74].forEach((note, i) => strings(note, 22.1, 2.3, 0.026, (i - 1) * 0.45, true));
  fanfare(25.5, 0.94);
  cymbal(28.4, 0.055, 0.6, true);

  // 29–36: pull back at the human decision, then rebuild into approval.
  lowDrum(29, 0.23, 63);
  [38, 45, 50].forEach((note, i) => brass(note, 29, 1.1, 0.045, (i - 1) * 0.2));
  for (let i = 0; i < 8; i++) {
    const at = 29.5 + i * BEAT;
    strings(i % 2 ? 69 : 62, at, 0.24, 0.03, -0.25);
    if (i % 2 === 0) lowDrum(at, 0.085, 82, 0.2);
  }
  rhythmicAct(33, 36, 0.84, [3, 0]);
  [57, 62, 65, 69].forEach((note, i) => brass(note, 34 + i * 0.27, 0.56, 0.07, -0.1 + i * 0.07));
  for (let i = 0; i < 8; i++) snare(35.12 + i * 0.105, 0.028 + i * 0.007, i % 2 ? -0.1 : 0.1);
  cymbal(35.2, 0.1, 0.8, true);

  // 36–43: the payoff. Brass, strings and drums finally move together.
  cymbal(36, 0.14, 1.7);
  rhythmicAct(36, 43, 1.12, [0, 1, 2, 3]);
  [62, 65, 69].forEach((note, i) => strings(note + 12, 36.06, 1.5, 0.032, (i - 1) * 0.45, true));
  fanfare(39.2, 1.05);
  cymbal(42.35, 0.07, 0.65, true);

  // 43–48: D major lifts the brand sign-off, then leaves a clean tail.
  lowDrum(43, 0.3, 58);
  cymbal(43, 0.11, 1.7);
  [38, 50, 57, 66].forEach((note, i) => brass(note, 43.02 + i * 0.018, 0.8, 0.06, (i - 1.5) * 0.14, true));
  fanfare(43.75, 0.82, true, 0.34);
  [50, 57, 62, 66, 69].forEach((note, i) => {
    brass(note, 45.8 + i * 0.008, 1.5, 0.04, (i - 2) * 0.16);
    strings(note + 12, 45.85 + i * 0.014, 1.75, 0.019, (i - 2) * 0.2, true);
  });
  lowDrum(45.8, 0.22, 58);
  cymbal(45.8, 0.065, 2.05);
}
