import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { io as ioClient } from 'socket.io-client'
import { createServer } from '../src/server-factory'
import { closeDb } from '../src/db'
import type { AgentFlowEvent } from '../src/types'

function createTestClient(url: string, sessionId: string) {
  const events: AgentFlowEvent[] = []
  const client = ioClient(url, { transports: ['websocket'] })

  client.on('connect', () => {
    client.emit('subscribe', sessionId)
  })

  client.on('event', (event: AgentFlowEvent) => {
    events.push(event)
  })

  return {
    events,
    client,
    waitForEvents: (count: number, timeout = 5000) =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (events.length >= count) return resolve()
        }
        client.on('event', check)
        check()
        setTimeout(() => {
          client.off('event', check)
          if (events.length >= count) resolve()
          else reject(new Error(`Timeout waiting for ${count} events, got ${events.length}`))
        }, timeout)
      }),
    close: () => client.close(),
  }
}

async function postEvent(url: string, sessionId: string, event: Record<string, unknown>) {
  const res = await fetch(`${url}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'claude-code', sessionId, event }),
  })
  return res.json()
}

describe('Claude Code Streaming', () => {
  let srv: ReturnType<typeof createServer>
  const SESSION_ID = 'cc-test-session-1'
  const dbPath = `/tmp/agent-flow-test-cc-${Date.now()}.db`

  beforeAll(() => {
    closeDb()
    srv = createServer({ port: 0, dbPath, serveStatic: false, authEnabled: false })
  })

  afterAll(() => {
    srv.close()
    closeDb()
    try { require('fs').unlinkSync(dbPath) } catch {}
  })

  test('full Claude Code session streams events to Socket.IO client', async () => {
    const testClient = createTestClient(srv.url, SESSION_ID)

    // Wait for client to connect and subscribe
    await new Promise(r => setTimeout(r, 500))

    // Simulate a full Claude Code session
    const hookEvents = [
      { hook_event_name: 'SessionStart', session_id: SESSION_ID },
      { hook_event_name: 'UserPromptSubmit', session_id: SESSION_ID, message: 'fix the bug in auth.ts' },
      { hook_event_name: 'PreToolUse', session_id: SESSION_ID, tool_name: 'Read', tool_input: { file_path: 'src/auth.ts' } },
      { hook_event_name: 'PostToolUse', session_id: SESSION_ID, tool_name: 'Read', tool_output: 'file contents...' },
      { hook_event_name: 'PreToolUse', session_id: SESSION_ID, tool_name: 'Edit', tool_input: { file_path: 'src/auth.ts', old_string: 'bug', new_string: 'fix' } },
      { hook_event_name: 'PostToolUse', session_id: SESSION_ID, tool_name: 'Edit', tool_output: 'ok' },
      { hook_event_name: 'PreToolUse', session_id: SESSION_ID, tool_name: 'Bash', tool_input: { command: 'bun test' } },
      { hook_event_name: 'PostToolUse', session_id: SESSION_ID, tool_name: 'Bash', tool_output: '3 tests passed' },
      { hook_event_name: 'Stop', session_id: SESSION_ID },
    ]

    for (const event of hookEvents) {
      await postEvent(srv.url, SESSION_ID, event)
    }

    await testClient.waitForEvents(9)

    expect(testClient.events.length).toBe(9)

    expect(testClient.events[0].type).toBe('session.start')
    expect(testClient.events[0].category).toBe('session')

    expect(testClient.events[1].type).toBe('message.user')
    expect(testClient.events[1].category).toBe('message')
    expect(testClient.events[1].role).toBe('user')
    expect(testClient.events[1].text).toBe('fix the bug in auth.ts')

    expect(testClient.events[2].type).toBe('tool.start')
    expect(testClient.events[2].toolName).toBe('Read')
    expect(testClient.events[2].category).toBe('tool')

    expect(testClient.events[3].type).toBe('tool.end')
    expect(testClient.events[3].toolName).toBe('Read')
    expect(testClient.events[3].toolOutput).toBe('file contents...')

    expect(testClient.events[4].type).toBe('tool.start')
    expect(testClient.events[4].toolName).toBe('Edit')

    expect(testClient.events[5].type).toBe('tool.end')
    expect(testClient.events[5].toolName).toBe('Edit')

    expect(testClient.events[6].type).toBe('tool.start')
    expect(testClient.events[6].toolName).toBe('Bash')

    expect(testClient.events[7].type).toBe('tool.end')
    expect(testClient.events[7].toolName).toBe('Bash')
    expect(testClient.events[7].toolOutput).toBe('3 tests passed')

    expect(testClient.events[8].type).toBe('message.assistant')
    expect(testClient.events[8].category).toBe('message')
    expect(testClient.events[8].role).toBe('assistant')

    testClient.close()
  })

  test('GET /api/sessions returns session with correct event count', async () => {
    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]
    const session = data.find((s: any) => s.id === SESSION_ID)
    expect(session).toBeDefined()
    expect(session.eventCount).toBe(9)
    expect(session.source).toBe('claude-code')
    expect(session.lastEventType).toBe('message.assistant')
  })

  test('GET /api/sessions/:id returns all events', async () => {
    const res = await fetch(`${srv.url}/api/sessions/${SESSION_ID}`)
    const data = await res.json() as any
    expect(data.id).toBe(SESSION_ID)
    expect(data.events.length).toBe(9)
    // Session is still active (Stop maps to message.assistant, not session.end)
    expect(data.status).toBe('active')

    for (let i = 1; i < data.events.length; i++) {
      expect(data.events[i].timestamp).toBeGreaterThanOrEqual(data.events[i - 1].timestamp)
    }
  })

  test('session status is active right after events', async () => {
    const res = await fetch(`${srv.url}/api/sessions/${SESSION_ID}`)
    const data = await res.json() as any
    expect(data.status).toBe('active')
  })
})
