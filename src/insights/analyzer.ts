import { spawn } from 'bun'
import { buildAnalysisPrompt, analysisToMarkdown, type AnalysisOutput } from './prompts'
import type { InsightMeta, FollowUpAction } from '../types'

export type AnalysisResult = {
  success: boolean
  content: string  // Markdown content
  categories: string[]
  followUpActions: FollowUpAction[]
  sessionsAnalyzed: number
  eventsAnalyzed: number
  meta: InsightMeta
  error?: string
}

type OpenCodeMessage = {
  role: 'user' | 'assistant'
  content: string
}

type OpenCodeResponse = {
  messages: OpenCodeMessage[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  model?: string
}

/**
 * Run the insight analysis using OpenCode CLI.
 * Spawns `opencode run --format json` with the analysis prompt.
 */
export async function runAnalysis(
  userId: string,
  repoName: string | null,
  sinceTimestamp: number,
  dbPath: string
): Promise<AnalysisResult> {
  const startTime = Date.now()
  const prompt = buildAnalysisPrompt(userId, repoName, sinceTimestamp)

  try {
    // Run OpenCode CLI with custom AGENT_FLOW_DB path so the tools use the right DB
    const proc = spawn({
      cmd: ['opencode', 'run', '--format', 'json', prompt],
      env: {
        ...process.env,
        AGENT_FLOW_DB: dbPath,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // Collect stdout
    const chunks: Buffer[] = []
    const reader = proc.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }

    const stdout = Buffer.concat(chunks).toString('utf-8')

    // Collect stderr for debugging
    const stderrChunks: Buffer[] = []
    const stderrReader = proc.stderr.getReader()
    while (true) {
      const { done, value } = await stderrReader.read()
      if (done) break
      stderrChunks.push(Buffer.from(value))
    }
    const stderr = Buffer.concat(stderrChunks).toString('utf-8')

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      return {
        success: false,
        content: '',
        categories: [],
        followUpActions: [],
        sessionsAnalyzed: 0,
        eventsAnalyzed: 0,
        meta: {
          durationMs: Date.now() - startTime,
          error: `OpenCode exited with code ${exitCode}: ${stderr}`,
        },
        error: `OpenCode exited with code ${exitCode}`,
      }
    }

    // Parse the JSON response from OpenCode
    const response = parseOpenCodeResponse(stdout)
    if (!response) {
      return {
        success: false,
        content: '',
        categories: [],
        followUpActions: [],
        sessionsAnalyzed: 0,
        eventsAnalyzed: 0,
        meta: {
          durationMs: Date.now() - startTime,
          error: 'Failed to parse OpenCode response',
          rawOutput: stdout.slice(0, 2000),
        },
        error: 'Failed to parse OpenCode response',
      }
    }

    // Extract the analysis JSON from the assistant's response
    const analysis = extractAnalysis(response.messages)
    if (!analysis) {
      // If we can't extract structured analysis, use raw response
      const lastAssistantMsg = response.messages
        .filter(m => m.role === 'assistant')
        .pop()

      return {
        success: true,
        content: lastAssistantMsg?.content ?? 'No analysis generated',
        categories: [],
        followUpActions: [],
        sessionsAnalyzed: 0,
        eventsAnalyzed: 0,
        meta: {
          durationMs: Date.now() - startTime,
          model: response.model,
          tokenUsage: response.usage ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
            cacheReadTokens: response.usage.cache_read_input_tokens,
            cacheCreationTokens: response.usage.cache_creation_input_tokens,
          } : undefined,
        },
      }
    }

    // Convert structured analysis to markdown
    const content = analysisToMarkdown(analysis)

    // Map follow-up actions to our type
    const followUpActions: FollowUpAction[] = (analysis.followUpActions ?? []).map(a => ({
      action: a.action,
      priority: a.priority,
      category: a.category,
    }))

    // Derive categories from the analysis
    const categories: string[] = []
    if (analysis.frustrationPoints?.some(fp => fp.severity === 'high')) {
      categories.push('high-frustration')
    }
    if (analysis.improvements?.length) {
      categories.push('has-improvements')
    }
    if (analysis.userIntent?.goals?.length) {
      categories.push('goals-identified')
    }

    return {
      success: true,
      content,
      categories,
      followUpActions,
      sessionsAnalyzed: analysis.stats?.sessionsAnalyzed ?? 0,
      eventsAnalyzed: analysis.stats?.eventsAnalyzed ?? 0,
      meta: {
        durationMs: Date.now() - startTime,
        model: response.model,
        tokenUsage: response.usage ? {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens,
        } : undefined,
      },
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      categories: [],
      followUpActions: [],
      sessionsAnalyzed: 0,
      eventsAnalyzed: 0,
      meta: {
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Parse the OpenCode CLI JSON output.
 */
function parseOpenCodeResponse(output: string): OpenCodeResponse | null {
  try {
    // OpenCode outputs JSON directly when using --format json
    return JSON.parse(output)
  } catch {
    // Try to find JSON in the output (in case there's extra text)
    const jsonMatch = output.match(/\{[\s\S]*"messages"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Extract structured analysis from assistant messages.
 * Looks for JSON block in the response.
 */
function extractAnalysis(messages: OpenCodeMessage[]): AnalysisOutput | null {
  // Get all assistant messages
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  if (assistantMessages.length === 0) return null

  // Look through all messages for a JSON code block
  for (const msg of assistantMessages) {
    const content = msg.content

    // Try to find JSON in code block
    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1])
      } catch {
        // Continue looking
      }
    }

    // Try to find raw JSON object
    const jsonMatch = content.match(/\{[\s\S]*"summary"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        // Continue looking
      }
    }
  }

  return null
}
