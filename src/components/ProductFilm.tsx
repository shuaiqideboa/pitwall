import { useEffect, useRef, useState } from 'react';
import { createFilmRenderer } from '../film/renderer';
import { createFilmSoundtrack } from '../film/soundtrack';
import { recordFilm } from '../film/record';
import { captionAt, chapterAt, FILM_CHAPTERS, FILM_DURATION } from '../film/script';
import './product-film.css';

type FilmRenderer = ReturnType<typeof createFilmRenderer>;
type Soundtrack = Awaited<ReturnType<typeof createFilmSoundtrack>>;
const clock = (time: number) => `00:${Math.floor(Math.max(0, time)).toString().padStart(2, '0')}`;

function Icon({ name }: { name: 'play' | 'pause' | 'sound' | 'mute' | 'full' | 'download' | 'close' | 'replay' | 'loop' }) {
  const paths = {
    play: 'm8 5 11 7-11 7Z', pause: 'M8 5v14M16 5v14',
    sound: 'M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
    mute: 'M11 5 6 9H3v6h3l5 4ZM16 9l6 6M22 9l-6 6',
    full: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    close: 'm6 6 12 12M6 18 18 6', replay: 'M3 10a9 9 0 1 1 1 7M3 3v7h7',
    loop: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function ProductFilm({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FilmRenderer | null>(null);
  const soundtrack = useRef<Soundtrack | null>(null);
  const pendingAudio = useRef<Promise<Soundtrack> | null>(null);
  const audioEpoch = useRef(0);
  const playRequest = useRef(0);
  const position = useRef(0);
  const playingRef = useRef(false);
  const exportingRef = useRef(false);
  const exportAbort = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [looping, setLooping] = useState(true);
  const loopingRef = useRef(true);
  const [audioLoading, setAudioLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [audioNotice, setAudioNotice] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadExt, setDownloadExt] = useState('webm');
  const [transcript, setTranscript] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const chapter = chapterAt(time);

  const ensureAudio = async () => {
    if (soundtrack.current) return soundtrack.current;
    if (!pendingAudio.current) pendingAudio.current = createFilmSoundtrack();
    const pending = pendingAudio.current;
    const epoch = audioEpoch.current;
    try {
      const audio = await pending;
      if (!mounted.current || epoch !== audioEpoch.current) { audio.dispose(); return null; }
      soundtrack.current = audio;
      audio.setMuted(mutedRef.current);
      setAudioNotice('');
      return audio;
    } catch {
      if (pendingAudio.current === pending) pendingAudio.current = null;
      if (mounted.current && epoch === audioEpoch.current) setAudioNotice('Narration and music could not load. You can watch silently or try playing again.');
      return null;
    }
  };

  const pause = () => {
    playRequest.current++;
    playingRef.current = false;
    setPlaying(false);
    setAudioLoading(false);
    soundtrack.current?.pause();
  };
  const play = async () => {
    if (!ready || exportingRef.current) return;
    const request = ++playRequest.current;
    playingRef.current = false;
    setPlaying(false);
    soundtrack.current?.pause();
    if (position.current >= FILM_DURATION) {
      position.current = 0;
      setTime(0);
      renderer.current?.render(0.8);
    }
    setAudioLoading(true);
    // Start initialization inside the user's gesture, then hold this frame until
    // the complete mix is ready. Narration must never begin halfway through.
    const audio = await ensureAudio();
    if (!mounted.current || request !== playRequest.current || exportingRef.current) return;
    audio?.play(position.current);
    renderer.current?.render(position.current);
    playingRef.current = true;
    setPlaying(true);
    setAudioLoading(false);
  };
  const seek = (value: number) => {
    if (exportingRef.current) return;
    playRequest.current++;
    setAudioLoading(false);
    position.current = Math.max(0, Math.min(FILM_DURATION, value));
    setTime(position.current);
    renderer.current?.render(!playingRef.current && position.current === 0 ? 0.8 : position.current);
    if (position.current >= FILM_DURATION) pause();
    else if (playingRef.current) soundtrack.current?.play(position.current);
  };
  const toggleSound = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    soundtrack.current?.setMuted(next);
    if (!next && !soundtrack.current && playingRef.current) void play();
  };
  const toggleLoop = () => {
    loopingRef.current = !loopingRef.current;
    setLooping(loopingRef.current);
  };

  useEffect(() => {
    mounted.current = true;
    setReady(false);
    setPlaying(false);
    setAudioLoading(false);
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    let instance: FilmRenderer | null = null;
    let disposed = false;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const resize = () => {
      if (exportingRef.current || !instance) return;
      const { width, height } = stage.getBoundingClientRect();
      instance.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
      instance.render(!playingRef.current && position.current === 0 ? 0.8 : position.current);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const lost = (event: Event) => {
      event.preventDefault();
      pause();
      exportAbort.current?.abort();
      setError('The 3D player lost its graphics connection. Close and reopen the film to try again.');
      setReady(false);
    };
    canvas.addEventListener('webglcontextlost', lost);
    const visibility = () => {
      if (document.hidden && !exportingRef.current) pause();
      last = performance.now();
    };
    document.addEventListener('visibilitychange', visibility);
    void document.fonts.ready.then(() => {
      if (disposed) return;
      try {
        instance = createFilmRenderer(canvas);
        renderer.current = instance;
        resize();
        setReady(true);
        // Explicit Play both respects reduced motion and gives audio a real
        // user gesture. The poster is at 0.8s, but the film starts from 0s.
        last = performance.now();
        const frame = (now: number) => {
          if (playingRef.current && !exportingRef.current) {
            const audioTime = soundtrack.current?.getCurrentTime();
            position.current = Math.min(FILM_DURATION, Math.max(0, audioTime ?? position.current + Math.max(0, now - last) / 1000));
            if (position.current >= FILM_DURATION && loopingRef.current) {
              // Restart the complete mix and visual timeline together. Export
              // runs on its own clock and always records one 48-second film.
              position.current = 0;
              soundtrack.current?.play(0);
              lastUi = 0;
            }
            instance?.render(position.current);
            if (now - lastUi > 80 || position.current === FILM_DURATION) {
              setTime(position.current);
              lastUi = now;
            }
            if (position.current >= FILM_DURATION) pause();
          }
          last = now;
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      } catch {
        setError('This browser cannot start the 3D film. Try a browser with WebGL enabled, or read the film transcript below.');
        setTranscript(true);
      }
    });
    return () => {
      disposed = true;
      mounted.current = false;
      audioEpoch.current++;
      playRequest.current++;
      playingRef.current = false;
      exportAbort.current?.abort();
      observer.disconnect();
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', lost);
      document.removeEventListener('visibilitychange', visibility);
      instance?.dispose();
      renderer.current = null;
      soundtrack.current?.dispose();
      soundtrack.current = null;
      pendingAudio.current = null;
      document.body.style.overflow = oldOverflow;
      dialog.close();
    };
  }, []);

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const exportVideo = async () => {
    if (!renderer.current || exportingRef.current) return;
    pause();
    const restoreTime = position.current;
    setError('');
    setExporting(true);
    exportingRef.current = true;
    const abort = new AbortController();
    exportAbort.current = abort;
    try {
      const audio = await ensureAudio();
      if (abort.signal.aborted || !mounted.current) return;
      if (!audio) throw new Error('The narration and music must load before export. Please try Save film again.');
      const instance = renderer.current!;
      instance.resize(1280, 720, 1);
      const blob = await recordFilm({
        canvas: canvasRef.current!, render: (seconds) => instance.render(seconds), audio,
        signal: abort.signal, onProgress: (seconds) => { position.current = seconds; setTime(seconds); },
      });
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      setDownloadExt(extension);
      setDownloadUrl(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pitwall-the-next-lap.${extension}`;
      link.click();
    } catch (cause) {
      if (mounted.current && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Video export could not finish. Please try again.');
      }
    } finally {
      exportingRef.current = false;
      exportAbort.current = null;
      if (mounted.current) {
        setExporting(false);
        position.current = restoreTime;
        setTime(restoreTime);
        const { width, height } = stageRef.current!.getBoundingClientRect();
        renderer.current?.resize(width, height, Math.min(window.devicePixelRatio || 1, 2));
        renderer.current?.render(restoreTime === 0 ? 0.8 : restoreTime);
      }
    }
  };

  const fullscreen = () => {
    if (expanded) { setExpanded(false); return; }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (shellRef.current?.requestFullscreen) void shellRef.current.requestFullscreen().catch(() => {
      setExpanded(true);
    });
    else setExpanded(true);
  };

  return (
    <dialog className={`product-film${expanded ? ' product-film--expanded' : ''}`} ref={dialogRef} aria-labelledby="product-film-title" onCancel={(event) => { event.preventDefault(); if (expanded) setExpanded(false); else onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`product-film__shell${expanded ? ' product-film__shell--expanded' : ''}`} ref={shellRef} onKeyDown={(event) => {
        if ((event.target as HTMLElement).tagName === 'INPUT' || (event.target as HTMLElement).tagName === 'BUTTON' || exporting) return;
        if (event.code === 'Space') { event.preventDefault(); playing || audioLoading ? pause() : void play(); }
        if (event.code === 'ArrowLeft') { event.preventDefault(); seek(position.current - 5); }
        if (event.code === 'ArrowRight') { event.preventDefault(); seek(position.current + 5); }
      }}>
        <header className="product-film__header">
          <div><span className="product-film__wordmark">PITWALL<span>●</span></span><span className="product-film__edition" id="product-film-title">THE NEXT LAP · A PRODUCT FILM</span></div>
          <button className="product-film__icon" type="button" onClick={onClose} aria-label="Close film" autoFocus><Icon name="close" /></button>
        </header>
        <div className="product-film__stage" ref={stageRef} tabIndex={0} aria-label="Pitwall product film. Space to play or pause, arrow keys to seek.">
          <canvas ref={canvasRef} width="1280" height="720" role="img" aria-label="Animated product film. Full text is available in the transcript." />
          {!ready && !error && <div className="product-film__loading"><span />Preparing the film…</div>}
          {audioLoading && <div className="product-film__loading" role="status"><span />Preparing narration &amp; music…</div>}
          {ready && !playing && !audioLoading && !exporting && <button className="product-film__center-play" onClick={() => void play()} aria-label={time >= FILM_DURATION ? 'Replay film' : 'Play film'}><Icon name={time >= FILM_DURATION ? 'replay' : 'play'} /></button>}
        </div>
        <p className="product-film__mobile-caption">{captionAt(time) || '\u00a0'}</p>
        <div className="product-film__controls">
          <input className="product-film__seek" type="range" min="0" max={FILM_DURATION} step="0.1" value={time} onChange={(event) => seek(Number(event.target.value))} disabled={!ready || exporting} aria-label="Film progress" aria-valuetext={`${clock(time)} of 00:48, ${chapter.label}`} style={{ '--film-progress': `${time / FILM_DURATION * 100}%` } as React.CSSProperties} />
          <div className="product-film__toolbar">
            <div className="product-film__tools">
              <button className="product-film__icon" type="button" disabled={!ready || exporting} onClick={playing || audioLoading ? pause : () => void play()} aria-label={playing || audioLoading ? 'Pause film' : 'Play film'}><Icon name={playing || audioLoading ? 'pause' : 'play'} /></button>
              <button className="product-film__icon" type="button" disabled={!ready || exporting} onClick={toggleSound} aria-label={muted ? 'Turn audio on' : 'Mute audio'} aria-pressed={!muted}><Icon name={muted ? 'mute' : 'sound'} /></button>
              <span className="product-film__clock">{clock(time)} <span>/ 00:48</span></span>
              {muted && <span className="product-film__sound-hint">SOUND ON FOR THE FULL EXPERIENCE</span>}
            </div>
            <div className="product-film__tools">
              <button className="product-film__export product-film__loop" type="button" disabled={!ready || exporting} onClick={toggleLoop} aria-label="Loop film" aria-pressed={looping} title={looping ? 'Turn looping off' : 'Turn looping on'}><Icon name="loop" /><span>Loop {looping ? 'on' : 'off'}</span></button>
              {exporting ? <button className="product-film__text-button" onClick={() => exportAbort.current?.abort()}>Cancel export</button> : <button className="product-film__export" type="button" onClick={() => void exportVideo()} disabled={!ready} aria-label="Download film as a video"><Icon name="download" /><span>Save film</span></button>}
              <button className="product-film__icon" type="button" onClick={fullscreen} aria-label="Fullscreen"><Icon name="full" /></button>
            </div>
          </div>
          <nav className="product-film__chapters" aria-label="Film chapters">
            {FILM_CHAPTERS.map((item, index) => <button key={item.start} type="button" disabled={!ready || exporting} aria-current={chapter === item ? 'step' : undefined} onClick={() => seek(item.start + 0.35)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}
          </nav>
          {exporting && <p className="product-film__notice" role="status">Preparing your video · {Math.round(time / FILM_DURATION * 100)}%. Keep this tab visible for the 48-second export.</p>}
          {error && <p className="product-film__notice product-film__notice--error" role="alert">{error}</p>}
          {audioNotice && <p className="product-film__notice" role="status">{audioNotice}</p>}
          {downloadUrl && !exporting && <p className="product-film__notice">Your film is ready. <a href={downloadUrl} download={`pitwall-the-next-lap.${downloadExt}`}>Download again</a></p>}
          <div className="product-film__bottom"><span>AI-GENERATED NARRATION · ORIGINAL SCORE</span><button type="button" className="product-film__text-button" onClick={() => setTranscript(!transcript)} aria-expanded={transcript}>Transcript {transcript ? '−' : '+'}</button></div>
          {transcript && <ol className="product-film__transcript">{FILM_CHAPTERS.map((item) => <li key={item.start}><time>{clock(item.start)}</time><p><strong>{item.label}</strong>{item.caption}</p></li>)}</ol>}
        </div>
      </div>
    </dialog>
  );
}
