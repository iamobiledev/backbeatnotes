/**
 * Block Kit builders for document cards (pure — unit-testable).
 */

export type SlackBlock = Record<string, unknown>;

export const EXCERPT_MAX_CHARS = 200;

/** First ~200 chars of plain text, cut at a word boundary. */
export function buildExcerpt(
  plainText: string,
  maxChars = EXCERPT_MAX_CHARS,
): string {
  const collapsed = plainText.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxChars) return collapsed;
  const slice = collapsed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trimEnd()}…`;
}

/** Escape Slack mrkdwn control characters in user content. */
export function escapeSlackText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export type DocumentCardInput = {
  title: string;
  excerptSource: string;
  authorName: string;
  updatedAt: Date;
  url: string;
  workspaceName?: string;
  appName?: string;
};

/**
 * Rich Notion-style document card: title, excerpt, author, last-edited
 * time (rendered in the viewer's timezone via Slack date formatting), and
 * an "Open in app" button.
 */
export function documentCard(input: DocumentCardInput): SlackBlock[] {
  const appName = input.appName ?? "Docloom";
  const title = escapeSlackText(input.title || "Untitled");
  const excerpt = escapeSlackText(buildExcerpt(input.excerptSource));
  const epoch = Math.floor(input.updatedAt.getTime() / 1000);
  const fallbackDate = input.updatedAt.toISOString().slice(0, 10);

  const contextParts = [
    `✍️ ${escapeSlackText(input.authorName)}`,
    `Edited <!date^${epoch}^{date_short_pretty} at {time}|${fallbackDate}>`,
  ];
  if (input.workspaceName) {
    contextParts.push(`📚 ${escapeSlackText(input.workspaceName)}`);
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${input.url}|📄 ${title}>*${excerpt ? `\n${excerpt}` : ""}`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: contextParts.join("  ·  ") }],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: `Open in ${appName}` },
          url: input.url,
          action_id: "open_in_app",
        },
      ],
    },
  ];
}

/**
 * Neutral card for documents the viewer/sharer can't access (or that are
 * deleted/trashed) — never leaks title or content.
 */
export function minimalCard(opts: { url: string; appName?: string }): SlackBlock[] {
  const appName = opts.appName ?? "Docloom";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔒 A ${appName} document was shared — open it in ${appName} to view.`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: `Open in ${appName}` },
          url: opts.url,
          action_id: "open_in_app",
        },
      ],
    },
  ];
}

/** Card prompting a Slack user to link their account. */
export function linkAccountCard(opts: {
  linkUrl: string;
  appName?: string;
  message?: string;
}): SlackBlock[] {
  const appName = opts.appName ?? "Docloom";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          opts.message ??
          `To search and preview ${appName} documents in Slack, link your Slack identity to your ${appName} account first.`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: `Link my ${appName} account` },
          url: opts.linkUrl,
          action_id: "link_account",
        },
      ],
    },
  ];
}
