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

import type { UserInfo, GitInfo } from '../src/types'

type HookEvent = {
  hook_event_name: string
  session_id: string
  [key: string]: unknown
}

async function postEvent(url: string, sessionId: string, event: Record<string, unknown>, user?: UserInfo, git?: GitInfo, apiKey?: string) {
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
        ...(git && Object.keys(git).length > 0 ? { git } : {}),
      }),
    })
  } catch {
    // Fire and forget - don't break the agent
  }
}

export function createAgentFlowHooks(agentDogUrl = 'http://localhost:3333', user?: UserInfo, git?: GitInfo, apiKey?: string) {
  return {
    onSessionStart: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'SessionStart',
      }, user, git, apiKey)
    },

    onUserPromptSubmit: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'UserPromptSubmit',
      }, user, git, apiKey)
    },

    onPreToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PreToolUse',
      }, user, git, apiKey)
    },

    onPostToolUse: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'PostToolUse',
      }, user, git, apiKey)
    },

    onStop: async (event: HookEvent) => {
      await postEvent(agentDogUrl, event.session_id, {
        ...event,
        hook_event_name: 'Stop',
      }, user, git, apiKey)
    },
  }
}
