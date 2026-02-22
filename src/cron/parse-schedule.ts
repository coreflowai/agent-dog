import Anthropic from '@anthropic-ai/sdk'

export type ParsedSchedule = {
  cronExpression: string
  humanReadable: string
  timezone: string
}

/**
 * Convert natural language schedule to cron expression using Claude Sonnet.
 * Called once at creation/update time, not per execution.
 */
export async function parseSchedule(text: string, timezone?: string): Promise<ParsedSchedule> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Convert this natural language schedule to a cron expression.

Schedule: "${text}"
${timezone ? `Preferred timezone: ${timezone}` : ''}

Respond with ONLY a JSON object (no markdown):
{"cronExpression": "...", "humanReadable": "...", "timezone": "..."}

Rules:
- cronExpression: standard 5-field cron (minute hour day-of-month month day-of-week)
- humanReadable: short description like "Every day at 9:00 AM"
- timezone: IANA timezone (use the preferred one if given, otherwise infer from context or default to UTC)
- For "every morning" use 9:00 AM, "every evening" use 6:00 PM, "every night" use 10:00 PM
- For "every N minutes/hours" use the appropriate cron syntax`,
    }],
  })

  const textBlock = response.content.find(c => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Failed to parse schedule: no response')
  }

  try {
    const parsed = JSON.parse(textBlock.text) as ParsedSchedule
    if (!parsed.cronExpression || !parsed.humanReadable) {
      throw new Error('Invalid response format')
    }
    return {
      cronExpression: parsed.cronExpression,
      humanReadable: parsed.humanReadable,
      timezone: parsed.timezone || timezone || 'UTC',
    }
  } catch {
    throw new Error(`Failed to parse schedule from: ${textBlock.text}`)
  }
}
