import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { io as ioClient, type Socket } from 'socket.io-client'
import { createServer } from '../src/server-factory'
import { closeDb } from '../src/db'

const TEST_EMAIL = 'test@example.com'
const TEST_PASSWORD = 'testpassword123'
const TEST_NAME = 'Test User'

describe('Auth', () => {
  let srv: ReturnType<typeof createServer>
  const dbPath = `/tmp/agent-flow-test-auth-${Date.now()}.db`

  beforeAll(async () => {
    closeDb()
    process.env.BETTER_AUTH_SECRET = 'test-secret-for-auth-tests-32-chars-min'
    srv = createServer({ port: 0, dbPath, serveStatic: false, authEnabled: true })
    // Wait for auth migrations
    await new Promise(r => setTimeout(r, 2000))
  })

  afterAll(() => {
    srv.close()
    closeDb()
    delete process.env.BETTER_AUTH_SECRET
    try { require('fs').unlinkSync(dbPath) } catch {}
  })

  test('unauthenticated API request returns 401', async () => {
    const res = await fetch(`${srv.url}/api/sessions`)
    expect(res.status).toBe(401)
    const data = await res.json() as any
    expect(data.error).toBe('Unauthorized')
  })

  test('sign-up creates a user and returns token', async () => {
    const res = await fetch(`${srv.url}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.user).toBeDefined()
    expect(data.user.email).toBe(TEST_EMAIL)
    expect(data.token).toBeTruthy()
  })

  test('sign-in returns session cookie', async () => {
    const res = await fetch(`${srv.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.user).toBeDefined()
    expect(data.token).toBeTruthy()
    // Should have set-cookie header
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
  })

  test('session-authenticated API access works', async () => {
    // Sign in to get session cookie
    const signInRes = await fetch(`${srv.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    const setCookie = signInRes.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()

    // Extract cookies
    const cookies = extractCookies(signInRes)

    // Use session cookie to access API
    const res = await fetch(`${srv.url}/api/sessions`, {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  test('API key creation and ingest with key', async () => {
    // Sign in
    const signInRes = await fetch(`${srv.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    const cookies = extractCookies(signInRes)

    // Create API key
    const createKeyRes = await fetch(`${srv.url}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ name: 'test-key', expiresIn: null }),
    })
    expect(createKeyRes.status).toBe(200)
    const keyData = await createKeyRes.json() as any
    expect(keyData.key).toBeTruthy()
    expect(keyData.key.startsWith('agentflow_')).toBe(true)

    const apiKey = keyData.key

    // Use API key to ingest
    const ingestRes = await fetch(`${srv.url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        source: 'claude-code',
        sessionId: 'auth-test-session',
        event: { hook_event_name: 'SessionStart', session_id: 'auth-test-session' },
      }),
    })
    expect(ingestRes.status).toBe(200)
    const ingestData = await ingestRes.json() as any
    expect(ingestData.ok).toBe(true)
  })

  test('invalid API key returns 401', async () => {
    const res = await fetch(`${srv.url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'agentflow_invalid_key_here',
      },
      body: JSON.stringify({
        source: 'claude-code',
        sessionId: 'test',
        event: { hook_event_name: 'SessionStart', session_id: 'test' },
      }),
    })
    expect(res.status).toBe(401)
  })

  test('Socket.IO rejects unauthenticated connection', async () => {
    const client = ioClient(srv.url, {
      transports: ['websocket'],
      autoConnect: false,
    })

    const error = await new Promise<Error>((resolve) => {
      client.on('connect_error', (err: Error) => {
        resolve(err)
      })
      client.connect()
    })

    expect(error.message).toContain('Authentication required')
    client.close()
  })
})

// Helper to extract all set-cookie headers into a single cookie string
function extractCookies(res: Response): string {
  const setCookieHeaders = res.headers.getAll?.('set-cookie') ?? [res.headers.get('set-cookie') ?? '']
  return setCookieHeaders
    .flatMap((h: string) => h.split(',').map(c => c.trim()))
    .map((c: string) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}
