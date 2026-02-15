export type AgentFlowEvent = {
  id: string
  sessionId: string
  timestamp: number
  source: 'claude-code' | 'codex'
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
  source: 'claude-code' | 'codex'
  startTime: number
  lastEventTime: number
  status: 'active' | 'completed' | 'error'
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

export type IngestPayload = {
  source: 'claude-code' | 'codex'
  sessionId: string
  event: Record<string, unknown>
  user?: UserInfo
}
