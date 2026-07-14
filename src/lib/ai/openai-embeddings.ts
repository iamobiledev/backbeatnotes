import "server-only";
import { getServerEnv } from "@/env/server";
import { logger } from "@/lib/logger";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_QUERY_MAX_CHARS,
} from "./embedding-config";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_TIMEOUT_MS = 8_000;

type OpenAIEmbeddingResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};

export function normalizeEmbeddingQuery(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EMBEDDING_QUERY_MAX_CHARS);
}

function isEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_DIMENSIONS &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

export function isOpenAIEmbeddingsConfigured(): boolean {
  return Boolean(getServerEnv().OPENAI_API_KEY);
}

/**
 * Generate normalized semantic vectors. Failures are intentionally represented
 * by `null`: search can fall back to lexical behavior, and document saves must
 * never depend on an external AI provider.
 */
export async function createOpenAIEmbeddings(
  inputs: string[],
): Promise<number[][] | null> {
  if (inputs.length === 0) return [];
  const apiKey = getServerEnv().OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
        encoding_format: "float",
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn("openai.embeddings_failed", {
        status: response.status,
        inputCount: inputs.length,
      });
      return null;
    }

    const payload = (await response.json()) as OpenAIEmbeddingResponse;
    if (!Array.isArray(payload.data) || payload.data.length !== inputs.length) {
      logger.warn("openai.embeddings_malformed", {
        reason: "unexpected_count",
        inputCount: inputs.length,
      });
      return null;
    }

    const sorted = [...payload.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const vectors = sorted.map((item) => item.embedding);
    if (!vectors.every(isEmbedding)) {
      logger.warn("openai.embeddings_malformed", {
        reason: "invalid_vector",
        inputCount: inputs.length,
      });
      return null;
    }
    return vectors;
  } catch (error) {
    logger.warn("openai.embeddings_request_failed", {
      error: error instanceof Error ? error.message : String(error),
      inputCount: inputs.length,
    });
    return null;
  }
}

export async function createOpenAIQueryEmbedding(
  query: string,
): Promise<number[] | null> {
  const normalized = normalizeEmbeddingQuery(query);
  if (!normalized) return null;
  const result = await createOpenAIEmbeddings([normalized]);
  return result?.[0] ?? null;
}
