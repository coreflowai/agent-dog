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
