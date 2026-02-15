import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { eq, desc, sql } from 'drizzle-orm'
import { sessions, events } from './schema'
import type { AgentDogEvent, Session, UserInfo } from '../types'

const DB_PATH = process.env.AGENT_DOG_DB ?? 'agent-dog.db'

let _db: ReturnType<typeof createDb> | null = null

function createDb(dbPath: string = DB_PATH) {
  const sqlite = new Database(dbPath)
  sqlite.run('PRAGMA journal_mode = WAL')
  const db = drizzle(sqlite)

  migrate(db, { migrationsFolder: './drizzle' })

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
  } else if (existing && existing.status === 'completed') {
    // Reactivate if new events come in after completion
    db.update(sessions)
      .set({ status: 'active', lastEventTime: now })
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

const STALE_TIMEOUT = 2 * 60 * 1000 // 2 minutes

function deriveStatus(status: string, lastEventTime: number): Session['status'] {
  if (status === 'error') return 'error'
  if (status === 'completed') return 'completed'
  // Auto-complete active sessions after inactivity
  if (Date.now() - lastEventTime > STALE_TIMEOUT) return 'completed'
  return 'active'
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

  const lastEvent = db.select({ type: events.type })
    .from(events)
    .where(eq(events.sessionId, id))
    .orderBy(desc(events.timestamp))
    .limit(1)
    .get()

  return {
    id: row.id,
    source: row.source as Session['source'],
    startTime: row.startTime,
    lastEventTime: row.lastEventTime,
    status: deriveStatus(row.status!, row.lastEventTime),
    lastEventType: lastEvent?.type ?? null,
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

    const lastEvent = db.select({ type: events.type })
      .from(events)
      .where(eq(events.sessionId, row.id))
      .orderBy(desc(events.timestamp))
      .limit(1)
      .get()

    return {
      id: row.id,
      source: row.source as Session['source'],
      startTime: row.startTime,
      lastEventTime: row.lastEventTime,
      status: deriveStatus(row.status!, row.lastEventTime),
      lastEventType: lastEvent?.type ?? null,
      eventCount: countResult.count,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }
  })
}

export function updateSessionMeta(id: string, meta: Record<string, unknown>) {
  const db = getDb()
  const row = db.select({ metadata: sessions.metadata }).from(sessions).where(eq(sessions.id, id)).get()
  if (!row) return
  const existing = (row.metadata ?? {}) as Record<string, unknown>
  db.update(sessions)
    .set({ metadata: { ...existing, ...meta } })
    .where(eq(sessions.id, id))
    .run()
}

export function deleteSession(id: string) {
  const db = getDb()
  db.delete(events).where(eq(events.sessionId, id)).run()
  db.delete(sessions).where(eq(sessions.id, id)).run()
}

export function clearAll() {
  const db = getDb()
  db.delete(events).run()
  db.delete(sessions).run()
}
