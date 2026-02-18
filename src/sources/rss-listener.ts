import type { SourceListener } from './types'
import type { DataSource, SourceEntry, RssSourceConfig } from '../types'
import { applyFieldMapping } from './remap'

/**
 * RSS feed listener — polls at configured interval, deduplicates via guid/link.
 */
export function createRssListener(
  source: DataSource,
  onEntry: (entry: Omit<SourceEntry, 'id' | 'ingestedAt'>) => void,
  onError: (error: Error) => void,
): SourceListener {
  const config = source.config as RssSourceConfig
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll() {
    try {
      const Parser = (await import('rss-parser')).default
      const parser = new Parser()
      const feed = await parser.parseURL(config.feedUrl)
      let added = 0
      for (const item of feed.items ?? []) {
        const externalId = item.guid || item.link || item.title || ''
        if (!externalId) continue
        const entry = applyFieldMapping(
          item as Record<string, unknown>,
          'rss',
          source.fieldMapping,
          externalId,
          source.id,
        )
        onEntry(entry)
        added++
      }
      return { added }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      onError(error)
      return { added: 0 }
    }
  }

  return {
    async start() {
      await poll()
      const intervalMs = (config.pollIntervalMinutes || 15) * 60 * 1000
      timer = setInterval(poll, intervalMs)
    },
    async stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    syncNow: poll,
  }
}
