import { Server as Engine } from '@socket.io/bun-engine'
import { Server as SocketIOServer } from 'socket.io'
import { initDb, listSessions, getSessionEvents } from './db'
import { createRouter } from './routes'
import path from 'path'
import { execSync } from 'child_process'

const GIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim() }
  catch { return Date.now().toString(36) }
})()

type ServerOptions = {
  port?: number
  dbPath?: string
  serveStatic?: boolean
}

export function createServer(options: ServerOptions = {}) {
  const { port = 3333, dbPath, serveStatic = true } = options

  initDb(dbPath)

  const io = new SocketIOServer()
  const engine = new Engine({ path: '/socket.io/' })
  io.bind(engine)

  const router = createRouter(io)
  const engineHandler = engine.handler()
  const publicDir = path.join(import.meta.dir, '..', 'public')

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    socket.emit('sessions:list', listSessions())

    socket.on('subscribe', (sessionId: string) => {
      socket.join(`session:${sessionId}`)
      const events = getSessionEvents(sessionId)
      socket.emit('session:events', { sessionId, events })
    })

    socket.on('unsubscribe', (sessionId: string) => {
      socket.leave(`session:${sessionId}`)
    })
  })

  const server = Bun.serve({
    port,
    idleTimeout: 30,
    async fetch(req, server) {
      // Route Socket.IO requests to the engine
      const url = new URL(req.url)
      if (url.pathname.startsWith('/socket.io/')) {
        return engine.handleRequest(req, server)
      }

      // Try API routes
      const apiResponse = await router(req)
      if (apiResponse) return apiResponse

      // Static file serving
      if (serveStatic) {
        const isIndex = url.pathname === '/'
        const filePath = path.join(publicDir, isIndex ? 'index.html' : url.pathname)

        if (filePath.startsWith(publicDir)) {
          try {
            const file = Bun.file(filePath)
            if (await file.exists()) {
              // Rewrite HTML to inject git hash for cache-busting
              if (filePath.endsWith('.html')) {
                let html = await file.text()
                html = html.replace(/(src|href)="(\/[^"]+\.(js|css))(\?[^"]*)?"/g, `$1="$2?v=${GIT_HASH}"`)
                return new Response(html, {
                  headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
                })
              }
              return new Response(file, {
                headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
              })
            }
          } catch {}

          // Fallback to index.html
          const indexFile = Bun.file(path.join(publicDir, 'index.html'))
          if (await indexFile.exists()) {
            let html = await indexFile.text()
            html = html.replace(/(src|href)="(\/[^"]+\.(js|css))(\?[^"]*)?"/g, `$1="$2?v=${GIT_HASH}"`)
            return new Response(html, {
              headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
            })
          }
        }
      }

      return new Response('Not Found', { status: 404 })
    },
    websocket: engineHandler.websocket,
  })

  return {
    server,
    io,
    url: `http://localhost:${server.port}`,
    close: () => {
      io.close()
      server.stop(true)
    },
  }
}
