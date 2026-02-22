export type AgentFlowEvent = {
  id: string
  sessionId: string
  timestamp: number
  source: 'claude-code' | 'codex' | 'opencode' | 'sandbox' | 'cron'
  category: 'session' | 'message' | 'tool' | 'error' | 'system'
  type: string
  role: 'user' | 'assistant' | 'system' | null
  text: string | null
  toolName: string | null
  toolInput: unknown | null
  toolOutput: unknown | null
  error: string | null
  meta: Record<string, unknown>
}

export type Session = {
  id: string
  source: 'claude-code' | 'codex' | 'opencode' | 'sandbox' | 'cron'
  startTime: number
  lastEventTime: number
  status: 'active' | 'completed' | 'error' | 'archived'
  lastEventType: string | null
  lastEventText: string | null
  eventCount: number
  metadata: Record<string, unknown>
  userId?: string | null
}

export type UserInfo = {
  name?: string
  email?: string
  osUser?: string
  githubUsername?: string
  githubId?: number
}

export type GitInfo = {
  commit?: string
  branch?: string
  remote?: string
  repoName?: string
  workDir?: string
}

export type IngestPayload = {
  source: 'claude-code' | 'codex' | 'opencode' | 'sandbox' | 'cron'
  sessionId: string
  event: Record<string, unknown>
  user?: UserInfo
  git?: GitInfo
}

// Insight types
export type FollowUpAction = {
  action: string
  priority: 'low' | 'medium' | 'high'
  category: 'tooling' | 'workflow' | 'knowledge' | 'other'
}

export type InsightTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type InsightMeta = {
  tokenUsage?: InsightTokenUsage
  model?: string
  durationMs?: number
  error?: string
  rawOutput?: string
  phase?: 'preliminary' | 'refined' | 'final-no-answers' | 'refined-late'
  questionCount?: number
  answersReceived?: number
}

export type Insight = {
  id: string
  userId: string
  repoName: string | null
  createdAt: number
  analysisWindowStart: number
  analysisWindowEnd: number
  sessionsAnalyzed: number
  eventsAnalyzed: number
  content: string
  categories: string[]
  followUpActions: FollowUpAction[]
  meta: InsightMeta
}

export type InsightAnalysisState = {
  id: string
  userId: string
  repoName: string | null
  lastAnalyzedAt: number
  lastEventTimestamp: number
}

// Slack question types
export type SlackQuestionOption = {
  id: string
  label: string
  style?: 'primary' | 'danger'
}

export type SlackQuestion = {
  id: string
  question: string
  context: string | null
  status: 'pending' | 'posted' | 'answered' | 'expired'
  channelId: string | null
  messageTs: string | null
  threadTs: string | null
  answer: string | null
  answeredBy: string | null
  answeredByName: string | null
  answeredAt: number | null
  answerSource: 'thread' | 'button' | 'api' | null
  options: SlackQuestionOption[] | null
  selectedOption: string | null
  insightId: string | null
  sessionId: string | null
  createdAt: number
  expiresAt: number | null
  meta: Record<string, unknown>
}

// Data source types
export type DataSourceType = 'slack' | 'discord' | 'rss' | 'agent'

export type FieldMapping = {
  author?: string
  content?: string
  url?: string
  timestamp?: string
}

export type SlackSourceConfig = {
  channelId: string
}

export type DiscordSourceConfig = {
  guildId: string
  channelId: string
}

export type RssSourceConfig = {
  feedUrl: string
  pollIntervalMinutes: number
}

export type AgentSourceConfig = Record<string, never>

export type DataSourceConfig = SlackSourceConfig | DiscordSourceConfig | RssSourceConfig | AgentSourceConfig

export type DataSource = {
  id: string
  name: string
  type: DataSourceType
  enabled: boolean
  config: DataSourceConfig
  fieldMapping: FieldMapping | null
  lastSyncAt: number | null
  lastSyncError: string | null
  createdAt: number
  updatedAt: number
}

export type SourceEntry = {
  id: string
  dataSourceId: string
  externalId: string
  author: string | null
  content: string | null
  url: string | null
  timestamp: number
  ingestedAt: number
  meta: Record<string, unknown>
}

export type CreateDataSourceInput = {
  name: string
  type: DataSourceType
  config: DataSourceConfig
  fieldMapping?: FieldMapping
  enabled?: boolean
}

export type UpdateDataSourceInput = {
  name?: string
  config?: DataSourceConfig
  fieldMapping?: FieldMapping
}

// Cron job types
export type CronJob = {
  id: string
  name: string
  prompt: string
  scheduleText: string
  cronExpression: string
  timezone: string
  enabled: boolean
  notifySlack: boolean
  lastRunAt: number | null
  lastRunSessionId: string | null
  lastRunStatus: 'success' | 'error' | 'running' | null
  nextRunAt: number | null
  totalRuns: number
  createdAt: number
  updatedAt: number
  meta: Record<string, unknown>
}

export type CreateCronJobInput = {
  name: string
  prompt: string
  scheduleText: string
  cronExpression: string
  timezone?: string
  enabled?: boolean
  notifySlack?: boolean
  meta?: Record<string, unknown>
}

export type UpdateCronJobInput = {
  name?: string
  prompt?: string
  scheduleText?: string
  cronExpression?: string
  timezone?: string
  enabled?: boolean
  notifySlack?: boolean
  meta?: Record<string, unknown>
}

export type CreateSlackQuestionInput = {
  question: string
  context?: string
  channelId?: string
  options?: SlackQuestionOption[]
  insightId?: string
  sessionId?: string
  expiresAt?: number
  meta?: Record<string, unknown>
}
