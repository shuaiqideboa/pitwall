/** Manual asset generation only. The player never calls a speech API. */
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { FILM_CHAPTERS } from '../src/film/script';

const client = new OpenAI({ maxRetries: 1, timeout: 90_000 });
const requested = process.argv.slice(2).map(Number);
const indices = requested.length ? requested : FILM_CHAPTERS.map((_, i) => i);
await mkdir('public/film/narration', { recursive: true });

for (const index of indices) {
  const chapter = FILM_CHAPTERS[index];
  if (!chapter) throw new Error(`Unknown chapter ${index}`);
  const response = await client.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'cedar',
    input: chapter.caption,
    response_format: 'wav',
    speed: 1.02,
    instructions: 'You are the consistent male narrator of a polished 48-second product film. Speak in clear natural American English, with a warm resonant mid-low voice, confident forward momentum and optimistic heroic energy. Sound conversational and assured, not theatrical or growling. Deliver exactly the supplied text, with crisp diction and a slight emphasis on action words. A measured but brisk trailer pace, approximately 165 words per minute. No extra words, no music, no sound effects. Keep sentence-final pauses short. Pronounce Pit Wall as two words and AI as the letters A I. Maintain the same vocal personality in every clip.',
  });
  const path = `public/film/narration/${String(index + 1).padStart(2, '0')}.wav`;
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path, bytes);
  console.log(`${path}: ${bytes.length} bytes`);
}
