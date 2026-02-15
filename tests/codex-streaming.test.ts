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
    body: JSON.stringify({ source: 'codex', sessionId, event }),
  })
  return res.json()
}

describe('Codex Streaming', () => {
  let srv: ReturnType<typeof createServer>
  const SESSION_ID = 'codex-test-session-1'
  const dbPath = `/tmp/agent-flow-test-codex-${Date.now()}.db`

  beforeAll(() => {
    closeDb()
    srv = createServer({ port: 0, dbPath, serveStatic: false, authEnabled: false })
  })

  afterAll(() => {
    srv.close()
    closeDb()
    try { require('fs').unlinkSync(dbPath) } catch {}
  })

  test('full Codex session streams events to Socket.IO client', async () => {
    const testClient = createTestClient(srv.url, SESSION_ID)

    // Wait for client to connect and subscribe
    await new Promise(r => setTimeout(r, 500))

    const codexEvents = [
      { type: 'thread.started', thread_id: 'thread_abc' },
      { type: 'turn.started' },
      { type: 'item.started', item: { type: 'command_execution', command: 'cat src/index.ts' } },
      { type: 'item.completed', item: { type: 'command_execution', output: 'console.log("hello")' } },
      { type: 'item.started', item: { type: 'agent_message', content: 'I found the issue...' } },
      { type: 'item.completed', item: { type: 'agent_message', content: 'Fixed it.' } },
      { type: 'item.started', item: { type: 'file_change', file: 'src/index.ts', patch: '+console.log("fixed")' } },
      { type: 'item.completed', item: { type: 'file_change', patch: '+console.log("fixed")' } },
      { type: 'turn.completed' },
    ]

    for (const event of codexEvents) {
      await postEvent(srv.url, SESSION_ID, event)
    }

    await testClient.waitForEvents(9)

    expect(testClient.events.length).toBe(9)

    expect(testClient.events[0].type).toBe('session.start')
    expect(testClient.events[0].source).toBe('codex')
    expect(testClient.events[0].category).toBe('session')

    expect(testClient.events[1].type).toBe('turn.start')
    expect(testClient.events[1].category).toBe('system')

    expect(testClient.events[2].type).toBe('tool.start')
    expect(testClient.events[2].toolName).toBe('command_execution')
    expect(testClient.events[2].category).toBe('tool')

    expect(testClient.events[3].type).toBe('tool.end')
    expect(testClient.events[3].toolName).toBe('command_execution')
    expect(testClient.events[3].toolOutput).toBe('console.log("hello")')

    expect(testClient.events[4].type).toBe('message.assistant')
    expect(testClient.events[4].role).toBe('assistant')
    expect(testClient.events[4].text).toBe('I found the issue...')

    expect(testClient.events[5].type).toBe('message.assistant')
    expect(testClient.events[5].text).toBe('Fixed it.')

    expect(testClient.events[6].type).toBe('tool.start')
    expect(testClient.events[6].toolName).toBe('file_change')

    expect(testClient.events[7].type).toBe('tool.end')
    expect(testClient.events[7].toolName).toBe('file_change')

    expect(testClient.events[8].type).toBe('session.end')
    expect(testClient.events[8].category).toBe('session')

    testClient.close()
  })

  test('GET /api/sessions returns codex session', async () => {
    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]
    const session = data.find((s: any) => s.id === SESSION_ID)
    expect(session).toBeDefined()
    expect(session.eventCount).toBe(9)
    expect(session.source).toBe('codex')
  })

  test('GET /api/sessions/:id returns all codex events', async () => {
    const res = await fetch(`${srv.url}/api/sessions/${SESSION_ID}`)
    const data = await res.json() as any
    expect(data.id).toBe(SESSION_ID)
    expect(data.events.length).toBe(9)
    expect(data.status).toBe('completed')
  })

  test('mixed sessions appear in GET /api/sessions', async () => {
    const ccSessionId = 'cc-mixed-test'
    await fetch(`${srv.url}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'claude-code',
        sessionId: ccSessionId,
        event: { hook_event_name: 'SessionStart', session_id: ccSessionId },
      }),
    })

    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]

    const codexSession = data.find((s: any) => s.id === SESSION_ID)
    const ccSession = data.find((s: any) => s.id === ccSessionId)

    expect(codexSession).toBeDefined()
    expect(codexSession.source).toBe('codex')
    expect(ccSession).toBeDefined()
    expect(ccSession.source).toBe('claude-code')
  })

  test('DELETE /api/sessions clears all data', async () => {
    const delRes = await fetch(`${srv.url}/api/sessions`, { method: 'DELETE' })
    const delData = await delRes.json() as any
    expect(delData.ok).toBe(true)

    const res = await fetch(`${srv.url}/api/sessions`)
    const data = await res.json() as any[]
    expect(data.length).toBe(0)
  })
})
