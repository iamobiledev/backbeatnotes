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
import { extractQueryHeuristic } from "./query";

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
  limit?: number;
  includeShareButtons?: boolean;
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

  const query = await extractSearchQuery(opts.rawText);
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

  const result = await getSearchService().search({
    query,
    userId: opts.linkedUserId,
    limit: opts.limit ?? 3,
  });

  if (result.hits.length === 0) {
    return {
      text: `No documents found for “${query}”.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `I couldn’t find anything for *${escapeSlackText(query)}* — try different keywords, or <${appUrl}/app|browse ${brand.name}>.`,
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
        text: `Here’s what I found for *${escapeSlackText(query)}*:`,
      },
    },
  ];

  for (const hit of result.hits) {
    const url = `${appUrl}/app/${hit.workspaceId}/docs/${hit.documentId}`;
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
