import type { Server as SocketIOServer } from 'socket.io'
import type { DataSource, SourceEntry, CreateDataSourceInput, UpdateDataSourceInput } from '../types'
import type { SourceListener, SourceListenerDeps } from './types'
import {
  addDataSource,
  getDataSource,
  listDataSources,
  updateDataSource,
  toggleDataSource,
  deleteDataSource,
  updateDataSourceSync,
  addSourceEntry,
  getEntryCount,
} from '../db/sources'
import { createRssListener } from './rss-listener'

export type SourceManager = {
  start(): Promise<void>
  stop(): Promise<void>
  addSource(input: CreateDataSourceInput): Promise<DataSource>
  updateSource(id: string, input: UpdateDataSourceInput): Promise<DataSource | null>
  removeSource(id: string): Promise<void>
  toggleSource(id: string, enabled: boolean): Promise<DataSource | null>
  syncNow(id: string): Promise<{ added: number }>
  getSources(): DataSource[]
  getSource(id: string): DataSource | null
}

export type SourceManagerOptions = {
  io: SocketIOServer
  deps?: SourceListenerDeps
}

export function createSourceManager(options: SourceManagerOptions): SourceManager {
  const { io, deps } = options
  const listeners = new Map<string, SourceListener>()

  function createListener(source: DataSource): SourceListener | null {
    const onEntry = (entry: Omit<SourceEntry, 'id' | 'ingestedAt'>) => {
      const inserted = addSourceEntry(entry)
      if (inserted) {
        io.emit('source:entry', { dataSourceId: source.id, entry: inserted })
        updateDataSourceSync(source.id, Date.now(), null)
      }
    }

    const onError = (error: Error) => {
      console.error(`[SourceManager] Error in source "${source.name}":`, error.message)
      updateDataSourceSync(source.id, Date.now(), error.message)
      io.emit('source:error', { dataSourceId: source.id, error: error.message })
    }

    switch (source.type) {
      case 'rss':
        return createRssListener(source, onEntry, onError)
      case 'slack': {
        // Lazy import to avoid circular deps
        try {
          const { createSlackSourceListener } = require('./slack-listener')
          return createSlackSourceListener(source, onEntry, onError, deps)
        } catch {
          return null
        }
      }
      case 'discord': {
        try {
          const { createDiscordListener } = require('./discord-listener')
          return createDiscordListener(source, onEntry, onError)
        } catch {
          return null
        }
      }
      default:
        return null
    }
  }

  async function startListener(source: DataSource) {
    if (listeners.has(source.id)) {
      await listeners.get(source.id)!.stop()
    }
    const listener = createListener(source)
    if (!listener) return
    try {
      await listener.start()
      listeners.set(source.id, listener)
      io.emit('source:status', { dataSourceId: source.id, status: 'connected' })
    } catch (err) {
      console.error(`[SourceManager] Failed to start listener for "${source.name}":`, err)
      io.emit('source:status', { dataSourceId: source.id, status: 'error', error: String(err) })
    }
  }

  async function stopListener(id: string) {
    const listener = listeners.get(id)
    if (listener) {
      await listener.stop()
      listeners.delete(id)
      io.emit('source:status', { dataSourceId: id, status: 'disconnected' })
    }
  }

  return {
    async start() {
      const sources = listDataSources()
      for (const source of sources) {
        if (source.enabled) {
          await startListener(source)
        }
      }
    },

    async stop() {
      for (const [id] of listeners) {
        await stopListener(id)
      }
    },

    async addSource(input) {
      const source = addDataSource(input)
      io.emit('source:new', source)
      if (source.enabled) {
        await startListener(source)
      }
      return source
    },

    async updateSource(id, input) {
      const source = updateDataSource(id, input)
      if (!source) return null
      io.emit('source:updated', source)
      // Restart listener if config changed and source is enabled
      if (source.enabled && listeners.has(id)) {
        await stopListener(id)
        await startListener(source)
      }
      return source
    },

    async removeSource(id) {
      await stopListener(id)
      deleteDataSource(id)
      io.emit('source:deleted', id)
    },

    async toggleSource(id, enabled) {
      const source = toggleDataSource(id, enabled)
      if (!source) return null
      io.emit('source:updated', source)
      if (enabled) {
        await startListener(source)
      } else {
        await stopListener(id)
      }
      return source
    },

    async syncNow(id) {
      const listener = listeners.get(id)
      if (listener?.syncNow) {
        return await listener.syncNow()
      }
      // If not running, create a temporary listener for sync
      const source = getDataSource(id)
      if (!source) return { added: 0 }
      const tempListener = createListener(source)
      if (tempListener?.syncNow) {
        return await tempListener.syncNow()
      }
      return { added: 0 }
    },

    getSources() {
      return listDataSources().map(s => ({
        ...s,
        _entryCount: getEntryCount(s.id),
      })) as DataSource[]
    },

    getSource(id) {
      return getDataSource(id)
    },
  }
}
