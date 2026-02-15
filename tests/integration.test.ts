import { describe, test, expect, beforeAll } from 'bun:test'
import path from 'path'

const BASE_URL = process.env.AGENT_FLOW_URL ?? 'http://localhost:3333'
const HOOKS_SCRIPT = path.join(import.meta.dir, '..', 'adapters', 'claude-code-hooks.sh')

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// Clear stale data before running
beforeAll(async () => {
  await fetch(`${BASE_URL}/api/sessions`, { method: 'DELETE' })
})

describe('Integration - Real Claude Code session', () => {
  test('runs claude -p with hooks and streams events to AgentFlow', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: HOOKS_SCRIPT, async: true }] }],
        PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: HOOKS_SCRIPT, async: true }] }],
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: HOOKS_SCRIPT, async: true }] }],
        UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: HOOKS_SCRIPT, async: true }] }],
      },
    }
    const settingsPath = `/tmp/agent-flow-test-settings-${Date.now()}.json`
    await Bun.write(settingsPath, JSON.stringify(settings))

    try {
      const proc = Bun.spawn([
        'claude', '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--settings', settingsPath,
        '--allowedTools', 'Bash',
        '--max-turns', '2',
        'What is 2+2? Use bash to echo the answer: echo "2+2=4"',
      ], {
        env: { ...process.env, AGENT_FLOW_URL: BASE_URL },
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: import.meta.dir,
      })

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const exitCode = await proc.exited

      console.log('Claude exit code:', exitCode)
      console.log('Claude stdout (first 500):', stdout.slice(0, 500))
      if (stderr) console.log('Claude stderr (first 500):', stderr.slice(0, 500))

      // Give hooks time to POST
      await sleep(3000)

      const res = await fetch(`${BASE_URL}/api/sessions`)
      const sessions = await res.json() as any[]
      console.log('Sessions after Claude run:', sessions.length)
      sessions.forEach((s: any) => console.log(`  - ${s.id} (${s.source}) ${s.eventCount} events [${s.status}]`))

      const ccSessions = sessions.filter((s: any) => s.source === 'claude-code')
      expect(ccSessions.length).toBeGreaterThanOrEqual(1)

      const latest = ccSessions[0]
      expect(latest.eventCount).toBeGreaterThanOrEqual(1)

      const detailRes = await fetch(`${BASE_URL}/api/sessions/${latest.id}`)
      const detail = await detailRes.json() as any
      console.log('Event types:', detail.events.map((e: any) => e.type))
    } finally {
      try { require('fs').unlinkSync(settingsPath) } catch {}
    }
  }, 120_000)
})

describe('Integration - Real Codex session', () => {
  test('runs codex exec --json and pipes events to AgentFlow', async () => {
    const sessionId = `codex-integration-${Date.now()}`

    const proc = Bun.spawn([
      'codex', 'exec', '--json',
      '-s', 'read-only',
      'echo hello world',
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: path.join(import.meta.dir, '..'),  // project root (a git-trusted dir)
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lineCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          await fetch(`${BASE_URL}/api/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'codex', sessionId, event }),
          })
          lineCount++
          console.log(`Codex event ${lineCount}: ${event.type}`)
        } catch {}
      }
    }

    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        await fetch(`${BASE_URL}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'codex', sessionId, event }),
        })
        lineCount++
      } catch {}
    }

    const [, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ])
    console.log(`Codex finished, posted ${lineCount} events`)
    if (stderr) console.log('Codex stderr (first 500):', stderr.slice(0, 500))

    await sleep(1000)

    if (lineCount > 0) {
      const res = await fetch(`${BASE_URL}/api/sessions/${sessionId}`)
      const data = await res.json() as any
      expect(data.id).toBe(sessionId)
      expect(data.events.length).toBe(lineCount)
      console.log('Codex event types:', data.events.map((e: any) => e.type))
    } else {
      console.log('No codex events captured - check stderr above')
    }
  }, 120_000)
})
