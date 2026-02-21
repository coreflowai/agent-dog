import {
  ZVecCreateAndOpen,
  ZVecOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecMetricType,
  ZVecIndexType,
  isZVecError,
  type ZVecCollection,
} from '@zvec/zvec'
import { getEmbeddings, getEmbeddingDimension, isEmbeddingConfigured, prepareText } from './embeddings'

export type SearchResult = {
  id: string
  content: string
  author: string | null
  dataSourceId: string
  timestamp: number
  score: number
}

let _collection: ZVecCollection | null = null

const COLLECTION_NAME = 'source_entries'

function buildSchema() {
  return new ZVecCollectionSchema({
    name: COLLECTION_NAME,
    vectors: {
      name: 'embedding',
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: getEmbeddingDimension(),
      indexParams: {
        indexType: ZVecIndexType.HNSW,
        metricType: ZVecMetricType.COSINE,
      },
    },
    fields: [
      { name: 'content', dataType: ZVecDataType.STRING },
      { name: 'author', dataType: ZVecDataType.STRING, nullable: true },
      { name: 'data_source_id', dataType: ZVecDataType.STRING },
      { name: 'timestamp', dataType: ZVecDataType.INT64 },
    ],
  })
}

/**
 * Initialize the vector store. Creates or opens the collection.
 */
export function initVectorStore(dataPath: string): void {
  if (_collection) return

  try {
    _collection = ZVecOpen(dataPath)
    console.log(`[VectorStore] Opened existing collection at ${dataPath}`)
  } catch (err) {
    // Collection doesn't exist yet — create it
    if (isZVecError(err) && (err.code === 'ZVEC_NOT_FOUND' || err.code === 'ZVEC_INVALID_ARGUMENT')) {
      _collection = ZVecCreateAndOpen(dataPath, buildSchema())
      console.log(`[VectorStore] Created new collection at ${dataPath}`)
    } else {
      throw err
    }
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

  return results.map(doc => ({
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
