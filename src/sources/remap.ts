import type { FieldMapping, SourceEntry, DataSourceType } from '../types'
import { DEFAULT_FIELD_MAPPINGS } from './types'

/**
 * Resolve a dot-path on an object: "author.username" -> obj.author.username
 */
export function resolvePath(obj: any, path: string): unknown {
  if (!obj || !path) return undefined
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return undefined
    current = current[part]
  }
  return current
}

/**
 * Apply field mapping to a raw source message, producing a normalized entry.
 */
export function applyFieldMapping(
  raw: Record<string, unknown>,
  sourceType: DataSourceType,
  customMapping?: FieldMapping | null,
  externalId?: string,
  dataSourceId?: string,
): Omit<SourceEntry, 'id' | 'ingestedAt'> {
  const defaults = DEFAULT_FIELD_MAPPINGS[sourceType] ?? {}
  const mapping: FieldMapping = { ...defaults, ...customMapping }

  const author = mapping.author ? String(resolvePath(raw, mapping.author) ?? '') || null : null
  const content = mapping.content ? String(resolvePath(raw, mapping.content) ?? '') || null : null
  const url = mapping.url ? String(resolvePath(raw, mapping.url) ?? '') || null : null

  let timestamp: number
  const rawTs = mapping.timestamp ? resolvePath(raw, mapping.timestamp) : undefined
  if (typeof rawTs === 'number') {
    // Slack timestamps are like "1234567890.123456" (seconds), detect and convert
    timestamp = rawTs < 1e12 ? rawTs * 1000 : rawTs
  } else if (typeof rawTs === 'string') {
    // Try ISO date string or Slack ts format
    const parsed = Date.parse(rawTs)
    if (!isNaN(parsed)) {
      timestamp = parsed
    } else {
      // Slack ts: "1234567890.123456"
      const num = parseFloat(rawTs)
      timestamp = !isNaN(num) ? Math.floor(num * 1000) : Date.now()
    }
  } else {
    timestamp = Date.now()
  }

  return {
    dataSourceId: dataSourceId ?? '',
    externalId: externalId ?? '',
    author,
    content,
    url,
    timestamp,
    meta: raw,
  }
}
