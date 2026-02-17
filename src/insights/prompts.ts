/**
 * Build the analysis prompt for OpenCode to analyze user sessions.
 */
export function buildAnalysisPrompt(
  userId: string,
  repoName: string | null,
  sinceTimestamp: number
): string {
  const repoContext = repoName
    ? `for repository "${repoName}"`
    : 'across all repositories'

  return `You are analyzing AI agent session data for user "${userId}" ${repoContext} to generate actionable insights.

## Your Task

Use the \`sql\` tool to query the AgentFlow database and analyze this user's recent sessions and events since timestamp ${sinceTimestamp} (${new Date(sinceTimestamp).toISOString()}).

First, use the \`schema\` tool to understand the database structure, then perform your analysis.

## Analysis Steps

1. **Gather Data**: Query recent sessions and events for this user${repoName ? ` in repo "${repoName}"` : ''}:
   - Sessions: WHERE user_id = '${userId}'${repoName ? ` AND json_extract(metadata, '$.git.repoName') = '${repoName}'` : ''}
   - Events: WHERE timestamp > ${sinceTimestamp}

2. **Analyze User Intent**: What was the user trying to accomplish?
   - Look at message.user events for their prompts/requests
   - Identify recurring themes and patterns
   - Note the types of tasks they're working on

3. **Identify Frustration Points**: Where did they struggle?
   - Look for error events (category = 'error')
   - Find repeated attempts at similar tasks
   - Check for messages containing "try again", "not working", "fix", etc.
   - Note tool failures or unexpected outputs

4. **Evaluate Tool Usage**: How are they using the AI agent?
   - Which tools are used most frequently?
   - Are there tools they could use more effectively?
   - Any patterns in tool usage that could be optimized?

5. **Generate Improvement Suggestions**: What could help them work better?
   - Based on observed patterns and struggles
   - Practical, actionable recommendations

## Output Format

Generate your response as valid JSON with this exact structure:

\`\`\`json
{
  "summary": "2-3 sentence overview of the analysis period",
  "userIntent": {
    "goals": ["goal1", "goal2"],
    "patterns": ["pattern1", "pattern2"]
  },
  "frustrationPoints": [
    {
      "description": "What happened",
      "severity": "low|medium|high",
      "evidence": "Quote or reference from the data"
    }
  ],
  "improvements": [
    {
      "title": "Short title",
      "description": "Detailed suggestion"
    }
  ],
  "followUpActions": [
    {
      "action": "Specific action to take",
      "priority": "low|medium|high",
      "category": "tooling|workflow|knowledge|other"
    }
  ],
  "stats": {
    "sessionsAnalyzed": 0,
    "eventsAnalyzed": 0,
    "timeRangeStart": "${new Date(sinceTimestamp).toISOString()}",
    "timeRangeEnd": "now"
  }
}
\`\`\`

Be specific, actionable, and base everything on the actual data from the database. If there's not enough data for meaningful analysis, say so in the summary.`
}

/**
 * Convert the JSON analysis output to markdown content for storage.
 */
export function analysisToMarkdown(analysis: AnalysisOutput): string {
  const lines: string[] = []

  // Summary
  lines.push(`## Summary\n`)
  lines.push(analysis.summary)
  lines.push('')

  // User Intent
  if (analysis.userIntent) {
    lines.push(`## User Intent\n`)
    if (analysis.userIntent.goals?.length) {
      lines.push(`### Goals`)
      for (const goal of analysis.userIntent.goals) {
        lines.push(`- ${goal}`)
      }
      lines.push('')
    }
    if (analysis.userIntent.patterns?.length) {
      lines.push(`### Patterns`)
      for (const pattern of analysis.userIntent.patterns) {
        lines.push(`- ${pattern}`)
      }
      lines.push('')
    }
  }

  // Frustration Points
  if (analysis.frustrationPoints?.length) {
    lines.push(`## Frustration Points\n`)
    for (const fp of analysis.frustrationPoints) {
      const severity = fp.severity === 'high' ? '🔴' : fp.severity === 'medium' ? '🟡' : '🟢'
      lines.push(`### ${severity} ${fp.description}`)
      lines.push(`**Severity**: ${fp.severity}`)
      if (fp.evidence) {
        lines.push(`**Evidence**: ${fp.evidence}`)
      }
      lines.push('')
    }
  }

  // Improvements
  if (analysis.improvements?.length) {
    lines.push(`## Suggested Improvements\n`)
    for (let i = 0; i < analysis.improvements.length; i++) {
      const imp = analysis.improvements[i]
      lines.push(`### ${i + 1}. ${imp.title}`)
      lines.push(imp.description)
      lines.push('')
    }
  }

  // Follow-up Actions
  if (analysis.followUpActions?.length) {
    lines.push(`## Follow-up Actions\n`)
    for (const action of analysis.followUpActions) {
      const priority = action.priority === 'high' ? '🔴' : action.priority === 'medium' ? '🟡' : '🟢'
      lines.push(`- ${priority} **[${action.category}]** ${action.action}`)
    }
    lines.push('')
  }

  // Questions for Team
  if (analysis.questions?.length) {
    lines.push(`## Questions for Team\n`)
    for (const q of analysis.questions) {
      const target = q.targetUser ? ` *(for @${q.targetUser})*` : ''
      lines.push(`- ${q.text}${target}`)
    }
    lines.push('')
  }

  // Stats
  if (analysis.stats) {
    lines.push(`---`)
    lines.push(`*Analysis based on ${analysis.stats.sessionsAnalyzed} sessions and ${analysis.stats.eventsAnalyzed} events*`)
    lines.push(`*Time range: ${analysis.stats.timeRangeStart} to ${analysis.stats.timeRangeEnd}*`)
  }

  return lines.join('\n')
}

export type AnalysisOutput = {
  summary: string
  userIntent?: {
    goals?: string[]
    patterns?: string[]
  }
  frustrationPoints?: Array<{
    description: string
    severity: 'low' | 'medium' | 'high'
    evidence?: string
  }>
  improvements?: Array<{
    title: string
    description: string
  }>
  followUpActions?: Array<{
    action: string
    priority: 'low' | 'medium' | 'high'
    category: 'tooling' | 'workflow' | 'knowledge' | 'other'
  }>
  questions?: Array<{
    text: string
    reason: string
    targetUser?: string
    options?: Array<{ id: string; label: string }>
  }>
  stats?: {
    sessionsAnalyzed: number
    eventsAnalyzed: number
    timeRangeStart: string
    timeRangeEnd: string
  }
}
