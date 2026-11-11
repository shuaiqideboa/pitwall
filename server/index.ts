import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { AgentWorker, configFromEnv, managedBackend, testBackend } from './agent/worker';
import { createApp } from './app';
import { connect, migrate } from './db';

// One server for everything: the game's built files, plus the /api.
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 8787);

// Validate before opening the database. Production must have a real agent.
const agentConfig = configFromEnv(process.env);
const db = await connect({ url: process.env.DATABASE_URL, dataDir: process.env.DATABASE_URL ? undefined : '.data/pglite' });
await migrate(db);

const worker = new AgentWorker(db, agentConfig ? managedBackend(db, agentConfig) : testBackend);
await worker.recover();
worker.wake(); // pick up anything queued while the server was down

const app = createApp(db, { secureCookies: production, onRequest: () => worker.wake() });
app.use('/*', serveStatic({ root: './dist' }));
// Any other page address is the game itself (a single-page app); unknown /api addresses stay 404.
app.get('*', (c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.html(readFileSync('./dist/index.html', 'utf8')),
);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Pitwall server on http://localhost:${port} (${process.env.DATABASE_URL ? 'Postgres' : 'local embedded Postgres'})`);
  console.log(`Pit Wall agent: ${agentConfig ? 'managed (OpenAI Agents API, gpt-6-astra)' : 'test mode (no agent configured)'}`);
});
