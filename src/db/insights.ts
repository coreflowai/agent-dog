import { eq, desc, and, gt, sql, isNull } from 'drizzle-orm'
import { getDb } from './index'
import { insights, insightAnalysisState, sessions, events } from './schema'
import type { Insight, InsightAnalysisState, FollowUpAction, InsightMeta } from '../types'

// --- Insights ---

export type CreateInsightInput = {
  userId: string
  repoName?: string | null
  content: string
  categories?: string[]
  followUpActions?: FollowUpAction[]
  sessionsAnalyzed: number
  eventsAnalyzed: number
  analysisWindowStart: number
  analysisWindowEnd: number
  meta?: InsightMeta
}

export function addInsight(input: CreateInsightInput): Insight {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = Date.now()

  db.insert(insights).values({
    id,
    userId: input.userId,
    repoName: input.repoName ?? null,
    createdAt: now,
    analysisWindowStart: input.analysisWindowStart,
    analysisWindowEnd: input.analysisWindowEnd,
    sessionsAnalyzed: input.sessionsAnalyzed,
    eventsAnalyzed: input.eventsAnalyzed,
    content: input.content,
    categories: input.categories ?? [],
    followUpActions: input.followUpActions ?? [],
    meta: input.meta ?? {},
  }).run()

  return {
    id,
    userId: input.userId,
    repoName: input.repoName ?? null,
    createdAt: now,
    analysisWindowStart: input.analysisWindowStart,
    analysisWindowEnd: input.analysisWindowEnd,
    sessionsAnalyzed: input.sessionsAnalyzed,
    eventsAnalyzed: input.eventsAnalyzed,
    content: input.content,
    categories: input.categories ?? [],
    followUpActions: input.followUpActions ?? [],
    meta: input.meta ?? {},
  }
}

export function getInsight(id: string): Insight | null {
  const db = getDb()
  const row = db.select().from(insights).where(eq(insights.id, id)).get()
  if (!row) return null

  return {
    id: row.id,
    userId: row.userId,
    repoName: row.repoName,
    createdAt: row.createdAt,
    analysisWindowStart: row.analysisWindowStart,
    analysisWindowEnd: row.analysisWindowEnd,
    sessionsAnalyzed: row.sessionsAnalyzed,
    eventsAnalyzed: row.eventsAnalyzed,
    content: row.content,
    categories: (row.categories ?? []) as string[],
    followUpActions: (row.followUpActions ?? []) as FollowUpAction[],
    meta: (row.meta ?? {}) as InsightMeta,
  }
}

export function listInsights(options?: {
  userId?: string
  repoName?: string
  limit?: number
  offset?: number
}): Insight[] {
  const db = getDb()
  const { userId, repoName, limit = 50, offset = 0 } = options ?? {}

  // Build filter conditions
  const conditions = []
  if (userId) conditions.push(eq(insights.userId, userId))
  if (repoName) conditions.push(eq(insights.repoName, repoName))

  const rows = conditions.length > 0
    ? db.select().from(insights)
        .where(and(...conditions))
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .offset(offset)
        .all()
    : db.select().from(insights)
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .offset(offset)
        .all()

  return rows.map(row => ({
    id: row.id,
    userId: row.userId,
    repoName: row.repoName,
    createdAt: row.createdAt,
    analysisWindowStart: row.analysisWindowStart,
    analysisWindowEnd: row.analysisWindowEnd,
    sessionsAnalyzed: row.sessionsAnalyzed,
    eventsAnalyzed: row.eventsAnalyzed,
    content: row.content,
    categories: (row.categories ?? []) as string[],
    followUpActions: (row.followUpActions ?? []) as FollowUpAction[],
    meta: (row.meta ?? {}) as InsightMeta,
  }))
}

export function deleteInsight(id: string) {
  const db = getDb()
  db.delete(insights).where(eq(insights.id, id)).run()
}

// --- Analysis State ---

function makeStateId(userId: string, repoName?: string | null): string {
  return `${userId}:${repoName || 'all'}`
}

export function getAnalysisState(userId: string, repoName?: string | null): InsightAnalysisState | null {
  const db = getDb()
  const id = makeStateId(userId, repoName)
  const row = db.select().from(insightAnalysisState).where(eq(insightAnalysisState.id, id)).get()
  if (!row) return null

  return {
    id: row.id,
    userId: row.userId,
    repoName: row.repoName,
    lastAnalyzedAt: row.lastAnalyzedAt,
    lastEventTimestamp: row.lastEventTimestamp,
  }
}

export function updateAnalysisState(
  userId: string,
  repoName: string | null | undefined,
  lastEventTimestamp: number
) {
  const db = getDb()
  const id = makeStateId(userId, repoName)
  const now = Date.now()

  const existing = db.select().from(insightAnalysisState).where(eq(insightAnalysisState.id, id)).get()

  if (existing) {
    db.update(insightAnalysisState)
      .set({ lastAnalyzedAt: now, lastEventTimestamp })
      .where(eq(insightAnalysisState.id, id))
      .run()
  } else {
    db.insert(insightAnalysisState).values({
      id,
      userId,
      repoName: repoName ?? null,
      lastAnalyzedAt: now,
      lastEventTimestamp,
    }).run()
  }
}

