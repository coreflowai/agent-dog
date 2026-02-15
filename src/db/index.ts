import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { eq, desc, sql } from 'drizzle-orm'
import { sessions, events } from './schema'
import type { AgentDogEvent, Session } from '../types'

const DB_PATH = process.env.AGENT_DOG_DB ?? 'agent-dog.db'

let _db: ReturnType<typeof createDb> | null = null

function createDb(dbPath: string = DB_PATH) {
  const sqlite = new Database(dbPath)
  sqlite.run('PRAGMA journal_mode = WAL')
  const db = drizzle(sqlite)

  // Create tables if not exist
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      last_event_time INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      metadata TEXT DEFAULT '{}'
    )
  `)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      role TEXT,
      text TEXT,
      tool_name TEXT,
      tool_input TEXT,
      tool_output TEXT,
      error TEXT,
      meta TEXT DEFAULT '{}'
    )
  `)
  sqlite.run(`
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp)
  `)

  return { db, sqlite }
}

export function getDb(dbPath?: string) {
  if (!_db) {
    _db = createDb(dbPath)
  }
  return _db.db
}

export function closeDb() {
  if (_db) {
    _db.sqlite.close()
    _db = null
  }
}

export function initDb(dbPath?: string) {
  return getDb(dbPath)
}

export function addEvent(event: AgentDogEvent) {
  const db = getDb()
  const now = event.timestamp

  // Upsert session
  const existing = db.select().from(sessions).where(eq(sessions.id, event.sessionId)).get()
  if (!existing) {
    db.insert(sessions).values({
      id: event.sessionId,
      source: event.source,
      startTime: now,
      lastEventTime: now,
      status: 'active',
      metadata: {},
    }).run()
  } else {
    db.update(sessions)
      .set({ lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  }

  // Update session status based on event
  if (event.type === 'session.end') {
    db.update(sessions)
      .set({ status: 'completed', lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  } else if (event.category === 'error') {
    db.update(sessions)
      .set({ status: 'error', lastEventTime: now })
      .where(eq(sessions.id, event.sessionId))
      .run()
  }

  // Insert event
  db.insert(events).values({
    id: event.id,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    source: event.source,
    category: event.category,
    type: event.type,
    role: event.role,
    text: event.text,
    toolName: event.toolName,
    toolInput: event.toolInput as any,
    toolOutput: event.toolOutput as any,
    error: event.error,
    meta: event.meta as any,
  }).run()
}

export function getSession(id: string): Session | null {
  const db = getDb()
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return null

  const [countResult] = db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.sessionId, id))
    .all()

  return {
    id: row.id,
    source: row.source as Session['source'],
    startTime: row.startTime,
    lastEventTime: row.lastEventTime,
    status: row.status as Session['status'],
    eventCount: countResult.count,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }
}

export function getSessionEvents(sessionId: string): AgentDogEvent[] {
  const db = getDb()
  return db.select().from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.timestamp)
    .all()
    .map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      timestamp: row.timestamp,
      source: row.source as AgentDogEvent['source'],
      category: row.category as AgentDogEvent['category'],
      type: row.type,
      role: row.role as AgentDogEvent['role'],
      text: row.text,
      toolName: row.toolName,
      toolInput: row.toolInput,
      toolOutput: row.toolOutput,
      error: row.error,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    }))
}

export function listSessions(): Session[] {
  const db = getDb()
  const rows = db.select().from(sessions).orderBy(desc(sessions.lastEventTime)).all()

  return rows.map(row => {
    const [countResult] = db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.sessionId, row.id))
      .all()

    return {
      id: row.id,
      source: row.source as Session['source'],
      startTime: row.startTime,
      lastEventTime: row.lastEventTime,
      status: row.status as Session['status'],
      eventCount: countResult.count,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }
  })
}

export function clearAll() {
  const db = getDb()
  db.delete(events).run()
  db.delete(sessions).run()
}
