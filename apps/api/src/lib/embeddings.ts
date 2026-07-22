/**
 * Embeddings behind a small provider interface so the model/vendor is
 * swappable (CLAUDE.md requirement).
 *
 * Default provider: OpenAI text-embedding-3-small — 1536 dimensions, which
 * matches the `extensions.vector(1536)` column + HNSW cosine index in
 * supabase/migrations/0012. If you swap providers, keep the dimension at 1536
 * or the column and index must change too.
 */
import OpenAI from "openai";

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Price per 1M input tokens for the active model. text-embedding-3-small is
 * $0.02/1M — small enough that it was previously left untracked entirely, which
 * meant any caller reporting a spend figure (e.g. ca:run's costUsd) silently
 * omitted it. Cheap is not the same as free; report it.
 */
export const EMBEDDING_PRICE_PER_1M_TOKENS = 0.02;

export interface EmbeddingUsage {
  tokens: number;
  costUsd: number;
}

export interface EmbeddingProvider {
  /** Human-readable id recorded alongside stored vectors / in logs. */
  readonly id: string;
  readonly dimensions: number;
  /**
   * Embed a batch of texts, returning one vector per input (same order).
   * `onUsage` is optional so existing call sites need no change.
   */
  embed(texts: string[], onUsage?: (usage: EmbeddingUsage) => void): Promise<number[][]>;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai:text-embedding-3-small";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private client: OpenAI | null = null;

  private openai(): OpenAI {
    if (!this.client) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set (apps/api/.env)");
      }
      this.client = new OpenAI();
    }
    return this.client;
  }

  async embed(texts: string[], onUsage?: (usage: EmbeddingUsage) => void): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.openai().embeddings.create({
      model: "text-embedding-3-small",
      dimensions: EMBEDDING_DIMENSIONS,
      input: texts,
    });
    if (onUsage) {
      const tokens = res.usage?.total_tokens ?? 0;
      onUsage({ tokens, costUsd: (tokens / 1e6) * EMBEDDING_PRICE_PER_1M_TOKENS });
    }
    // Preserve input order (the API returns objects carrying their index).
    return res.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding as number[]);
  }
}

let provider: EmbeddingProvider | null = null;

/** The active embedding provider. Swap the constructor here to change vendors. */
export function embeddings(): EmbeddingProvider {
  if (!provider) provider = new OpenAIEmbeddingProvider();
  return provider;
}
