import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  startTime: integer('start_time').notNull(),
  lastEventTime: integer('last_event_time').notNull(),
  status: text('status').default('active'),
  metadata: text('metadata', { mode: 'json' }).default('{}'),
  userId: text('user_id'),
})

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  timestamp: integer('timestamp').notNull(),
  source: text('source').notNull(),
  category: text('category').notNull(),
  type: text('type').notNull(),
  role: text('role'),
  text: text('text'),
  toolName: text('tool_name'),
  toolInput: text('tool_input', { mode: 'json' }),
  toolOutput: text('tool_output', { mode: 'json' }),
  error: text('error'),
  meta: text('meta', { mode: 'json' }).default('{}'),
}, (table) => [
  index('idx_events_session').on(table.sessionId, table.timestamp),
])

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  email: text('email'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  usedBy: text('used_by'),
})

// Insights tables for AI-generated user behavior analysis
export const insights = sqliteTable('insights', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),           // GitHub username
  repoName: text('repo_name'),                 // e.g., "bennykok/agent-dog" (null = all repos)
  createdAt: integer('created_at').notNull(),
  analysisWindowStart: integer('analysis_window_start').notNull(),
  analysisWindowEnd: integer('analysis_window_end').notNull(),
  sessionsAnalyzed: integer('sessions_analyzed').notNull(),
  eventsAnalyzed: integer('events_analyzed').notNull(),
  content: text('content').notNull(),          // Markdown content
  categories: text('categories', { mode: 'json' }).$type<string[]>(),
  followUpActions: text('follow_up_actions', { mode: 'json' }),
  meta: text('meta', { mode: 'json' }),        // Token usage, model, duration, etc.
}, (table) => [
  index('idx_insights_user').on(table.userId, table.createdAt),
  index('idx_insights_repo').on(table.repoName, table.createdAt),
])

// Track last analysis state per user+repo combination
export const insightAnalysisState = sqliteTable('insight_analysis_state', {
  id: text('id').primaryKey(),                 // composite: `${userId}:${repoName || 'all'}`
  userId: text('user_id').notNull(),
  repoName: text('repo_name'),                 // null = all repos for user
  lastAnalyzedAt: integer('last_analyzed_at').notNull(),
  lastEventTimestamp: integer('last_event_timestamp').notNull(),
}, (table) => [
  index('idx_analysis_state_user').on(table.userId),
])
