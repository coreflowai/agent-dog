/**
 * AgentDog - Claude Agent SDK Adapter
 *
 * Provides hook callbacks for @anthropic-ai/claude-agent-sdk.
 * Usage:
 *   import { createAgentDogHooks } from './adapters/claude-code-sdk'
 *   const hooks = createAgentDogHooks('http://localhost:3333', {
 *     name: 'Ben', email: 'ben@example.com', githubUsername: 'bennykok'
 *   })
 *   const result = await query({ prompt: "...", options: { hooks } })
 */

import type { UserInfo } from '../src/types'

type HookEvent = {
  hook_event_name: string
  session_id: string
  [key: string]: unknown
}

async function postEvent(url: string, sessionId: string, event: Record<string, unknown>, user?: UserInfo) {
  try {
    await fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'claude-code' as const,
        sessionId,
        event,
        ...(user && Object.keys(user).length > 0 ? { user } : {}),
      }),
    })
  } catch {
    // Fire and forget - don't break the agent
  }
}

export function createAgentDogHooks(agentDogUrl = 'http://localhost:3333', user?: UserInfo) {
  return {
    onSessionStart: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'SessionStart',
      }, user)
    },

    onUserPromptSubmit: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'UserPromptSubmit',
      }, user)
    },

    onPreToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PreToolUse',
      }, user)
    },

    onPostToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PostToolUse',
      }, user)
    },

    onStop: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'Stop',
      }, user)
    },
  }
}
