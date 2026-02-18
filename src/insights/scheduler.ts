import { Cron } from 'croner'
import { EventEmitter } from 'events'
import type { Server as SocketIOServer } from 'socket.io'
import { runAnalysis, runRefinement, type AnalysisResult } from './analyzer'
import {
  getUsersWithActivity,
  getAnalysisState,
  updateAnalysisState,
  addInsight,
  updateInsight,
  getInsight,
  countUserEventsSince,
} from '../db/insights'
import { addQuestion, getQuestion, getQuestionsByInsightId, markQuestionAnsweredFromReplies } from '../db/slack'
import type { SlackBot } from '../slack'
import type { InsightMeta } from '../types'

// Minimum events required to trigger analysis
const MIN_EVENTS_FOR_ANALYSIS = 5

// Default analysis window: 30 minutes
const DEFAULT_ANALYSIS_WINDOW_MS = 30 * 60 * 1000

// Default max question rounds
const DEFAULT_MAX_QUESTION_ROUNDS = 3

export type InsightSchedulerOptions = {
  /** Socket.IO server for real-time updates */
  io: SocketIOServer
  /** Path to the SQLite database */
  dbPath: string
  /** Path to the sources SQLite database (for external context) */
  sourcesDbPath?: string
  /** Cron expression (default: every 5 hours) */
  cronExpression?: string
  /** Whether to run immediately on start */
  runOnStart?: boolean
  /** Minimum events required to trigger analysis */
  minEventsForAnalysis?: number
  /** Reference to Slack bot for posting questions */
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> }
  /** Internal event bus for cross-component communication */
  internalBus?: EventEmitter
  /** Max rounds of questions before forcing final */
  maxQuestionRounds?: number
}

export type InsightScheduler = {
  /** Stop the scheduler */
  stop: () => void
  /** Run analysis manually */
  runNow: () => Promise<void>
  /** Check if scheduler is running */
  isRunning: () => boolean
}

/**
 * Create and start the insight analysis scheduler.
 * Runs every 5 hours by default, analyzing all sessions per user.
 */
export function createInsightScheduler(options: InsightSchedulerOptions): InsightScheduler {
  const {
    io,
    dbPath,
    sourcesDbPath,
    cronExpression = '0 */5 * * *', // Every 5 hours
    runOnStart = false,
    minEventsForAnalysis = MIN_EVENTS_FOR_ANALYSIS,
    slackBot,
    internalBus,
    maxQuestionRounds = DEFAULT_MAX_QUESTION_ROUNDS,
  } = options

  let isAnalyzing = false

  // Listen for thread:ready events — debounced thread replies are ready for refinement
  if (internalBus) {
    internalBus.on('thread:ready', async ({ questionId }: { questionId: string }) => {
      try {
        // Consolidate thread replies into the answer field
        markQuestionAnsweredFromReplies(questionId)

        const question = getQuestion(questionId)
        if (!question || !question.insightId) return

        const insight = getInsight(question.insightId)
        if (!insight) return

        // Gather all answered questions for this insight
        const answeredQuestions = getQuestionsByInsightId(insight.id)
          .filter(q => q.status === 'answered')
        if (answeredQuestions.length === 0) return

        const answers = answeredQuestions.map(q => ({
          question: q.question,
          answer: q.answer || '',
          answeredBy: q.answeredByName || q.answeredBy || 'unknown',
        }))

        console.log(`[InsightScheduler] Thread ready for question ${questionId}, refining insight ${insight.id} with ${answers.length} answers`)

        const refinedResult = await runRefinement({
          userId: insight.userId,
          originalContent: insight.content,
          answers,
          dbPath,
          sourcesDbPath,
        })

        if (!refinedResult.success) {
          console.error(`[InsightScheduler] Thread refinement failed:`, refinedResult.error)
          io.emit('insight:error', { userId: insight.userId, error: refinedResult.error, timestamp: Date.now() })
          return
        }

        // Determine phase
        const hasFollowUps = refinedResult.questions && refinedResult.questions.length > 0
        const currentRound = (insight.meta?.answersReceived ?? 0)
        const refinedPhase = (hasFollowUps && currentRound + 1 < maxQuestionRounds) ? 'preliminary' as const : 'refined' as const

        // Reply in the Slack thread with a summary
        if (slackBot?.bot?.isConnected() && question.channelId && question.messageTs) {
          const summary = buildRefinementSummary(refinedResult)
          await slackBot.bot.replyInThread(question.channelId, question.messageTs, summary)

          // If follow-up questions, post them in the same thread
          if (hasFollowUps && refinedPhase === 'preliminary') {
            for (const fq of refinedResult.questions!) {
              const followUpText = `*Follow-up:* ${fq.text}${fq.reason ? `\n> _${fq.reason}_` : ''}`
              await slackBot.bot.replyInThread(question.channelId, question.messageTs, followUpText)
            }
          }
        }

        updateInsight(insight.id, {
          content: refinedResult.content,
          categories: refinedResult.categories,
          followUpActions: refinedResult.followUpActions,
          meta: {
            ...refinedResult.meta,
            phase: refinedPhase,
            answersReceived: answeredQuestions.length,
          },
        })

        io.emit('insight:updated', getInsight(insight.id))
        console.log(`[InsightScheduler] Refined insight ${insight.id} via thread — phase: ${refinedPhase}`)
      } catch (err) {
        console.error('[InsightScheduler] Error handling thread:ready:', err)
      }
    })
  }

  async function runAnalysisJob() {
    if (isAnalyzing) {
      console.log('[InsightScheduler] Analysis already in progress, skipping')
      return
    }

    isAnalyzing = true
    console.log('[InsightScheduler] Starting analysis run at', new Date().toISOString())

    try {
      // Get all users that have had activity
      const users = getUsersWithActivity()
      console.log(`[InsightScheduler] Found ${users.length} users with activity`)

      for (const user of users) {
        try {
          await analyzeUser(user.userId, minEventsForAnalysis, dbPath, io, slackBot)
        } catch (error) {
          console.error(`[InsightScheduler] Error analyzing ${user.userId}:`, error)
        }
      }

      console.log('[InsightScheduler] Analysis run completed')
    } catch (error) {
      console.error('[InsightScheduler] Error during analysis run:', error)
    } finally {
      isAnalyzing = false
    }
  }

  // Create the cron job
  const job = new Cron(cronExpression, {
    name: 'insight-analysis',
    protect: true, // Prevent overlapping runs
  }, runAnalysisJob)

  console.log(`[InsightScheduler] Scheduled with cron: ${cronExpression}`)

  // Run immediately if requested
  if (runOnStart) {
    console.log('[InsightScheduler] Running initial analysis...')
    runAnalysisJob()
  }

  return {
    stop: () => {
      job.stop()
      console.log('[InsightScheduler] Stopped')
    },
    runNow: runAnalysisJob,
    isRunning: () => job.isRunning(),
  }
}

