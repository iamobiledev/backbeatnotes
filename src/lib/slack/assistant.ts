import "server-only";
import { getServerEnv, getAppUrl } from "@/env/server";
import { getSearchService } from "@/lib/search";
import { brand } from "@/config/brand";
import { logger } from "@/lib/logger";
import {
  documentCard,
  linkAccountCard,
  escapeSlackText,
  type SlackBlock,
} from "./blocks";
import {
  extractQueryHeuristic,
  parseAssistantRequestHeuristic,
} from "./query";
import { createOpenAIQueryEmbedding } from "@/lib/ai/openai-embeddings";
import { blockUrlFragment } from "@/lib/documents/blocks";
import { attachLexicalBlockMatches } from "@/lib/search/document-blocks";

/**
 * The `@docloom` mention assistant: interprets a natural-language request
 * ("@docloom can you find the onboarding doc?"), extracts a search query —
 * with Claude/OpenAI when an API key is configured, falling back to a solid
 * heuristic — and returns permission-filtered document cards.
 */

const LLM_TIMEOUT_MS = 6000;

export async function extractSearchQuery(text: string): Promise<string> {
  const heuristic = extractQueryHeuristic(text);
  const env = getServerEnv();

  const prompt =
    "Extract the document search keywords from this Slack message asking to find a document. " +
    "Reply with ONLY the search keywords (2-6 words), nothing else.\n\n" +
    `Message: ${text}`;

  try {
    if (env.ANTHROPIC_API_KEY) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 50,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const answer = data.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join(" ")
          .trim();
        if (answer) return sanitizeLlmQuery(answer) || heuristic;
      }
    } else if (env.OPENAI_API_KEY) {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 50,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (answer) return sanitizeLlmQuery(answer) || heuristic;
      }
    }
  } catch (error) {
    logger.warn("slack.assistant_llm_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return heuristic;
}

function sanitizeLlmQuery(raw: string): string {
  return raw
    .split("\n")[0]
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    .slice(0, 100)
    .trim();
}

export type AssistantReply = {
  text: string;
  blocks: SlackBlock[];
};

/**
 * Build the reply for an @docloom mention (or `/docs` command).
 * `linkedUserId` must already be resolved from the Slack identity —
 * results are permission-filtered to that user.
 */
export async function buildSearchReply(opts: {
  rawText: string;
  linkedUserId: string | null;
  slackTeamId: string;
  workspaceIds: string[];
  limit?: number;
  includeShareButtons?: boolean;
  mode?: "auto" | "keyword";
}): Promise<AssistantReply> {
  const appUrl = getAppUrl();

  if (!opts.linkedUserId) {
    return {
      text: `Link your ${brand.name} account to search documents from Slack.`,
      blocks: linkAccountCard({
        linkUrl: `${appUrl}/api/slack/link?team=${encodeURIComponent(opts.slackTeamId)}`,
        appName: brand.name,
      }),
    };
  }

  if (opts.workspaceIds.length === 0) {
    return {
      text: `${brand.name} is not connected to this Slack workspace.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${brand.name} is not connected to this Slack workspace. Ask a workspace admin to connect it first.`,
          },
        },
      ],
    };
  }

  const parsed =
    opts.mode === "keyword"
      ? { intent: "keyword" as const, query: opts.rawText.trim() }
      : parseAssistantRequestHeuristic(opts.rawText);
  const query =
    parsed.intent === "keyword"
      ? await extractSearchQuery(parsed.query)
      : parsed.query;
  if (!query) {
    return {
      text: `Tell me what to look for, e.g. "@${brand.name.toLowerCase()} find the onboarding doc".`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Tell me what to look for — e.g. _"@${brand.name.toLowerCase()} find the onboarding doc"_ or \`/docs onboarding\`.`,
          },
        },
      ],
    };
  }

  let semantic = false;
  let result = null;
  if (parsed.intent === "similar") {
    const embedding = await createOpenAIQueryEmbedding(query);
    if (embedding) {
      result = await getSearchService().semanticSearch({
        query,
        embedding,
        userId: opts.linkedUserId,
        workspaceIds: opts.workspaceIds,
        limit: opts.limit ?? 3,
      });
      semantic = result.hits.length > 0;
    }
  }

  // No OpenAI key, provider failure, or no indexed paragraph: preserve the
  // existing useful keyword behavior without broadening workspace scope.
  if (!result || result.hits.length === 0) {
    const fallbackQuery =
      parsed.intent === "similar" ? await extractSearchQuery(query) : query;
    const lexicalResult = await getSearchService().search({
      query: fallbackQuery,
      userId: opts.linkedUserId,
      workspaceIds: opts.workspaceIds,
      limit: opts.limit ?? 3,
    });
    result = {
      ...lexicalResult,
      hits: await attachLexicalBlockMatches(
        lexicalResult.hits,
        fallbackQuery,
      ),
    };
  }

  if (result.hits.length === 0) {
    const displayQuery =
      query.length > 120 ? `${query.slice(0, 117).trimEnd()}…` : query;
    return {
      text: `No documents found for “${displayQuery}”.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `I couldn’t find anything for *${escapeSlackText(displayQuery)}* — try different wording, or <${appUrl}/app|browse ${brand.name}>.`,
          },
        },
      ],
    };
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: semantic
          ? `Here are the closest paragraph matches for *${escapeSlackText(
              query.length > 120 ? `${query.slice(0, 117).trimEnd()}…` : query,
            )}*:`
          : `Here’s what I found for *${escapeSlackText(query)}*:`,
      },
    },
  ];

  for (const hit of result.hits) {
    const url = `${appUrl}/app/${hit.workspaceId}/docs/${hit.documentId}${
      hit.matchedBlock ? blockUrlFragment(hit.matchedBlock.blockId) : ""
    }`;
    blocks.push({ type: "divider" });
    blocks.push(
      ...documentCard({
        title: hit.title,
        excerptSource: hit.snippet.replaceAll("⟪", "").replaceAll("⟫", ""),
        authorName: hit.creatorName ?? "Unknown",
        updatedAt: new Date(hit.updatedAt),
        url,
        workspaceName: hit.workspaceName,
        appName: brand.name,
        matchedParagraph: Boolean(hit.matchedBlock),
      }),
    );
    if (opts.includeShareButtons) {
      // Augment the card's action row with a share-to-channel button.
      const actions = blocks[blocks.length - 1] as {
        type: string;
        elements: Array<Record<string, unknown>>;
      };
      if (actions.type === "actions") {
        actions.elements.push({
          type: "button",
          text: { type: "plain_text", text: "Share to channel" },
          action_id: "share_doc_to_channel",
          value: hit.documentId,
        });
      }
    }
  }

  return {
    text: `Top results for “${query}”: ${result.hits
      .map((hit) => hit.title)
      .join(", ")}`,
    blocks,
  };
}
