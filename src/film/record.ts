import { FILM_DURATION } from './script';

export interface RecordFilmOptions {
  canvas: HTMLCanvasElement;
  render: (seconds: number) => void;
  audio?: {
    play: (offset: number) => void;
    pause: () => void;
    getStream: () => MediaStream;
    getCurrentTime?: () => number | null;
  };
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

const FRAME_RATE = 30;
const MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
];

/** Record the same wall-clock timeline used by playback, with optional mixed audio. */
export async function recordFilm({
  canvas,
  render,
  audio,
  onProgress,
  signal,
}: RecordFilmOptions): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let recorder: MediaRecorder | undefined;
    let canvasStream: MediaStream | undefined;
    const audioTracks: MediaStreamTrack[] = [];
    const chunks: Blob[] = [];
    let frameId = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let finalFrameTimer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;
    let stopping = false;
    let settled = false;
    let mimeType = '';

    function pauseAudio() {
      // A playback cleanup failure must not leave camera/encoder resources alive.
      try { audio?.pause(); } catch { /* Preserve the recording result or error. */ }
    }

    function cleanup() {
      cancelAnimationFrame(frameId);
      clearTimeout(watchdog);
      clearTimeout(finalFrameTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      signal?.removeEventListener('abort', handleAbort);
      if (recorder) {
        recorder.removeEventListener('start', handleStart);
        recorder.removeEventListener('dataavailable', handleData);
        recorder.removeEventListener('error', handleError);
        recorder.removeEventListener('stop', handleStop);
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* Tracks still need to be released. */ }
        }
      }
      canvasStream?.getTracks().forEach((track) => track.stop());
      // These are our clones. Never stop tracks owned by the shared audio mixer.
      audioTracks.forEach((track) => track.stop());
      pauseAudio();
    }

    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function handleAbort() {
      fail(new DOMException('Film export was cancelled.', 'AbortError'));
    }

    function handleVisibility() {
      if (document.hidden) {
        fail(new Error('Export interrupted because this tab was hidden. Keep the film tab visible and try again.'));
      }
    }

    function handleData(event: BlobEvent) {
      if (event.data.size > 0) chunks.push(event.data);
    }

    function handleError(event: Event) {
      const error = (event as Event & { error?: DOMException }).error;
      fail(error ?? new Error('The browser could not encode this film. Please try another browser.'));
    }

    function handleStop() {
      if (settled) return;
      if (!stopping) {
        fail(new Error('Recording stopped before the film finished. Please try again.'));
        return;
      }
      const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType });
      if (blob.size === 0) {
        fail(new Error('The browser produced an empty video. Please try another browser.'));
        return;
      }
      settled = true;
      cleanup();
      resolve(blob);
    }

    function stopRecording() {
      if (settled) return;
      try {
        stopping = true;
        watchdog = setTimeout(() => {
          fail(new Error('The browser did not finish saving the video. Please try again.'));
        }, 10_000);
        recorder!.stop();
      } catch (error) {
        fail(error);
      }
    }

    function frame(now: number) {
      if (settled) return;
      try {
        // Dropped frames skip ahead in the film instead of stretching its duration.
        const audioTime = audio?.getCurrentTime?.();
        const seconds = Math.min(FILM_DURATION, Math.max(0, audioTime ?? (now - startedAt) / 1000));
        render(seconds);
        onProgress?.(seconds);
        if (settled) return;
        if (seconds >= FILM_DURATION) {
          pauseAudio();
          const track = canvasStream?.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
          track?.requestFrame?.();
          // Give captureStream one frame interval to retain the final rendered card.
          finalFrameTimer = setTimeout(stopRecording, 1000 / FRAME_RATE);
        } else {
          frameId = requestAnimationFrame(frame);
        }
      } catch (error) {
        fail(error);
      }
    }

    function handleStart() {
      if (settled) return;
      clearTimeout(watchdog);
    }

    try {
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      if (document.hidden) {
        handleVisibility();
        return;
      }
      if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
        throw new Error('Video export is not supported by this browser. Please use a current desktop browser.');
      }
      mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
      if (!mimeType) {
        throw new Error('This browser has no supported video encoder. Please try another browser.');
      }

      document.addEventListener('visibilitychange', handleVisibility);
      signal?.addEventListener('abort', handleAbort, { once: true });
      pauseAudio();
      render(0);
      canvasStream = canvas.captureStream(FRAME_RATE);
      if (audio) {
        for (const track of audio.getStream().getAudioTracks()) {
          audioTracks.push(track.clone());
        }
      }
      const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 7_000_000,
        audioBitsPerSecond: 192_000,
      });
      recorder.addEventListener('start', handleStart);
      recorder.addEventListener('dataavailable', handleData);
      recorder.addEventListener('error', handleError);
      recorder.addEventListener('stop', handleStop);
      watchdog = setTimeout(() => {
        fail(new Error('The browser did not start recording. Please try again.'));
      }, 10_000);
      recorder.start(1000);
      // Encoders may wait for the first video/audio samples before emitting
      // `start`. Produce frames immediately instead of waiting on that event.
      startedAt = performance.now();
      audio?.play(0);
      onProgress?.(0);
      if (!settled) frameId = requestAnimationFrame(frame);
    } catch (error) {
      fail(error);
    }
  });
}
