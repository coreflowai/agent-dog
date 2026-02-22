import Anthropic from '@anthropic-ai/sdk'
import type { Server as SocketIOServer } from 'socket.io'
import { addEvent, updateSessionMeta, getSession } from '../db'
import { getCronJob, updateCronJobRun } from '../db/cron'
import { tools as dbTools, executeSqlTool, executeSchemaTools } from '../insights/analyzer'
import { integrationToolDefinitions, executeIntegrationTool } from '../slack/tools'
import { MAX_TOOL_RESULT } from '../slack/tools/types'
import type { AgentFlowEvent, CronJob } from '../types'
import type { SlackBot } from '../slack'

const MAX_ITERATIONS = 15

const SYSTEM_PROMPT = `You are a scheduled task agent running inside AgentFlow. You have access to tools for querying databases, searching the web, and interacting with GitHub, Slack, Discord, and Datadog.

Execute the task described in the user prompt thoroughly. Use tools as needed to gather data and complete the task. Provide a clear, concise summary of your findings or actions.

When querying data:
- Use the schema tool first if you need to understand database structure
- Use LIMIT in SQL queries to avoid oversized results
- Convert timestamps to human-readable format in your response

Keep your final response focused and actionable.`

type ExecutorOptions = {
  io: SocketIOServer
  dbPath: string
  sourcesDbPath?: string
  slackBot?: { bot: SlackBot | null }
}

function makeEvent(sessionId: string, partial: Partial<AgentFlowEvent>): AgentFlowEvent {
  return {
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    source: 'cron',
    category: 'system',
    type: '',
    role: null,
    text: null,
    toolName: null,
    toolInput: null,
    toolOutput: null,
    error: null,
    meta: {},
    ...partial,
  }
}

function injectEvent(event: AgentFlowEvent, io: SocketIOServer) {
  addEvent(event)
  io.to(`session:${event.sessionId}`).emit('event', event)
  io.emit('session:update', getSession(event.sessionId))
}

const chatTools: Anthropic.Messages.ToolUnion[] = [
  ...dbTools,
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  } as Anthropic.Messages.WebSearchTool20250305,
  ...integrationToolDefinitions,
]

/**
 * Execute a cron job as a full AgentFlow session.
 */
export async function executeCronJob(job: CronJob, opts: ExecutorOptions): Promise<{ success: boolean; sessionId: string; error?: string }> {
  const { io, dbPath, sourcesDbPath, slackBot } = opts
  const sessionId = `cron-${job.id.slice(0, 8)}-${Date.now()}`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { success: false, sessionId, error: 'ANTHROPIC_API_KEY not configured' }
  }

  // Mark job as running
  updateCronJobRun(job.id, {
    lastRunAt: Date.now(),
    lastRunSessionId: sessionId,
    lastRunStatus: 'running',
  })

  // Inject session.start
  const startEvent = makeEvent(sessionId, {
    category: 'session',
    type: 'session.start',
    meta: { title: `Cron: ${job.name}`, cronJob: { id: job.id, name: job.name, schedule: job.scheduleText } },
  })
  injectEvent(startEvent, io)
  updateSessionMeta(sessionId, { title: `Cron: ${job.name}`, cronJob: { id: job.id, name: job.name, schedule: job.scheduleText } })

  // Inject user message (the prompt)
  injectEvent(makeEvent(sessionId, {
    category: 'message',
    type: 'message.user',
    role: 'user',
    text: job.prompt,
  }), io)

  const client = new Anthropic({ apiKey })
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: job.prompt }]
  let finalText = ''
  let success = true

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: chatTools as any,
        messages,
      })

      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find(c => c.type === 'text')
        finalText = textBlock?.type === 'text' ? textBlock.text : 'Task completed.'

        injectEvent(makeEvent(sessionId, {
          category: 'message',
          type: 'message.assistant',
          role: 'assistant',
          text: finalText,
        }), io)
        break
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(c => c.type === 'tool_use')

        // Emit tool.start events
        for (const block of toolUseBlocks) {
          if (block.type !== 'tool_use') continue
          injectEvent(makeEvent(sessionId, {
            category: 'tool',
            type: 'tool.start',
            toolName: block.name,
            toolInput: block.input,
          }), io)
        }

        messages.push({ role: 'assistant', content: response.content })

        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of toolUseBlocks) {
          if (block.type !== 'tool_use') continue
          let result: string
          try {
            if (block.name === 'sql') {
              result = executeSqlTool((block.input as { query: string }).query, dbPath, sourcesDbPath)
            } else if (block.name === 'schema') {
              result = executeSchemaTools()
            } else {
              const integrationResult = await executeIntegrationTool(block.name, block.input as Record<string, unknown>)
              result = integrationResult ?? `Unknown tool: ${block.name}`
            }
            if (result.length > MAX_TOOL_RESULT) {
              result = result.slice(0, MAX_TOOL_RESULT) + '\n... (truncated)'
            }
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`
          }

          // Emit tool.end event
          injectEvent(makeEvent(sessionId, {
            category: 'tool',
            type: 'tool.end',
            toolName: block.name,
            toolInput: block.input,
            toolOutput: result,
          }), io)

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[CronExecutor] Error running job ${job.name}:`, err)
    success = false
    finalText = `Error: ${errMsg}`

    injectEvent(makeEvent(sessionId, {
      category: 'error',
      type: 'error',
      error: errMsg,
    }), io)
  }

  // Inject session.end
  injectEvent(makeEvent(sessionId, {
    category: 'session',
    type: 'session.end',
  }), io)

  // Update job record
  const currentJob = getCronJob(job.id)
  updateCronJobRun(job.id, {
    lastRunStatus: success ? 'success' : 'error',
    totalRuns: (currentJob?.totalRuns ?? 0) + 1,
  })

  // Notify Slack if enabled
  if (job.notifySlack && slackBot?.bot?.isConnected()) {
    const summary = finalText.length > 500 ? finalText.slice(0, 500) + '...' : finalText
    const statusEmoji = success ? ':white_check_mark:' : ':x:'
    await slackBot.bot.sendAdminDM(`${statusEmoji} *Cron job "${job.name}"* completed\n>${summary}`)
  }

  // Emit cron:run event for frontend refresh
  io.emit('cron:run', { jobId: job.id, sessionId, success })

  return { success, sessionId, error: success ? undefined : finalText }
}
