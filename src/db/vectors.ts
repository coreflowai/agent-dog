import { getEmbeddings, getEmbeddingDimension, isEmbeddingConfigured, prepareText } from './embeddings'

export type SearchResult = {
  id: string
  content: string
  author: string | null
  dataSourceId: string
  timestamp: number
  score: number
}

// Dynamic zvec module — loaded lazily to avoid crashing if native bindings aren't available
let zvec: typeof import('@zvec/zvec') | null = null
let _collection: any = null
let _available = false

const COLLECTION_NAME = 'source_entries'

async function loadZvec() {
  if (zvec) return zvec
  try {
    zvec = await import('@zvec/zvec')
    return zvec
  } catch (err) {
    console.warn('[VectorStore] zvec native module not available:', err)
    return null
  }
}

function buildSchema(z: typeof import('@zvec/zvec')) {
  return new z.ZVecCollectionSchema({
    name: COLLECTION_NAME,
    vectors: {
      name: 'embedding',
      dataType: z.ZVecDataType.VECTOR_FP32,
      dimension: getEmbeddingDimension(),
      indexParams: {
        indexType: z.ZVecIndexType.HNSW,
        metricType: z.ZVecMetricType.COSINE,
      },
    },
    fields: [
      { name: 'content', dataType: z.ZVecDataType.STRING },
      { name: 'author', dataType: z.ZVecDataType.STRING, nullable: true },
      { name: 'data_source_id', dataType: z.ZVecDataType.STRING },
      { name: 'timestamp', dataType: z.ZVecDataType.INT64 },
    ],
  })
}

/**
 * Initialize the vector store. Creates or opens the collection.
 * Returns false if zvec is not available (e.g. native bindings missing).
 */
export async function initVectorStore(dataPath: string): Promise<boolean> {
  if (_collection) return true

  const z = await loadZvec()
  if (!z) return false

  try {
    _collection = z.ZVecOpen(dataPath)
    _available = true
    console.log(`[VectorStore] Opened existing collection at ${dataPath}`)
    return true
  } catch (err) {
    // Collection doesn't exist yet — create it
    if (z.isZVecError(err) && (err.code === 'ZVEC_NOT_FOUND' || err.code === 'ZVEC_INVALID_ARGUMENT')) {
      _collection = z.ZVecCreateAndOpen(dataPath, buildSchema(z))
      _available = true
      console.log(`[VectorStore] Created new collection at ${dataPath}`)
      return true
    }
    throw err
  }
}

/**
 * Close the vector store and release resources.
 */
export function closeVectorStore(): void {
  if (_collection) {
    try {
      _collection.closeSync()
    } catch {}
    _collection = null
    _available = false
  }
}

/**
 * Embed a source entry and store it in the vector store.
 * No-op if embeddings are not configured or vector store not initialized.
 */
export async function embedAndStore(entry: {
  id: string
  content: string
  author?: string | null
  dataSourceId: string
  timestamp: number
}): Promise<void> {
  if (!_collection || !isEmbeddingConfigured()) return

  const text = prepareText(entry.content, entry.author)
  const embeddings = await getEmbeddings([text])
  if (embeddings.length === 0) return

  _collection.upsertSync({
    id: entry.id,
    vectors: { embedding: embeddings[0] },
    fields: {
      content: entry.content,
      author: entry.author ?? '',
      data_source_id: entry.dataSourceId,
      timestamp: entry.timestamp,
    },
  })
}

/**
 * Embed multiple entries and store them in batch.
 * Used by the backfill script.
 */
export async function embedAndStoreBatch(entries: Array<{
  id: string
  content: string
  author?: string | null
  dataSourceId: string
  timestamp: number
}>): Promise<number> {
  if (!_collection || !isEmbeddingConfigured() || entries.length === 0) return 0

  const texts = entries.map(e => prepareText(e.content, e.author))
  const embeddings = await getEmbeddings(texts)
  if (embeddings.length === 0) return 0

  const docs = entries.map((entry, i) => ({
    id: entry.id,
    vectors: { embedding: embeddings[i] },
    fields: {
      content: entry.content,
      author: entry.author ?? '',
      data_source_id: entry.dataSourceId,
      timestamp: entry.timestamp,
    },
  }))

  _collection.upsertSync(docs)
  return docs.length
}

/**
 * Search for semantically similar entries.
 * Returns empty array if not configured.
 */
export async function semanticSearch(
  query: string,
  opts?: { topk?: number; dataSourceId?: string }
): Promise<SearchResult[]> {
  if (!_collection || !isEmbeddingConfigured()) return []

  const topk = Math.min(opts?.topk ?? 10, 50)
  const embeddings = await getEmbeddings([query])
  if (embeddings.length === 0) return []

  const results = _collection.querySync({
    fieldName: 'embedding',
    vector: embeddings[0],
    topk,
    filter: opts?.dataSourceId ? `data_source_id == "${opts.dataSourceId}"` : undefined,
    outputFields: ['content', 'author', 'data_source_id', 'timestamp'],
  })

  return results.map((doc: any) => ({
    id: doc.id,
    content: doc.fields.content ?? '',
    author: doc.fields.author || null,
    dataSourceId: doc.fields.data_source_id ?? '',
    timestamp: doc.fields.timestamp ?? 0,
    score: doc.score,
  }))
}

/**
 * Delete all vectors for a given data source.
 */
export function deleteFromVectorStore(dataSourceId: string): void {
  if (!_collection) return
  try {
    _collection.deleteByFilterSync(`data_source_id == "${dataSourceId}"`)
  } catch (err) {
    console.error('[VectorStore] Delete error:', err)
  }
}
