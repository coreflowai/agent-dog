import type { AgentFlowEvent, IngestPayload } from './types'

const MAX_OUTPUT_SIZE = 10_000

function truncate(value: unknown): unknown {
  if (value === null || value === undefined) return value
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (str.length > MAX_OUTPUT_SIZE) {
    return str.slice(0, MAX_OUTPUT_SIZE) + `... [truncated, ${str.length} chars total]`
  }
  return value
}

function generateId(): string {
  return crypto.randomUUID()
}

export function normalizeClaudeCode(payload: IngestPayload): AgentFlowEvent {
  const { sessionId, event } = payload
  const hookEvent = (event.hook_event_name ?? event.event ?? event.type ?? '') as string
  const now = Date.now()

  const base: AgentFlowEvent = {
    id: generateId(),
    sessionId,
    timestamp: (event.timestamp as number) ?? now,
    source: 'claude-code',
    category: 'system',
    type: hookEvent,
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
  }

  switch (hookEvent) {
    case 'SessionStart':
    case 'session.start':
      return { ...base, category: 'session', type: 'session.start' }

    case 'Stop': {
      const stopText = (event.result ?? event.response ?? null) as string | null
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: stopText,
        meta: event.stop_reason ? { stop_reason: event.stop_reason } : {},
      }
    }

    case 'SessionEnd':
    case 'session.end':
      return { ...base, category: 'session', type: 'session.end' }

    case 'UserPromptSubmit':
    case 'message.user':
      return {
        ...base,
        category: 'message',
        type: 'message.user',
        role: 'user',
        text: (event.user_message ?? event.message ?? event.text ?? event.prompt ?? null) as string | null,
      }

    case 'PreToolUse':
    case 'tool.start':
      return {
        ...base,
        category: 'tool',
        type: 'tool.start',
        toolName: (event.tool_name ?? event.toolName ?? null) as string | null,
        toolInput: event.tool_input ?? event.toolInput ?? null,
      }

    case 'PostToolUse':
    case 'tool.end':
      return {
        ...base,
        category: 'tool',
        type: 'tool.end',
        toolName: (event.tool_name ?? event.toolName ?? null) as string | null,
        toolInput: event.tool_input ?? event.toolInput ?? null,
        toolOutput: truncate(event.tool_response ?? event.tool_output ?? event.toolOutput ?? null),
      }

    case 'message.assistant':
      return {
        ...base,
        category: 'message',
        type: 'message.assistant',
        role: 'assistant',
        text: (event.message ?? event.text ?? null) as string | null,
      }

    case 'Error':
    case 'error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (event.error ?? event.message ?? null) as string | null,
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

export function normalizeCodex(payload: IngestPayload): AgentFlowEvent {
  const { sessionId, event } = payload
  const eventType = (event.type ?? '') as string
  const item = (event.item ?? {}) as Record<string, unknown>
  const itemType = (item.type ?? '') as string
  const now = Date.now()

  const base: AgentFlowEvent = {
    id: generateId(),
    sessionId,
    timestamp: (event.timestamp as number) ?? now,
    source: 'codex',
    category: 'system',
    type: eventType,
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
  }

  switch (eventType) {
    case 'thread.started':
      return { ...base, category: 'session', type: 'session.start' }

    case 'turn.started':
      return { ...base, category: 'system', type: 'turn.start' }

    case 'turn.completed':
      return { ...base, category: 'session', type: 'session.end' }

    case 'item.started':
      if (itemType === 'command_execution') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.start',
          toolName: 'command_execution',
          toolInput: item.command ?? null,
        }
      }
      if (itemType === 'file_change') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.start',
          toolName: 'file_change',
          toolInput: { file: item.file, patch: item.patch },
        }
      }
      if (itemType === 'agent_message') {
        return {
          ...base,
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: (item.content ?? null) as string | null,
        }
      }
      return { ...base, meta: { item } }

    case 'item.completed':
      if (itemType === 'command_execution') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName: 'command_execution',
          toolOutput: truncate(item.output ?? null),
        }
      }
      if (itemType === 'file_change') {
        return {
          ...base,
          category: 'tool',
          type: 'tool.end',
          toolName: 'file_change',
          toolOutput: truncate(item.patch ?? null),
        }
      }
      if (itemType === 'agent_message') {
        return {
          ...base,
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: (item.content ?? null) as string | null,
        }
      }
      return { ...base, meta: { item } }

    case 'error':
      return {
        ...base,
        category: 'error',
        type: 'error',
        error: (event.message ?? event.error ?? null) as string | null,
      }

    default:
      return { ...base, meta: { rawEvent: event } }
  }
}

export function normalize(payload: IngestPayload): AgentFlowEvent {
  if (payload.source === 'codex') {
    return normalizeCodex(payload)
  }
  return normalizeClaudeCode(payload)
}
