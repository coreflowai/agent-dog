/**
 * AgentFlow - Claude Agent SDK Adapter
 *
 * Provides hook callbacks for @anthropic-ai/claude-agent-sdk.
 * Usage:
 *   import { createAgentFlowHooks } from './adapters/claude-code-sdk'
 *   const hooks = createAgentFlowHooks('http://localhost:3333', {
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

async function postEvent(url: string, sessionId: string, event: Record<string, unknown>, user?: UserInfo, apiKey?: string) {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['x-api-key'] = apiKey
    await fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers,
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

export function createAgentFlowHooks(agentDogUrl = 'http://localhost:3333', user?: UserInfo, apiKey?: string) {
  return {
    onSessionStart: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'SessionStart',
      }, user, apiKey)
    },

    onUserPromptSubmit: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'UserPromptSubmit',
      }, user, apiKey)
    },

    onPreToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PreToolUse',
      }, user, apiKey)
    },

    onPostToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PostToolUse',
      }, user, apiKey)
    },

    onStop: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'Stop',
      }, user, apiKey)
    },
  }
}
