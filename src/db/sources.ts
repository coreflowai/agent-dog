import { Database } from 'bun:sqlite'
import { getDb } from './index'
import { dataSources } from './schema'
import { eq, desc } from 'drizzle-orm'
import type { DataSource, SourceEntry, CreateDataSourceInput, UpdateDataSourceInput } from '../types'

let _sourcesDb: Database | null = null

/**
 * Initialize the separate sources.db for high-volume source entries.
 */
export function initSourcesDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true })
  db.exec('PRAGMA journal_mode=WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_entries (
      id TEXT PRIMARY KEY,
      data_source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      author TEXT,
      content TEXT,
      url TEXT,
      timestamp INTEGER NOT NULL,
      ingested_at INTEGER NOT NULL,
      meta TEXT DEFAULT '{}'
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_source_entries_ds_ts ON source_entries(data_source_id, timestamp)`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_source_entries_ds_ext ON source_entries(data_source_id, external_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_source_entries_ts ON source_entries(timestamp)`)
  _sourcesDb = db
  return db
}

export function getSourcesDb(): Database {
  if (!_sourcesDb) throw new Error('Sources DB not initialized. Call initSourcesDb() first.')
  return _sourcesDb
}

export function closeSourcesDb() {
  if (_sourcesDb) {
    _sourcesDb.close()
    _sourcesDb = null
  }
}

// --- DataSource CRUD (in main agent-flow.db via Drizzle) ---

function rowToDataSource(row: any): DataSource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: !!row.enabled,
    config: row.config ?? {},
    fieldMapping: row.fieldMapping ?? null,
    lastSyncAt: row.lastSyncAt ?? null,
    lastSyncError: row.lastSyncError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function addDataSource(input: CreateDataSourceInput): DataSource {
  const db = getDb()
  const now = Date.now()
  const id = crypto.randomUUID()
  db.insert(dataSources).values({
    id,
    name: input.name,
    type: input.type,
    enabled: input.enabled !== false ? 1 : 0,
    config: input.config,
    fieldMapping: input.fieldMapping ?? null,
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  return getDataSource(id)!
}

export function getDataSource(id: string): DataSource | null {
  const db = getDb()
  const row = db.select().from(dataSources).where(eq(dataSources.id, id)).get()
  return row ? rowToDataSource(row) : null
}

export function listDataSources(): DataSource[] {
  const db = getDb()
  const rows = db.select().from(dataSources).orderBy(desc(dataSources.createdAt)).all()
  return rows.map(rowToDataSource)
}

export function updateDataSource(id: string, input: UpdateDataSourceInput): DataSource | null {
  const db = getDb()
  const existing = getDataSource(id)
  if (!existing) return null
  const now = Date.now()
  const updates: Record<string, unknown> = { updatedAt: now }
  if (input.name !== undefined) updates.name = input.name
  if (input.config !== undefined) updates.config = input.config
  if (input.fieldMapping !== undefined) updates.fieldMapping = input.fieldMapping
  db.update(dataSources).set(updates).where(eq(dataSources.id, id)).run()
  return getDataSource(id)
}

export function toggleDataSource(id: string, enabled: boolean): DataSource | null {
  const db = getDb()
  db.update(dataSources).set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() }).where(eq(dataSources.id, id)).run()
  return getDataSource(id)
}

export function updateDataSourceSync(id: string, lastSyncAt: number, lastSyncError: string | null) {
  const db = getDb()
  db.update(dataSources).set({ lastSyncAt, lastSyncError, updatedAt: Date.now() }).where(eq(dataSources.id, id)).run()
}

export function deleteDataSource(id: string) {
  const db = getDb()
  db.delete(dataSources).where(eq(dataSources.id, id)).run()
  // Also delete entries from sources.db
  try {
    const sdb = getSourcesDb()
    sdb.run('DELETE FROM source_entries WHERE data_source_id = ?', [id])
  } catch {}
}

// --- SourceEntry CRUD (in separate sources.db via raw bun:sqlite) ---

export function addSourceEntry(entry: Omit<SourceEntry, 'id' | 'ingestedAt'>): SourceEntry | null {
  const sdb = getSourcesDb()
  const id = crypto.randomUUID()
  const ingestedAt = Date.now()
  const meta = JSON.stringify(entry.meta ?? {})
  // INSERT OR IGNORE for dedup on (data_source_id, external_id)
  const result = sdb.run(
    `INSERT OR IGNORE INTO source_entries (id, data_source_id, external_id, author, content, url, timestamp, ingested_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.dataSourceId, entry.externalId, entry.author, entry.content, entry.url, entry.timestamp, ingestedAt, meta]
  )
  if (result.changes === 0) return null // duplicate
  return { id, ...entry, ingestedAt, meta: entry.meta ?? {} }
}

export function listSourceEntries(opts: {
  dataSourceId?: string
  limit?: number
  offset?: number
}): { entries: SourceEntry[]; total: number } {
  const sdb = getSourcesDb()
  const { dataSourceId, limit = 50, offset = 0 } = opts

  let countSql = 'SELECT COUNT(*) as count FROM source_entries'
  let querySql = 'SELECT * FROM source_entries'
  const params: unknown[] = []

  if (dataSourceId) {
    countSql += ' WHERE data_source_id = ?'
    querySql += ' WHERE data_source_id = ?'
    params.push(dataSourceId)
  }

  const { count: total } = sdb.prepare(countSql).get(...params) as { count: number }
  querySql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  const rows = sdb.prepare(querySql).all(...params, limit, offset) as any[]

  const entries: SourceEntry[] = rows.map(row => ({
    id: row.id,
    dataSourceId: row.data_source_id,
    externalId: row.external_id,
    author: row.author,
    content: row.content,
    url: row.url,
    timestamp: row.timestamp,
    ingestedAt: row.ingested_at,
    meta: row.meta ? JSON.parse(row.meta) : {},
  }))

  return { entries, total }
}

export function getEntryCount(dataSourceId: string): number {
  const sdb = getSourcesDb()
  const { count } = sdb.prepare('SELECT COUNT(*) as count FROM source_entries WHERE data_source_id = ?').get(dataSourceId) as { count: number }
  return count
}
