# Untitled Game

Small simultaneous-turn hex tactics prototype with local play, bot play, and online PvP.

## Requirements

- Node.js 20+ (LTS recommended)
- npm

## Install

```bash
npm install
```

## Run The Game

### Local/Bot Only (no server)

```bash
npm run dev
```

Then open the Vite URL (normally `http://localhost:5173`).

### Online PvP (client + websocket server together)

```bash
npm run dev:online
```

This starts:

- Vite client on `http://localhost:5173`
- PvP server on `http://localhost:8080`

### LAN Variants

```bash
npm run dev:online:lan
npm run dev:online:lan:https
```

## Gameplay Flow

- `Start Local Game`: hot-seat local 1v1.
- `Start Vs Bot`: local game versus AI.
- `Online PvP` section:
  - `Create Room` to host.
  - Share invite link/room code + seat token.
  - Opponent joins with `Join Room`.

## Build And Tests

```bash
npm run build
npm run test:server
```

## Telemetry And Balance Reports

Telemetry now tracks:

- decklists
- cards played
- cards in hand not played
- winner and end reason

### How telemetry is collected

- Online matches: logged server-side automatically when match ends.
- Local/Bot matches: queued in browser storage and posted to server at match end, with retry on next app load/online.

Default log path:

```text
server/data/match-logs.ndjson
```

Override with:

```bash
MATCH_TELEMETRY_LOG_PATH=...
```

### Card balance CLI report

```bash
npm run telemetry:cards
```

Useful options:

```bash
npm run telemetry:cards -- --limit 50
npm run telemetry:cards -- --min-played 3
npm run telemetry:cards -- --json
```

### Optional HTTP endpoints

- `GET /health`
- `POST /telemetry/match`
- `GET /telemetry/cards`
- `GET /telemetry/matches?limit=50`
