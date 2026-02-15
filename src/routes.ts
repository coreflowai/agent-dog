import type { Server as SocketIOServer } from 'socket.io'
import { normalize } from './normalize'
import { addEvent, getSession, getSessionEvents, listSessions, clearAll } from './db'
import type { IngestPayload } from './types'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function createRouter(io: SocketIOServer) {
  return async function handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url)
    const { pathname } = url

    // POST /api/ingest
    if (req.method === 'POST' && pathname === '/api/ingest') {
      try {
        const payload = (await req.json()) as IngestPayload
        if (!payload.source || !payload.sessionId || !payload.event) {
          return json({ error: 'Missing required fields: source, sessionId, event' }, 400)
        }

        const event = normalize(payload)
        addEvent(event)

        // Broadcast to Socket.IO subscribers
        io.to(`session:${event.sessionId}`).emit('event', event)
        io.emit('session:update', getSession(event.sessionId))

        return json({ ok: true, eventId: event.id })
      } catch (err: any) {
        return json({ error: err.message ?? 'Failed to process event' }, 500)
      }
    }

    // GET /api/sessions
    if (req.method === 'GET' && pathname === '/api/sessions') {
      return json(listSessions())
    }

    // GET /api/sessions/:id
    if (req.method === 'GET' && pathname.startsWith('/api/sessions/')) {
      const id = pathname.replace('/api/sessions/', '')
      const session = getSession(id)
      if (!session) return json({ error: 'Session not found' }, 404)
      const events = getSessionEvents(id)
      return json({ ...session, events })
    }

    // DELETE /api/sessions
    if (req.method === 'DELETE' && pathname === '/api/sessions') {
      clearAll()
      io.emit('sessions:cleared')
      return json({ ok: true })
    }

    return null // Not handled
  }
}
