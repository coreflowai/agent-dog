import { Client, GatewayIntentBits, Events } from 'discord.js'
import type { SourceListener } from './types'
import type { DataSource, SourceEntry, DiscordSourceConfig } from '../types'
import { applyFieldMapping } from './remap'
import { getIntegrationConfig } from '../db/slack'

/**
 * Discord channel listener — creates a discord.js Client per source.
 * Reads bot token from global Discord integration config, with fallback
 * to inline botToken for backwards compatibility.
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
      // Resolve bot token: global integration config first, then inline fallback
      const discordIntegration = getIntegrationConfig('discord')
      const botToken = (discordIntegration?.config as any)?.botToken ?? (config as any).botToken
      if (!botToken) {
        throw new Error('Discord bot token not configured. Set it in the Discord integration panel.')
      }

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

      await client.login(botToken)
    },

    async stop() {
      if (client) {
        client.destroy()
        client = null
      }
    },
  }
}
