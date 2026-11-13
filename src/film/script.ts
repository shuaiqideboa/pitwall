/** One deterministic timeline drives the film, captions, chapters and export. */
import { NARRATION_TIMING } from './narration-timing';

export const FILM_DURATION = 48;
export const FILM_WIDTH = 1920;
export const FILM_HEIGHT = 1080;

export const FILM_CHAPTERS = [
  { start: 0, end: 6, label: 'The idea', kicker: 'A GAME THAT LISTENS', title: ['Great games.', 'Built together.'], caption: 'What if your next idea could change the game?', detail: 'PITWALL / FROM PLAYER TO CO-CREATOR' },
  { start: 6, end: 13, label: 'Suggest', kicker: '01 / YOUR VOICE', title: ['You play.', 'You have an idea.'], caption: 'Tell Pit Wall what could be better. In your own words.', detail: 'SUGGEST A CHANGE, RIGHT INSIDE THE GAME' },
  { start: 13, end: 22, label: 'Build', kicker: '02 / AI AT WORK', title: ['An idea in.', 'A tested change out.'], caption: 'An AI agent reads the code, builds the change, and tests it.', detail: 'READ THE CODE → MAKE THE CHANGE → RUN THE CHECKS' },
  { start: 22, end: 29, label: 'Vote', kicker: '03 / THE COMMUNITY', title: ['Good ideas.', 'A shared voice.'], caption: 'Players vote. The ideas people care about rise to the top.', detail: 'REAL PLAYERS. SHARED PRIORITIES.' },
  { start: 29, end: 36, label: 'Approve', kicker: '04 / HUMAN IN CONTROL', title: ['AI does the work.', 'You make the call.'], caption: 'The developer reviews a clear summary and approves the change.', detail: 'WHAT CHANGED · IMPACT · RISK · CHECKS' },
  { start: 36, end: 43, label: 'Go live', kicker: '05 / BACK TO THE GAME', title: ['Better for one.', 'Fairer for everyone.'], caption: 'After approval and deployment, players see their ideas go live.', detail: 'REAL EXAMPLE / A FAIRER START, SHIPPED IN PR #9' },
  { start: 43, end: 48, label: 'Pitwall', kicker: 'THE NEXT LAP IS YOURS', title: ['Pitwall.'], caption: 'Turn player feedback into real improvements.', detail: 'PLAY. SUGGEST. SHAPE WHAT’S NEXT.' },
] as const;

export function chapterAt(time: number) {
  return FILM_CHAPTERS.find((chapter) => time < chapter.end) ?? FILM_CHAPTERS[FILM_CHAPTERS.length - 1];
}

/** Measured voice clips are also the subtitle and music-ducking edit points. */
export const NARRATION_CUES = FILM_CHAPTERS.map((chapter, index) => ({
  ...NARRATION_TIMING[index],
  text: chapter.caption,
  chapterEnd: chapter.end,
}));

export function captionAt(time: number) {
  return NARRATION_CUES.find((cue) => time >= cue.start - 0.08 && time < cue.start + cue.duration + 0.25)?.text ?? '';
}

export const narrationStartFor = (chapterIndex: number) => NARRATION_CUES[chapterIndex]?.start ?? 0;
