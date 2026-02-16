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
    body: JSON.stringify({ source: 'opencode', sessionId, event }),
  })
  return res.json()
}

describe('Open Code Streaming', () => {
  let srv: ReturnType<typeof createServer>
  const SESSION_ID = 'opencode-test-session-1'
  const dbPath = `/tmp/agent-flow-test-opencode-${Date.now()}.db`

  beforeAll(() => {
    closeDb()
    srv = createServer({ port: 0, dbPath, serveStatic: false, authEnabled: false })
  })

  afterAll(() => {
    srv.close()
    closeDb()
    try { require('fs').unlinkSync(dbPath) } catch {}
  })

  test('full plugin session streams events to Socket.IO client', async () => {
    const testClient = createTestClient(srv.url, SESSION_ID)
    await new Promise(r => setTimeout(r, 500))

    const pluginEvents = [
      // session.created
      {
        type: 'session.created',
        properties: { info: { id: SESSION_ID, title: 'Fix bug in auth' } },
      },
      // message.updated (user) — metadata only, no text
      {
        type: 'message.updated',
        properties: { info: { id: 'msg-1', sessionID: SESSION_ID, role: 'user' } },
      },
      // message.part.updated (user text)
      {
        type: 'message.part.updated',
        properties: { part: { id: 'prt-u1', sessionID: SESSION_ID, messageID: 'msg-1', type: 'text', text: 'Fix the login bug' }, _role: 'user' },
      },
      // message.updated (assistant) — metadata only
      {
        type: 'message.updated',
        properties: { info: { id: 'msg-2', sessionID: SESSION_ID, role: 'assistant' } },
      },
      // message.part.updated (assistant text)
      {
        type: 'message.part.updated',
        properties: { part: { id: 'prt-a1', sessionID: SESSION_ID, messageID: 'msg-2', type: 'text', text: 'I will fix the login bug.' }, _role: 'assistant' },
      },
      // message.part.updated (tool running)
      {
        type: 'message.part.updated',
        properties: { part: { id: 'prt-t1', sessionID: SESSION_ID, messageID: 'msg-2', type: 'tool', tool: 'read_file', state: { status: 'running', input: { path: 'src/auth.ts' } } } },
      },
      // message.part.updated (tool completed)
      {
        type: 'message.part.updated',
        properties: { part: { id: 'prt-t1', sessionID: SESSION_ID, messageID: 'msg-2', type: 'tool', tool: 'read_file', state: { status: 'completed', input: { path: 'src/auth.ts' }, output: 'file contents...' } } },
      },
      // session.idle
      {
        type: 'session.idle',
        properties: { sessionID: SESSION_ID },
      },
    ]

    for (const event of pluginEvents) {
      await postEvent(srv.url, SESSION_ID, event)
    }

    await testClient.waitForEvents(8)

    expect(testClient.events.length).toBe(8)

    // session.created → session.start
    expect(testClient.events[0].type).toBe('session.start')
    expect(testClient.events[0].source).toBe('opencode')
    expect(testClient.events[0].category).toBe('session')
    expect(testClient.events[0].meta.title).toBe('Fix bug in auth')

    // message.updated (user) → system (metadata only, no text)
    expect(testClient.events[1].type).toBe('message.updated')

    // message.part.updated (user text) → message.user
    expect(testClient.events[2].type).toBe('message.user')
    expect(testClient.events[2].role).toBe('user')
    expect(testClient.events[2].text).toBe('Fix the login bug')
    expect(testClient.events[2].category).toBe('message')

    // message.updated (assistant) → system (metadata only)
    expect(testClient.events[3].type).toBe('message.updated')

    // message.part.updated (assistant text) → message.assistant
    expect(testClient.events[4].type).toBe('message.assistant')
    expect(testClient.events[4].role).toBe('assistant')
    expect(testClient.events[4].text).toBe('I will fix the login bug.')

    // tool.start (running) + tool.end (completed) — from same part ID
    expect(testClient.events[5].type).toBe('tool.start')
    expect(testClient.events[5].toolName).toBe('read_file')
    expect(testClient.events[5].category).toBe('tool')

    expect(testClient.events[6].type).toBe('tool.end')
    expect(testClient.events[6].toolName).toBe('read_file')
    expect(testClient.events[6].category).toBe('tool')

    // session.idle → session.end
    expect(testClient.events[7].type).toBe('session.end')
    expect(testClient.events[7].category).toBe('session')

    testClient.close()
  })

  test('full JSONL session normalizes correctly', async () => {
    const jsonlSessionId = 'opencode-jsonl-test-1'
    const testClient = createTestClient(srv.url, jsonlSessionId)
    await new Promise(r => setTimeout(r, 500))

    const jsonlEvents = [
      { type: 'step_start' },
      { type: 'text', part: { text: 'Looking at the code...' } },
      { type: 'tool_use', part: { toolName: 'bash', state: { status: 'pending', input: 'ls -la' } } },
      { type: 'tool_use', part: { toolName: 'bash', state: { status: 'completed', output: 'file1.ts\nfile2.ts' } } },
      { type: 'step_finish' },
    ]

    for (const event of jsonlEvents) {
      await postEvent(srv.url, jsonlSessionId, event)
    }

    await testClient.waitForEvents(5)

    expect(testClient.events.length).toBe(5)

    expect(testClient.events[0].type).toBe('step.start')
    expect(testClient.events[0].category).toBe('system')

    expect(testClient.events[1].type).toBe('message.assistant')
    expect(testClient.events[1].text).toBe('Looking at the code...')
    expect(testClient.events[1].category).toBe('message')

    expect(testClient.events[2].type).toBe('tool.start')
    expect(testClient.events[2].toolName).toBe('bash')
    expect(testClient.events[2].category).toBe('tool')

    expect(testClient.events[3].type).toBe('tool.end')
    expect(testClient.events[3].toolName).toBe('bash')
    expect(testClient.events[3].toolOutput).toBe('file1.ts\nfile2.ts')

    expect(testClient.events[4].type).toBe('step.finish')
    expect(testClient.events[4].category).toBe('system')

    testClient.close()
  })

  test('GET /api/sessions returns opencode session', async () => {
    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]
    const session = data.find((s: any) => s.id === SESSION_ID)
    expect(session).toBeDefined()
    expect(session.eventCount).toBe(8)
    expect(session.source).toBe('opencode')
  })

  test('GET /api/sessions/:id returns all events', async () => {
    const res = await fetch(`${srv.url}/api/sessions/${SESSION_ID}`)
    const data = await res.json() as any
    expect(data.id).toBe(SESSION_ID)
    expect(data.events.length).toBe(8)
    expect(data.status).toBe('completed')
  })

  test('mixed sessions (claude-code + codex + opencode) all appear correctly', async () => {
    const ccSessionId = 'cc-mixed-oc-test'
    const codexSessionId = 'codex-mixed-oc-test'

    // Create a claude-code session
    await fetch(`${srv.url}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'claude-code',
        sessionId: ccSessionId,
        event: { hook_event_name: 'SessionStart', session_id: ccSessionId },
      }),
    })

    // Create a codex session
    await fetch(`${srv.url}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'codex',
        sessionId: codexSessionId,
        event: { type: 'thread.started', thread_id: 'thread_xyz' },
      }),
    })

    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]

    const ocSession = data.find((s: any) => s.id === SESSION_ID)
    const ccSession = data.find((s: any) => s.id === ccSessionId)
    const codexSession = data.find((s: any) => s.id === codexSessionId)

    expect(ocSession).toBeDefined()
    expect(ocSession.source).toBe('opencode')
    expect(ccSession).toBeDefined()
    expect(ccSession.source).toBe('claude-code')
    expect(codexSession).toBeDefined()
    expect(codexSession.source).toBe('codex')
  })
})
