/**
 * AgentDog - Claude Code SDK Adapter
 *
 * Provides hook callbacks for the Claude Code Agent SDK.
 * Usage:
 *   import { createAgentDogHooks } from './adapters/claude-code-sdk'
 *   const hooks = createAgentDogHooks('http://localhost:3333')
 *   const result = await query({ hooks, ...options })
 */

type HookEvent = {
  hook_event_name: string
  session_id: string
  [key: string]: unknown
}

async function postEvent(url: string, sessionId: string, event: Record<string, unknown>) {
  try {
    await fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'claude-code' as const,
        sessionId,
        event,
      }),
    })
  } catch {
    // Fire and forget - don't break the agent
  }
}

export function createAgentDogHooks(agentDogUrl = 'http://localhost:3333') {
  return {
    onSessionStart: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'SessionStart',
      })
    },

    onUserPromptSubmit: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'UserPromptSubmit',
      })
    },

    onPreToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PreToolUse',
      })
    },

    onPostToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PostToolUse',
      })
    },

    onStop: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'Stop',
      })
    },
  }
}
