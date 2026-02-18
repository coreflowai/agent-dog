import { Client, GatewayIntentBits, Events } from 'discord.js'
import type { SourceListener } from './types'
import type { DataSource, SourceEntry, DiscordSourceConfig } from '../types'
import { applyFieldMapping } from './remap'

/**
 * Discord channel listener — creates a discord.js Client per source.
 */
export function createDiscordListener(
  source: DataSource,
  onEntry: (entry: Omit<SourceEntry, 'id' | 'ingestedAt'>) => void,
  onError: (error: Error) => void,
): SourceListener {
  const config = source.config as DiscordSourceConfig
  let client: Client | null = null

  return {
    async start() {
      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      })

      client.on(Events.Error, (err) => {
        onError(err instanceof Error ? err : new Error(String(err)))
      })

      client.on(Events.MessageCreate, (message) => {
        // Only listen to the configured channel
        if (message.channelId !== config.channelId) return
        // Skip bot messages
        if (message.author.bot) return

        const raw = {
          id: message.id,
          content: message.content,
          author: {
            id: message.author.id,
            username: message.author.username,
            displayName: message.author.displayName,
          },
          channelId: message.channelId,
          guildId: message.guildId,
          timestamp: message.createdAt.toISOString(),
          url: message.url,
        }

        const entry = applyFieldMapping(
          raw as Record<string, unknown>,
          'discord',
          source.fieldMapping,
          message.id, // Discord snowflake as externalId
          source.id,
        )
        // Override url with the message link
        entry.url = message.url
        onEntry(entry)
      })

      await client.login(config.botToken)
    },

    async stop() {
      if (client) {
        client.destroy()
        client = null
      }
    },
  }
}
