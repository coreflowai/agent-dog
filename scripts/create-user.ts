#!/usr/bin/env bun
// Usage: bun scripts/create-user.ts <email> <password> [name]
// Creates a user via Better Auth's server-side API

import { initDb } from '../src/db'
import { createAuth, migrateAuth } from '../src/auth'

const [email, password, name] = process.argv.slice(2)

if (!email || !password) {
  console.error('Usage: bun scripts/create-user.ts <email> <password> [name]')
  process.exit(1)
}

const dbPath = process.env.AGENT_FLOW_DB ?? 'agent-flow.db'
initDb(dbPath)

await migrateAuth({ disableSignUp: false })
const auth = createAuth({ disableSignUp: false })

try {
  const result = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: name || email.split('@')[0],
    },
  })
  console.log('User created:', { id: result.user.id, email: result.user.email, name: result.user.name })
} catch (err: any) {
  console.error('Failed to create user:', err.message || err)
  process.exit(1)
}
