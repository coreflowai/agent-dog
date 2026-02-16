import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Get the AgentFlow database schema documentation. Use this to understand the database structure before writing SQL queries.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute() {
    return `# AgentFlow Database Schema

## sessions
Stores AI agent session information.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Session identifier (UUID) |
| source | TEXT | Agent source: 'claude-code', 'codex', or 'opencode' |
| start_time | INTEGER | Unix timestamp (ms) of session start |
| last_event_time | INTEGER | Unix timestamp (ms) of last event |
| status | TEXT | Session status: 'active', 'completed', 'error', 'archived' |
| metadata | JSON | Contains user and git info (see below) |
| user_id | TEXT | GitHub username, email, or OS user |

### metadata.user object:
- name: git config user.name
- email: git config user.email
- osUser: system username
- githubUsername: GitHub username
- githubId: GitHub user ID (number)

### metadata.git object:
- commit: short commit hash
- branch: current branch name
- remote: git remote URL
- repoName: "owner/repo" format (e.g., "bennykok/agent-dog")
- workDir: working directory name

## events
Stores individual events within sessions.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Event UUID |
| session_id | TEXT FK | References sessions.id |
| timestamp | INTEGER | Unix timestamp (ms) |
| source | TEXT | Event source |
| category | TEXT | 'session', 'message', 'tool', 'error', 'system' |
| type | TEXT | Event type (see examples below) |
| role | TEXT | 'user', 'assistant', 'system', or null |
| text | TEXT | Message content |
| tool_name | TEXT | Tool name if tool event |
| tool_input | JSON | Tool arguments/parameters |
| tool_output | JSON | Tool results (truncated to 10KB) |
| error | TEXT | Error message if error event |
| meta | JSON | Additional event metadata |

### Event type examples:
- session.start, session.end
- message.user, message.assistant
- tool.start, tool.end
- error

## insights
Stores AI-generated analysis insights.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Insight UUID |
| user_id | TEXT | GitHub username |
| repo_name | TEXT | Repository name (e.g., "bennykok/agent-dog"), null for all repos |
| created_at | INTEGER | Unix timestamp (ms) when insight was created |
| analysis_window_start | INTEGER | Start of analyzed time range |
| analysis_window_end | INTEGER | End of analyzed time range |
| sessions_analyzed | INTEGER | Number of sessions analyzed |
| events_analyzed | INTEGER | Number of events analyzed |
| content | TEXT | Markdown content of the insight |
| categories | JSON | Array of insight categories |
| follow_up_actions | JSON | Array of suggested actions |
| meta | JSON | Token usage, model, duration, etc. |

## insight_analysis_state
Tracks when each user+repo was last analyzed.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Composite key: "userId:repoName" or "userId:all" |
| user_id | TEXT | GitHub username |
| repo_name | TEXT | Repository name, or null for all repos |
| last_analyzed_at | INTEGER | Unix timestamp (ms) of last analysis |
| last_event_timestamp | INTEGER | Timestamp of last event that was analyzed |

## Useful Query Examples

### Get sessions for a specific user with git info:
\`\`\`sql
SELECT id, source, status,
       json_extract(metadata, '$.git.repoName') as repo,
       json_extract(metadata, '$.git.branch') as branch,
       datetime(start_time/1000, 'unixepoch') as started
FROM sessions
WHERE user_id = 'username'
ORDER BY last_event_time DESC
LIMIT 10;
\`\`\`

### Count events by type for a session:
\`\`\`sql
SELECT type, COUNT(*) as count
FROM events
WHERE session_id = 'xxx'
GROUP BY type
ORDER BY count DESC;
\`\`\`

### Find errors in recent sessions:
\`\`\`sql
SELECT e.session_id, e.error, e.timestamp,
       datetime(e.timestamp/1000, 'unixepoch') as time
FROM events e
WHERE e.category = 'error'
ORDER BY e.timestamp DESC
LIMIT 20;
\`\`\`

### Get tool usage statistics:
\`\`\`sql
SELECT tool_name, COUNT(*) as count
FROM events
WHERE tool_name IS NOT NULL
GROUP BY tool_name
ORDER BY count DESC;
\`\`\`

### Find user frustration indicators:
\`\`\`sql
SELECT * FROM events
WHERE category = 'error'
   OR (type = 'message.user' AND (
       text LIKE '%try again%'
       OR text LIKE '%not working%'
       OR text LIKE '%wrong%'
       OR text LIKE '%fix%'
   ))
ORDER BY timestamp DESC;
\`\`\`
`
  },
})
