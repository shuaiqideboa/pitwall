"""Normalize recorded narration, repair streaming WAV headers and emit cue timings."""
from array import array
import json
from pathlib import Path
import sys
import wave

starts = [0.65, 6.65, 13.65, 22.65, 29.65, 36.65, 43.65]
ends = [6, 13, 22, 29, 36, 43, 48]
cues = []
for index, (start, scene_end) in enumerate(zip(starts, ends), 1):
    path = Path(f'public/film/narration/{index:02}.wav')
    with wave.open(str(path)) as source:
        assert source.getsampwidth() == 2 and source.getnchannels() == 1
        rate = source.getframerate()
        samples = array('h', source.readframes(source.getnframes()))
    if sys.byteorder != 'little':
        samples.byteswap()
    # Trim only silent outer edges; leave natural breaths and internal pauses.
    block = rate // 100
    active = [i for i in range(0, len(samples), block)
              if sum((x / 32768) ** 2 for x in samples[i:i+block]) / block > 0.000016]
    if not active:
        raise ValueError(f'No speech found: {path}')
    first = max(0, active[0] - int(rate * .045))
    last = min(len(samples), active[-1] + block + int(rate * .1))
    samples = samples[first:last]
    peak = max(abs(x) for x in samples) / 32768
    rms = (sum((x / 32768) ** 2 for x in samples) / len(samples)) ** .5
    gain = min(.82 / peak, .17 / rms)
    fade = int(rate * .004)
    samples = array('h', [round(x * gain * min(1, i / fade, (len(samples) - 1 - i) / fade))
                          for i, x in enumerate(samples)])
    duration = len(samples) / rate
    if start + duration > scene_end - .25:
        raise ValueError(f'{path} overruns its chapter: {duration:.3f}s')
    if sys.byteorder != 'little':
        samples.byteswap()
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        output.writeframes(samples.tobytes())
    cues.append({'start': start, 'duration': round(duration, 5), 'url': f'/film/narration/{index:02}.wav'})
    print(f'{index:02}: {start:.2f}–{start + duration:.2f}s; voice {duration:.3f}s')

Path('src/film/narration-timing.ts').write_text(
    '// Generated from measured WAV durations by scripts/prepare-film-narration.py.\n'
    'export const NARRATION_TIMING = ' + json.dumps(cues, indent=2) + ' as const;\n'
)
