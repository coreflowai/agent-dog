import { createServer } from './src/server-factory'

const PORT = parseInt(process.env.PORT ?? '3333', 10)
const DB_PATH = process.env.AGENT_FLOW_DB ?? 'agent-flow.db'

if (!process.env.BETTER_AUTH_SECRET) {
  console.warn('WARNING: BETTER_AUTH_SECRET is not set. Auth will not work properly in production.')
}

const { server, io, url } = createServer({
  port: PORT,
  dbPath: DB_PATH,
  serveStatic: true,
})

console.log(`AgentFlow running at ${url}`)

export { server, io }
