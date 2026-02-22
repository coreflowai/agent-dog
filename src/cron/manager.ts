import { Cron } from 'croner'
import type { Server as SocketIOServer } from 'socket.io'
import { listCronJobs, getCronJob, updateCronJobRun } from '../db/cron'
import { executeCronJob } from './executor'
import type { CronJob } from '../types'
import type { SlackBot } from '../slack'

export type CronManagerOptions = {
  io: SocketIOServer
  dbPath: string
  sourcesDbPath?: string
  slackBot?: { bot: SlackBot | null }
}

export type CronManager = {
  start: () => void
  stop: () => void
  scheduleJob: (id: string) => void
  unscheduleJob: (id: string) => void
  rescheduleJob: (id: string) => void
  triggerJob: (id: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
}

export function createCronManager(opts: CronManagerOptions): CronManager {
  const { io, dbPath, sourcesDbPath, slackBot } = opts
  const cronInstances = new Map<string, Cron>()
  const running = new Set<string>()

  function computeNextRun(cronExpression: string, timezone: string): number | null {
    try {
      const c = new Cron(cronExpression, { timezone })
      const next = c.nextRun()
      c.stop()
      return next ? next.getTime() : null
    } catch {
      return null
    }
  }

  function scheduleJob(id: string) {
    const job = getCronJob(id)
    if (!job || !job.enabled) return

    // Unschedule existing if any
    unscheduleJob(id)

    try {
      const cron = new Cron(job.cronExpression, {
        name: `cron-job-${id}`,
        timezone: job.timezone,
        protect: true,
      }, async () => {
        if (running.has(id)) {
          console.log(`[CronManager] Job "${job.name}" already running, skipping`)
          return
        }

        running.add(id)
        console.log(`[CronManager] Executing job "${job.name}" (${id})`)

        try {
          const currentJob = getCronJob(id)
          if (!currentJob || !currentJob.enabled) return

          await executeCronJob(currentJob, { io, dbPath, sourcesDbPath, slackBot })

          // Update next run time
          const nextRunAt = computeNextRun(currentJob.cronExpression, currentJob.timezone)
          if (nextRunAt) updateCronJobRun(id, { nextRunAt })
        } catch (err) {
          console.error(`[CronManager] Error executing job "${job.name}":`, err)
        } finally {
          running.delete(id)
        }
      })

      cronInstances.set(id, cron)

      // Set next run time in DB
      const nextRunAt = computeNextRun(job.cronExpression, job.timezone)
      if (nextRunAt) updateCronJobRun(id, { nextRunAt })

      console.log(`[CronManager] Scheduled "${job.name}" (${job.cronExpression}, ${job.timezone})`)
    } catch (err) {
      console.error(`[CronManager] Failed to schedule "${job.name}":`, err)
    }
  }

  function unscheduleJob(id: string) {
    const existing = cronInstances.get(id)
    if (existing) {
      existing.stop()
      cronInstances.delete(id)
    }
  }

  function rescheduleJob(id: string) {
    unscheduleJob(id)
    scheduleJob(id)
  }

  async function triggerJob(id: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    const job = getCronJob(id)
    if (!job) return { success: false, error: 'Job not found' }

    if (running.has(id)) {
      return { success: false, error: 'Job is already running' }
    }

    running.add(id)
    try {
      const result = await executeCronJob(job, { io, dbPath, sourcesDbPath, slackBot })

      // Update next run time if scheduled
      const nextRunAt = computeNextRun(job.cronExpression, job.timezone)
      if (nextRunAt) updateCronJobRun(id, { nextRunAt })

      return result
    } finally {
      running.delete(id)
    }
  }

  function start() {
    const jobs = listCronJobs()
    const enabledJobs = jobs.filter(j => j.enabled)
    console.log(`[CronManager] Starting with ${enabledJobs.length} enabled jobs (${jobs.length} total)`)

    for (const job of enabledJobs) {
      scheduleJob(job.id)
    }
  }

  function stop() {
    for (const [id, cron] of cronInstances) {
      cron.stop()
    }
    cronInstances.clear()
    console.log('[CronManager] Stopped all jobs')
  }

  return { start, stop, scheduleJob, unscheduleJob, rescheduleJob, triggerJob }
}
