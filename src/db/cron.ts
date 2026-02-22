import { eq, desc } from 'drizzle-orm'
import { getDb } from './index'
import { cronJobs } from './schema'
import type { CronJob, CreateCronJobInput, UpdateCronJobInput } from '../types'

function rowToJob(row: typeof cronJobs.$inferSelect): CronJob {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    scheduleText: row.scheduleText,
    cronExpression: row.cronExpression,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    notifySlack: row.notifySlack === 1,
    lastRunAt: row.lastRunAt ?? null,
    lastRunSessionId: row.lastRunSessionId ?? null,
    lastRunStatus: (row.lastRunStatus as CronJob['lastRunStatus']) ?? null,
    nextRunAt: row.nextRunAt ?? null,
    totalRuns: row.totalRuns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  }
}

export function addCronJob(input: CreateCronJobInput): CronJob {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = Date.now()

  db.insert(cronJobs).values({
    id,
    name: input.name,
    prompt: input.prompt,
    scheduleText: input.scheduleText,
    cronExpression: input.cronExpression,
    timezone: input.timezone ?? 'UTC',
    enabled: (input.enabled ?? true) ? 1 : 0,
    notifySlack: (input.notifySlack ?? false) ? 1 : 0,
    totalRuns: 0,
    createdAt: now,
    updatedAt: now,
    meta: input.meta ?? {},
  }).run()

  return getCronJob(id)!
}

export function getCronJob(id: string): CronJob | null {
  const db = getDb()
  const row = db.select().from(cronJobs).where(eq(cronJobs.id, id)).get()
  if (!row) return null
  return rowToJob(row)
}

export function listCronJobs(): CronJob[] {
  const db = getDb()
  const rows = db.select().from(cronJobs).orderBy(desc(cronJobs.createdAt)).all()
  return rows.map(rowToJob)
}

export function updateCronJob(id: string, input: UpdateCronJobInput): CronJob | null {
  const db = getDb()
  const existing = db.select().from(cronJobs).where(eq(cronJobs.id, id)).get()
  if (!existing) return null

  const sets: Record<string, unknown> = { updatedAt: Date.now() }
  if (input.name !== undefined) sets.name = input.name
  if (input.prompt !== undefined) sets.prompt = input.prompt
  if (input.scheduleText !== undefined) sets.scheduleText = input.scheduleText
  if (input.cronExpression !== undefined) sets.cronExpression = input.cronExpression
  if (input.timezone !== undefined) sets.timezone = input.timezone
  if (input.enabled !== undefined) sets.enabled = input.enabled ? 1 : 0
  if (input.notifySlack !== undefined) sets.notifySlack = input.notifySlack ? 1 : 0
  if (input.meta !== undefined) sets.meta = input.meta

  db.update(cronJobs).set(sets).where(eq(cronJobs.id, id)).run()
  return getCronJob(id)
}

export function deleteCronJob(id: string) {
  const db = getDb()
  db.delete(cronJobs).where(eq(cronJobs.id, id)).run()
}

export function updateCronJobRun(id: string, updates: {
  lastRunAt?: number
  lastRunSessionId?: string
  lastRunStatus?: 'success' | 'error' | 'running'
  nextRunAt?: number | null
  totalRuns?: number
}) {
  const db = getDb()
  const sets: Record<string, unknown> = { updatedAt: Date.now() }
  if (updates.lastRunAt !== undefined) sets.lastRunAt = updates.lastRunAt
  if (updates.lastRunSessionId !== undefined) sets.lastRunSessionId = updates.lastRunSessionId
  if (updates.lastRunStatus !== undefined) sets.lastRunStatus = updates.lastRunStatus
  if (updates.nextRunAt !== undefined) sets.nextRunAt = updates.nextRunAt
  if (updates.totalRuns !== undefined) sets.totalRuns = updates.totalRuns

  db.update(cronJobs).set(sets).where(eq(cronJobs.id, id)).run()
}