// --- Helpers for analysis ---

export type UserRepoGroup = {
  userId: string
  repoName: string | null
  sessionCount: number
  eventCount: number
  lastEventTime: number
}

/**
 * Get distinct (userId, repoName) pairs that have activity since a given timestamp.
 * This is used by the scheduler to determine which users/repos need analysis.
 */
export function getUserRepoGroupsWithActivity(sinceTimestamp: number = 0): UserRepoGroup[] {
  const db = getDb()

  // Get all sessions with activity since the timestamp, grouped by userId and repoName
  const rows = db.select({
    userId: sessions.userId,
    metadata: sessions.metadata,
    lastEventTime: sessions.lastEventTime,
  })
    .from(sessions)
    .where(gt(sessions.lastEventTime, sinceTimestamp))
    .all()

  // Group by userId + repoName (from metadata.git.repoName)
  const groups = new Map<string, UserRepoGroup>()

  for (const row of rows) {
    if (!row.userId) continue

    const metadata = row.metadata as Record<string, any> | null
    const repoName = metadata?.git?.repoName ?? null
    const key = `${row.userId}:${repoName || 'unknown'}`

    const existing = groups.get(key)
    if (existing) {
      existing.sessionCount++
      existing.lastEventTime = Math.max(existing.lastEventTime, row.lastEventTime)
    } else {
      groups.set(key, {
        userId: row.userId,
        repoName,
        sessionCount: 1,
        eventCount: 0, // Will be filled below
        lastEventTime: row.lastEventTime,
      })
    }
  }

  // Get event counts for each group
  for (const group of groups.values()) {
    // Get sessions for this user+repo
    const sessionRows = db.select({ id: sessions.id })
      .from(sessions)
      .where(
        group.repoName
          ? and(
              eq(sessions.userId, group.userId),
              sql`json_extract(${sessions.metadata}, '$.git.repoName') = ${group.repoName}`
            )
          : eq(sessions.userId, group.userId)
      )
      .all()

    const sessionIds = sessionRows.map(r => r.id)
    if (sessionIds.length > 0) {
      const [countResult] = db
        .select({ count: sql<number>`count(*)` })
        .from(events)
        .where(sql`${events.sessionId} IN (${sql.join(sessionIds.map(id => sql`${id}`), sql`, `)})`)
        .all()
      group.eventCount = countResult?.count ?? 0
    }
  }

  return Array.from(groups.values())
}

/**
 * Get all distinct user IDs that have sessions.
 */
export function getDistinctUserIds(): string[] {
  const db = getDb()
  const rows = db.selectDistinct({ userId: sessions.userId })
    .from(sessions)
    .where(sql`${sessions.userId} IS NOT NULL`)
    .all()

  return rows.map(r => r.userId!).filter(Boolean)
}

/**
 * Count events for a user+repo combination since a given timestamp.
 */
export function countEventsSince(
  userId: string,
  repoName: string | null | undefined,
  sinceTimestamp: number
): number {
  const db = getDb()

  // Get session IDs for this user+repo
  let sessionQuery = db.select({ id: sessions.id }).from(sessions)
    .where(eq(sessions.userId, userId))

  if (repoName) {
    sessionQuery = db.select({ id: sessions.id }).from(sessions)
      .where(and(
        eq(sessions.userId, userId),
        sql`json_extract(${sessions.metadata}, '$.git.repoName') = ${repoName}`
      ))
  }

  const sessionRows = sessionQuery.all()
  const sessionIds = sessionRows.map(r => r.id)

  if (sessionIds.length === 0) return 0

  const [countResult] = db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(
      sql`${events.sessionId} IN (${sql.join(sessionIds.map(id => sql`${id}`), sql`, `)})`,
      gt(events.timestamp, sinceTimestamp)
    ))
    .all()

  return countResult?.count ?? 0
}

/**
 * Get the latest insight for a user+repo combination.
 */
export function getLatestInsight(userId: string, repoName?: string | null): Insight | null {
  const db = getDb()

  let query
  if (repoName) {
    query = db.select().from(insights)
      .where(and(eq(insights.userId, userId), eq(insights.repoName, repoName)))
      .orderBy(desc(insights.createdAt))
      .limit(1)
  } else {
    query = db.select().from(insights)
      .where(and(eq(insights.userId, userId), isNull(insights.repoName)))
      .orderBy(desc(insights.createdAt))
      .limit(1)
  }

  const row = query.get()
  if (!row) return null

  return {
    id: row.id,
    userId: row.userId,
    repoName: row.repoName,
    createdAt: row.createdAt,
    analysisWindowStart: row.analysisWindowStart,
    analysisWindowEnd: row.analysisWindowEnd,
    sessionsAnalyzed: row.sessionsAnalyzed,
    eventsAnalyzed: row.eventsAnalyzed,
    content: row.content,
    categories: (row.categories ?? []) as string[],
    followUpActions: (row.followUpActions ?? []) as FollowUpAction[],
    meta: (row.meta ?? {}) as InsightMeta,
  }
}
