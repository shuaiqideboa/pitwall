# Pitwall · F1 board game

A turn-based Formula 1 board game set at Albert Park (Australian GP), built as
the first test bed for **Pitwall**: a tool that lets players change the
product they use, with an AI turning their feedback into tested changes that
developers can review and ship.

## The game

- 4 players, 5 laps, one 3D die per turn.
- **Start:** at lights out every player rolls at once and the whole field gets
  away together; the car that got away slowest makes the first move.
- **Tyres:** Soft / Medium / Hard. Each compound has its own die; Softs and
  Mediums wear out. Every car must pit at least once.
- **Pit lane:** call BOX, take the pit entry, crawl through under the speed
  limiter, change tyres at your box.
- **Overtaking:** catch the car ahead and decide: overtake or stay behind.
  A clean pass is 63% (89% in a DRS zone); otherwise a Safety Car (35%) or a
  red flag (2%). Nobody is ever knocked out.
- Follow camera with a mini-map, and short music cues at the big moments.

## Run it

```bash
npm install
npm run dev          # the game, with live reload
npm run dev:server   # the account API (in a second terminal)
```

Then open http://localhost:5173. Without the server the game still plays;
you just can't sign in. Locally, accounts are kept in an embedded Postgres
under `.data/` (not committed).

To run it the way it's deployed (one server for the game and the API):

```bash
npm run build
npm start            # http://localhost:8787; uses DATABASE_URL when set
```

```bash
npm test
```

runs the rule tests and a 3,000-race balance simulation. It fails if a change
makes races unfinishable or one strategy dominant.

## Tuning the game

Every number that shapes the race (laps, tyre dice and wear, pit limiter,
overtake odds, Safety Car, pacing, camera) is in `src/game/config.ts`, with
the allowed range for each setting in `CONFIG_RULES`. This file is the menu
the AI will be allowed to change, and `validateConfig()` rejects anything
outside it.

## Where things live

| Path | What |
| --- | --- |
| `src/game/config.ts` | **All tunable settings** and their allowed ranges |
| `src/game/engine.ts` | Rules: turns, overtakes, pit lane, Safety Car, red flag |
| `src/game/tyres.ts` | Tyre compounds and their dice |
| `src/game/board.ts` | Track blocks, DRS zones, pit lane |
| `src/game/track.ts` | Map geometry |
| `src/components/` | Map, cars, camera, side panel, dice, tyre picker |
| `src/audio.ts` | Music cues |
| `server/` | Player accounts API (Hono + Postgres) and the production server |

## Roadmap

1. **Foundation (done):** this repo, CI, all game settings in one config file,
   rule and balance tests.
2. **Capture feedback:** an in-game "Suggest a change" button that files a
   GitHub issue with the race context.
3. **Instant tweaks:** an AI adjusts allowed settings for that player, with
   the balance simulation showing the effect.
4. **Code changes:** an AI opens a pull request with a preview build for the
   player to try and a developer to review.
5. **Developer dashboard:** grouped and voted suggestions, each with its PR
   and preview.
