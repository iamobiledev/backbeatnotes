import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from "../embedding-config";

async function loadClient() {
  vi.resetModules();
  return import("../openai-embeddings");
}

describe("OpenAI embeddings client", () => {
  beforeEach(() => {
    process.env.SKIP_ENV_VALIDATION = "1";
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("requests and validates ordered 512-dimensional embeddings", async () => {
    const second = Array(EMBEDDING_DIMENSIONS).fill(0.2);
    const first = Array(EMBEDDING_DIMENSIONS).fill(0.1);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: second },
            { index: 0, embedding: first },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createOpenAIEmbeddings } = await loadClient();
    await expect(createOpenAIEmbeddings(["first", "second"])).resolves.toEqual([
      first,
      second,
    ]);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: EMBEDDING_MODEL,
      input: ["first", "second"],
      encoding_format: "float",
      dimensions: EMBEDDING_DIMENSIONS,
    });
    expect((request.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-openai-key",
    );
  });

  it("does not call OpenAI without a configured key", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { createOpenAIEmbeddings } = await loadClient();
    await expect(createOpenAIEmbeddings(["text"])).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects provider errors and malformed vectors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { createOpenAIEmbeddings } = await loadClient();

    await expect(createOpenAIEmbeddings(["text"])).resolves.toBeNull();
    await expect(createOpenAIEmbeddings(["text"])).resolves.toBeNull();
  });

  it("normalizes and bounds query text", async () => {
    const { normalizeEmbeddingQuery } = await loadClient();
    const normalized = normalizeEmbeddingQuery(
      `  password\n reset   emails ${"x".repeat(20_000)}`,
    );
    expect(normalized.startsWith("password reset emails ")).toBe(true);
    expect(normalized.length).toBe(12_000);
  });
});
