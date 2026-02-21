const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL = 'voyage-3-lite'
const EMBEDDING_DIMENSION = 1024
const MAX_BATCH_SIZE = 128
const MAX_TEXT_LENGTH = 8000

export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION
}

export function isEmbeddingConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY
}

/**
 * Get embeddings for an array of texts using Voyage AI.
 * Returns empty array if VOYAGE_API_KEY is not set.
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) return []
  if (texts.length === 0) return []

  const results: number[][] = []

  // Batch in chunks of MAX_BATCH_SIZE
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE).map(t =>
      t.length > MAX_TEXT_LENGTH ? t.slice(0, MAX_TEXT_LENGTH) : t
    )

    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: batch,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Voyage API error (${res.status}): ${err}`)
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    for (const item of data.data) {
      results.push(item.embedding)
    }
  }

  return results
}

/**
 * Prepare text for embedding: "author: content"
 */
export function prepareText(content: string, author?: string | null): string {
  return author ? `${author}: ${content}` : content
}
