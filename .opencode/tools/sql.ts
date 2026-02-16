import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"

const DB_PATH = process.env.AGENT_FLOW_DB ?? "agent-flow.db"

export default tool({
  description: `Execute read-only SQL queries against the AgentFlow SQLite database.

Available tables:
- sessions: id, source, start_time, last_event_time, status, metadata (JSON with user/git info), user_id
- events: id, session_id, timestamp, source, category, type, role, text, tool_name, tool_input, tool_output, error, meta
- insights: id, user_id, repo_name, created_at, analysis_window_start, analysis_window_end, sessions_analyzed, events_analyzed, content, categories, follow_up_actions, meta
- insight_analysis_state: id, user_id, repo_name, last_analyzed_at, last_event_timestamp

The metadata JSON in sessions contains:
- user: { name, email, osUser, githubUsername, githubId }
- git: { commit, branch, remote, repoName, workDir }

Event categories: 'session', 'message', 'tool', 'error', 'system'
Event types: 'session.start', 'session.end', 'message.user', 'message.assistant', 'tool.start', 'tool.end', etc.

Returns results as JSON array. Only SELECT statements are allowed.`,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "SQL SELECT query to execute. Only SELECT statements allowed.",
      },
    },
    required: ["query"],
  },
  async execute({ query }: { query: string }) {
    // Security: Only allow SELECT
    const normalized = query.trim().toUpperCase()
    if (!normalized.startsWith("SELECT")) {
      throw new Error("Only SELECT queries allowed")
    }

    const forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE", "ATTACH", "DETACH"]
    for (const kw of forbidden) {
      if (normalized.includes(kw)) {
        throw new Error(`Forbidden keyword: ${kw}`)
      }
    }

    try {
      const db = new Database(DB_PATH, { readonly: true })
      const results = db.prepare(query).all()
      db.close()
      return JSON.stringify(results, null, 2)
    } catch (error) {
      throw new Error(`SQL query failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
})
