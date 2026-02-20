import type { SourceListener, SourceListenerDeps } from './types'
import type { DataSource, SourceEntry, SlackSourceConfig } from '../types'
import { applyFieldMapping } from './remap'

// Simple in-memory cache for Slack user ID -> display name
const userCache = new Map<string, { name: string; ts: number }>()
const USER_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

async function resolveUserName(userId: string, client: any): Promise<string | null> {
  const cached = userCache.get(userId)
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) return cached.name
  try {
    const info = await client.users.info({ user: userId })
    const name = info.user?.real_name || info.user?.name || null
    if (name) userCache.set(userId, { name, ts: Date.now() })
    return name
  } catch {
    return null
  }
}

async function resolveUserMentions(text: string, client: any): Promise<string> {
  const mentionPattern = /<@(U[A-Z0-9]+)>/g
  const matches = [...text.matchAll(mentionPattern)]
  if (matches.length === 0) return text

  let resolved = text
  for (const match of matches) {
    const userId = match[1]
    const name = await resolveUserName(userId, client)
    if (name) {
      resolved = resolved.replace(match[0], `@${name}`)
    }
  }
  return resolved
}

/**
 * Extract plain text from Slack Block Kit blocks and/or attachments.
 * Used when msg.text is empty (e.g. Datadog alerts that use blocks-only).
 */
function extractTextFromBlocks(msg: any): string {
  const parts: string[] = []

  // Walk blocks array
  if (Array.isArray(msg.blocks)) {
    for (const block of msg.blocks) {
      if (block.text?.text) parts.push(block.text.text)
      if (Array.isArray(block.fields)) {
        for (const f of block.fields) {
          if (f.text) parts.push(f.text)
        }
      }
      if (Array.isArray(block.elements)) {
        for (const el of block.elements) {
          if (el.text) parts.push(typeof el.text === 'string' ? el.text : el.text?.text || '')
        }
      }
    }
  }

  // Walk attachments array (legacy format, still used by Datadog etc.)
  if (Array.isArray(msg.attachments)) {
    for (const att of msg.attachments) {
      if (att.title) parts.push(att.title)
      if (att.text) parts.push(att.text)
      else if (att.fallback) parts.push(att.fallback)
      if (att.pretext) parts.push(att.pretext)
    }
  }

  return parts.filter(Boolean).join('\n')
}

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
      deps.slackBot.registerChannelListener(config.channelId, async (msg: any, client?: any) => {
        try {
          const channelId = msg.channel || config.channelId
          const ts = msg.ts || ''
          const externalId = `${channelId}:${ts}`

          // Resolve user name and inject into msg so field mapping finds it
          if (client && msg.user && !msg.user_profile?.real_name) {
            const name = await resolveUserName(msg.user, client)
            if (name) {
              msg = { ...msg, user_profile: { ...msg.user_profile, real_name: name } }
            }
          }

          // Resolve <@USERID> mentions in message text
          if (client && msg.text) {
            msg = { ...msg, text: await resolveUserMentions(msg.text, client) }
          }

          // Fallback: extract text from blocks/attachments when text is empty
          // (e.g. Datadog alerts that use Block Kit only)
          if (!msg.text && (msg.blocks || msg.attachments)) {
            const extracted = extractTextFromBlocks(msg)
            if (extracted) {
              msg = { ...msg, text: extracted }
            }
          }

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
