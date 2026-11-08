import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { connect, migrate } from './db';

// One server for everything: the game's built files, plus the /api.
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 8787);

const db = await connect({ url: process.env.DATABASE_URL, dataDir: process.env.DATABASE_URL ? undefined : '.data/pglite' });
await migrate(db);

const app = createApp(db, { secureCookies: production });
app.use('/*', serveStatic({ root: './dist' }));
// Any other page address is the game itself (a single-page app); unknown /api addresses stay 404.
app.get('*', (c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.html(readFileSync('./dist/index.html', 'utf8')),
);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Pitwall server on http://localhost:${port} (${process.env.DATABASE_URL ? 'Postgres' : 'local embedded Postgres'})`);
});