/**
 * Build a concise Slack message summarizing the refinement result.
 */
function buildRefinementSummary(result: AnalysisResult): string {
  const lines: string[] = [':white_check_mark: Thanks for the input! I\'ve updated the insight.\n']

  // Try to extract the first meaningful paragraph from the content
  const contentLines = result.content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  if (contentLines.length > 0) {
    const preview = contentLines.slice(0, 3).join('\n')
    lines.push(preview.length > 500 ? preview.slice(0, 500) + '…' : preview)
  }

  if (result.followUpActions?.length) {
    lines.push('\n*Follow-up actions:*')
    for (const a of result.followUpActions.slice(0, 3)) {
      lines.push(`  • ${a.action}`)
    }
  }

  return lines.join('\n')
}

/**
 * Analyze all recent sessions for a single user (across all repos).
 * Posts questions to Slack; refinement happens asynchronously via thread:ready events.
 */
async function analyzeUser(
  userId: string,
  minEvents: number,
  dbPath: string,
  io: SocketIOServer,
  slackBot?: { bot: SlackBot | null; restart: (config: { botToken: string; appToken: string; channel: string }) => Promise<void> },
) {
  console.log(`[InsightScheduler] Analyzing user: ${userId}`)

  // Get the last analysis state for this user (repoName = null means all repos)
  const state = getAnalysisState(userId, null)
  const sinceTimestamp = state?.lastEventTimestamp ?? 0

  // Count new events since last analysis (across all repos)
  const newEventCount = countUserEventsSince(userId, sinceTimestamp)

  if (newEventCount < minEvents) {
    console.log(`[InsightScheduler] Skipping ${userId}: only ${newEventCount} new events (need ${minEvents})`)
    return
  }

  console.log(`[InsightScheduler] Running analysis for ${userId} with ${newEventCount} new events`)

  // Run the analysis (repoName = null to analyze all repos)
  const analysisWindowStart = sinceTimestamp || Date.now() - DEFAULT_ANALYSIS_WINDOW_MS
  const analysisWindowEnd = Date.now()

  const result = await runAnalysis(userId, null, sinceTimestamp, dbPath, sourcesDbPath)

  if (!result.success) {
    console.error(`[InsightScheduler] Analysis failed for ${userId}:`, result.error)
    io.emit('insight:error', { userId, error: result.error, timestamp: Date.now() })
    if (slackBot?.bot?.isConnected()) {
      await slackBot.bot.postNotification(`⚠️ Insight analysis failed for *${userId}*:\n>${result.error}`)
    }
    return
  }

  const hasQuestions = result.questions && result.questions.length > 0
  const canAskQuestions = hasQuestions && slackBot?.bot?.isConnected()

  // Save the initial insight
  const meta: InsightMeta = {
    ...result.meta,
    phase: canAskQuestions ? 'preliminary' : (hasQuestions ? 'final-no-answers' : undefined),
    questionCount: result.questions?.length ?? 0,
    answersReceived: 0,
  }

  const insight = addInsight({
    userId,
    repoName: null,
    content: result.content,
    categories: result.categories,
    followUpActions: result.followUpActions,
    sessionsAnalyzed: result.sessionsAnalyzed,
    eventsAnalyzed: result.eventsAnalyzed,
    analysisWindowStart,
    analysisWindowEnd,
    meta,
  })

  console.log(`[InsightScheduler] Created insight ${insight.id} for ${userId}`)

  // Update analysis state
  updateAnalysisState(userId, null, analysisWindowEnd)

  // Emit real-time update via Socket.IO
  io.emit('insight:new', insight)

  // If no questions or no Slack bot, we're done
  if (!canAskQuestions || !result.questions) {
    if (hasQuestions) {
      console.log(`[InsightScheduler] AI had ${result.questions!.length} questions but Slack not connected — saving as final-no-answers`)
    }
    return
  }

  // Post questions to Slack — refinement happens asynchronously via thread:ready events
  console.log(`[InsightScheduler] Posting ${result.questions.length} questions for ${userId}`)
  for (const q of result.questions) {
    const dbQuestion = addQuestion({
      question: q.text,
      context: q.reason,
      insightId: insight.id,
      options: q.options?.map(o => ({ id: o.id, label: o.label })),
      meta: { targetUser: q.targetUser, round: 1 },
    })
    await slackBot!.bot!.postQuestion(dbQuestion.id)
  }
  console.log(`[InsightScheduler] Questions posted for ${userId} — waiting for thread replies`)
}

