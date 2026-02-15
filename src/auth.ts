import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db"
import { apiKey } from "better-auth/plugins"
import { getSqlite } from "./db"

const ALLOWED_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS
  ?.split(",").map(d => d.trim().toLowerCase()).filter(Boolean) ?? []

function isEmailAllowed(email: string): boolean {
  if (ALLOWED_DOMAINS.length === 0) return true
  const domain = email.split("@")[1]?.toLowerCase()
  return ALLOWED_DOMAINS.includes(domain!)
}

function getAuthConfig(options?: { baseURL?: string }) {
  const sqlite = getSqlite()
  return {
    database: sqlite,
    basePath: "/api/auth",
    baseURL: options?.baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      async onSignUp({ email }: { email: string }) {
        if (!isEmailAllowed(email)) {
          throw new Error("Email domain not allowed")
        }
      },
    },
    plugins: [
      apiKey({
        defaultPrefix: "agentflow_",
        enableMetadata: true,
      }),
    ],
  } as const
}

export async function migrateAuth(options?: { baseURL?: string }) {
  const config = getAuthConfig(options)
  const { runMigrations } = await getMigrations(config)
  await runMigrations()
}

export function createAuth(options?: { baseURL?: string }) {
  return betterAuth(getAuthConfig(options))
}

export type Auth = ReturnType<typeof createAuth>

export async function authenticateRequest(req: Request, auth: Auth): Promise<{ authenticated: boolean; userId?: string }> {
  // 1. Check x-api-key header
  const apiKeyHeader = req.headers.get("x-api-key")
  if (apiKeyHeader) {
    try {
      const result = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } })
      if (result.valid && result.key) {
        return { authenticated: true, userId: result.key.userId }
      }
    } catch {}
    return { authenticated: false }
  }

  // 2. Check session cookie
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (session?.user) {
      return { authenticated: true, userId: session.user.id }
    }
  } catch {}

  return { authenticated: false }
}
