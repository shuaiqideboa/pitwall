import { FILM_DURATION, NARRATION_CUES } from './script';
import { scheduleHeroicScore } from './heroic-score';

export interface FilmSoundtrack {
  /** Restart the same score at an exact position in the film, in seconds. */
  play(offset: number): void;
  pause(): void;
  /** Current sample-clock position, or null while paused. */
  getCurrentTime(): number | null;
  /** Mute the speakers only. Exports always contain both narration and score. */
  setMuted(muted: boolean): void;
  getStream(): MediaStream;
  dispose(): void;
}

const SAMPLE_RATE = 44_100;
let score: Promise<AudioBuffer> | undefined;

/** One offline master locks narration, music and export to sample time. */
export async function renderFilmMix(): Promise<AudioBuffer> {
  const audio = new OfflineAudioContext(2, SAMPLE_RATE * FILM_DURATION, SAMPLE_RATE);
  const clips = await Promise.all(NARRATION_CUES.map(async (cue) => {
    const response = await fetch(cue.url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Narration could not load (${response.status}).`);
    const buffer = await audio.decodeAudioData(await response.arrayBuffer());
    if (Math.abs(buffer.duration - cue.duration) > 0.06 || cue.start + buffer.duration > cue.chapterEnd - 0.2) {
      throw new Error('Narration timing has changed. Regenerate the film cue timings.');
    }
    return buffer;
  }));

  const finalMix = audio.createGain();
  const limiter = audio.createDynamicsCompressor();
  limiter.threshold.value = -5;
  limiter.knee.value = 5;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.14;
  const output = audio.createGain();
  output.gain.value = 0.94;
  finalMix.connect(limiter).connect(output).connect(audio.destination);

  const music = audio.createGain();
  music.gain.setValueAtTime(0.95, 0);
  for (const cue of NARRATION_CUES) {
    // Give the voice a clear foreground, then let the fanfare answer it.
    music.gain.setValueAtTime(0.95, Math.max(0, cue.start - 0.22));
    music.gain.linearRampToValueAtTime(0.24, cue.start - 0.035);
    music.gain.setValueAtTime(0.24, cue.start + cue.duration + 0.07);
    music.gain.linearRampToValueAtTime(0.95, cue.start + cue.duration + 0.58);
  }
  music.connect(finalMix);
  scheduleHeroicScore(audio, music);

  const voice = audio.createGain();
  voice.gain.value = 1.05;
  const voiceFilter = audio.createBiquadFilter();
  voiceFilter.type = 'highpass';
  voiceFilter.frequency.value = 85;
  voiceFilter.Q.value = 0.55;
  voice.connect(voiceFilter).connect(finalMix);
  clips.forEach((buffer, index) => {
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(voice);
    source.start(NARRATION_CUES[index].start);
  });
  return audio.startRendering();
}

export async function createFilmSoundtrack(): Promise<FilmSoundtrack> {
  // Create and try to unlock before the first await: callers can invoke this
  // directly from the Play button's gesture, including on mobile Safari.
  const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
  void audio.resume().catch(() => { /* A later Play gesture can unlock it. */ });
  const destination = audio.createMediaStreamDestination();
  const monitor = audio.createGain();
  monitor.connect(audio.destination);

  let buffer: AudioBuffer;
  try {
    score ??= renderFilmMix().catch((error: unknown) => {
      score = undefined;
      throw error;
    });
    buffer = await score;
  } catch (error) {
    destination.stream.getTracks().forEach((track) => track.stop());
    void audio.close();
    throw error;
  }

  let source: AudioBufferSourceNode | null = null;
  let disposed = false;
  let startedAt = 0;
  let startedOffset = 0;
  const pause = () => {
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  };

  return {
    play(offset) {
      if (disposed) return;
      pause();
      const position = Math.min(FILM_DURATION, Math.max(0, Number.isFinite(offset) ? offset : 0));
      if (position >= FILM_DURATION) return;
      void audio.resume().catch(() => { /* Silent playback remains available. */ });
      const next = audio.createBufferSource();
      next.buffer = buffer;
      // The recording path deliberately precedes the speaker mute control.
      next.connect(destination);
      next.connect(monitor);
      next.onended = () => {
        next.disconnect();
        if (source === next) source = null;
      };
      startedAt = audio.currentTime;
      startedOffset = position;
      next.start(startedAt, position);
      source = next;
    },
    pause,
    getCurrentTime: () => source ? Math.min(FILM_DURATION, startedOffset + audio.currentTime - startedAt) : null,
    setMuted(muted) {
      if (disposed) return;
      monitor.gain.setTargetAtTime(muted ? 0 : 1, audio.currentTime, 0.015);
    },
    getStream: () => destination.stream,
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      monitor.disconnect();
      destination.disconnect();
      destination.stream.getTracks().forEach((track) => track.stop());
      void audio.close();
    },
  };
}
