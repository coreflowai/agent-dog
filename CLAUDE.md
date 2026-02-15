# AgentDog

Real-time observability platform for AI agent sessions (Claude Code, Codex CLI, Claude Agent SDK).

## Tech Stack

- **Runtime**: Bun
- **Database**: SQLite (WAL mode) with Drizzle ORM
- **WebSocket**: Socket.IO with `@socket.io/bun-engine`
- **Frontend**: Vanilla JS + DaisyUI/Tailwind CSS (served from `public/`)

## Commands

```bash
bun run dev          # Dev server with hot reload (port 3333)
bun run start        # Production start
bun test             # Run all tests
bunx drizzle-kit generate   # Generate migrations after schema changes
bunx drizzle-kit migrate    # Apply pending migrations
```

## Project Structure

```
server.ts                  # Entry point — reads PORT and AGENT_DOG_DB env vars
src/
  server-factory.ts        # createServer() factory — returns { server, io, url, close }
  routes.ts                # API routes (createRouter(io))
  normalize.ts             # Event normalization per source (claude-code, codex)
  types.ts                 # Core types: AgentDogEvent, Session, IngestPayload
  db/
    index.ts               # Database operations (initDb, addEvent, getSession, etc.)
    schema.ts              # Drizzle ORM table definitions (sessions, events)
public/
  index.html               # Dashboard UI
  app.js                   # Frontend: Socket.IO client, session/event rendering
adapters/
  claude-code-hooks.sh     # Bash hook for Claude Code integration
  claude-code-sdk.ts       # TypeScript adapter for Claude Agent SDK
  codex-pipe.sh            # Bash pipe wrapper for Codex CLI
tests/
  claude-code-streaming.test.ts
  codex-streaming.test.ts
  integration.test.ts
```

## Architecture

- **Server Factory pattern**: `createServer(options)` allows flexible config for production and testing (ephemeral DBs, custom ports)
- **Event Normalization**: `normalize.ts` converts raw hooks from different sources into a unified `AgentDogEvent` format
- **Socket.IO Rooms**: Clients subscribe to per-session rooms for real-time event streaming
- **Derived session status**: `active` sessions auto-complete after 2 min idle (`STALE_TIMEOUT`)
- **Adapters are async/fire-and-forget**: Hook scripts run in background to not block the agent

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ingest` | Receive events (`{ source, sessionId, event }`) |
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Session detail + events |
| DELETE | `/api/sessions/:id` | Delete session |
| DELETE | `/api/sessions` | Clear all |
| GET | `/setup/hook.sh` | Download hook script with correct server URL |

## Database

Two tables: `sessions` and `events`. Events reference sessions via `session_id`. JSON fields stored as TEXT. Index on `(session_id, timestamp)`.

Status is derived at read time — not updated in place. Migrations auto-apply on startup via `initDb()`.

## Event Type Conventions

Format: `{category}.{action}` — e.g. `session.start`, `tool.end`, `message.user`

Categories: `session`, `message`, `tool`, `error`, `system`

Tool outputs are truncated to 10KB (`MAX_OUTPUT_SIZE`).

## Naming Conventions

- **Factory functions**: `create*()` (createServer, createAgentDogHooks)
- **Types**: PascalCase (AgentDogEvent, IngestPayload)
- **DB columns**: snake_case in SQL, camelCase in TypeScript
- **Event types**: lowercase dot-separated (`tool.start`, `session.stop`)

## Testing

Tests use the server factory with ephemeral `/tmp` databases. Each test creates its own server instance and Socket.IO client.

- `postEvent()` helper sends events via HTTP
- `waitForEvents(count)` waits for Socket.IO broadcasts with timeout
- Integration tests spawn real CLI processes (120s timeout)

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3333` | Server port |
| `AGENT_DOG_DB` | `agent-dog.db` | SQLite database path |
| `AGENT_DOG_URL` | `http://localhost:3333` | Used by adapters to POST events |
