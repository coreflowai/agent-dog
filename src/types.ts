export type AgentDogEvent = {
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
  eventCount: number
  metadata: Record<string, unknown>
}

export type IngestPayload = {
  source: 'claude-code' | 'codex'
  sessionId: string
  event: Record<string, unknown>
}
