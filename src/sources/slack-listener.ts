import type { SourceListener, SourceListenerDeps } from './types'
import type { DataSource, SourceEntry, SlackSourceConfig } from '../types'
import { applyFieldMapping } from './remap'

/**
 * Slack channel listener — registers on existing Slack bot, no separate connection.
 */
export function createSlackSourceListener(
  source: DataSource,
  onEntry: (entry: Omit<SourceEntry, 'id' | 'ingestedAt'>) => void,
  onError: (error: Error) => void,
  deps?: SourceListenerDeps,
): SourceListener {
  const config = source.config as SlackSourceConfig

  return {
    async start() {
      if (!deps?.slackBot) {
        throw new Error('Slack bot not available — configure Slack integration first')
      }
      deps.slackBot.registerChannelListener(config.channelId, (msg: any) => {
        try {
          const channelId = msg.channel || config.channelId
          const ts = msg.ts || ''
          const externalId = `${channelId}:${ts}`

          const entry = applyFieldMapping(
            msg as Record<string, unknown>,
            'slack',
            source.fieldMapping,
            externalId,
            source.id,
          )
          onEntry(entry)
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },
    async stop() {
      if (deps?.slackBot) {
        deps.slackBot.unregisterChannelListener(config.channelId)
      }
    },
  }
}
