import { brand } from "@/config/brand";

/**
 * Branded transactional email layout.
 *
 * Matches the application UI (src/app/globals.css): Notion-ish neutrals,
 * the BackBeat blue for actions, soft card on a muted canvas. Built with
 * table layout + inline styles for broad email-client compatibility
 * (Gmail, Outlook, Apple Mail); no external images or webfonts.
 */

/** App palette (kept in sync with globals.css). */
const palette = {
  canvas: "#f1f1ef", // --muted
  card: "#ffffff", // --card
  border: "#e9e9e7", // --border
  text: "#37352f", // --foreground
  muted: "#787774", // --muted-foreground
  primary: "#2383e2", // --primary
  primaryForeground: "#ffffff",
  wash: "#e7f3f8", // --hero-wash
} as const;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Escape user-provided values before interpolating into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailCta = {
  label: string;
  url: string;
};

export type EmailTemplateInput = {
  /** Hidden inbox-preview line (plain text). */
  preheader?: string;
  /** Main heading inside the card (plain text; escaped). */
  heading: string;
  /**
   * Body paragraphs. Already-safe HTML — build user content with
   * `escapeHtml()` (helpers below escape for you).
   */
  paragraphsHtml: string[];
  /** Primary action button. */
  cta?: EmailCta;
  /** Small muted line under the button (safe HTML). */
  noteHtml?: string;
  /** Fallback link line so the CTA works even when buttons don't render. */
  showCtaUrlFallback?: boolean;
};

/** A paragraph with escaped dynamic values: p`Hi ${name},` */
export function p(
  strings: TemplateStringsArray,
  ...values: Array<string | number>
): string {
  return strings.reduce(
    (out, chunk, index) =>
      out +
      chunk +
      (index < values.length ? escapeHtml(String(values[index])) : ""),
    "",
  );
}

/** Bold + escaped (for names, page titles, workspace names). */
export function strong(value: string): string {
  return `<strong style="font-weight:600;color:${palette.text};">${escapeHtml(value)}</strong>`;
}

/** Render the full branded HTML document. */
export function renderEmail(input: EmailTemplateInput): string {
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    : "";

  const paragraphs = input.paragraphsHtml
    .map(
      (html) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:23px;color:${palette.text};">${html}</p>`,
    )
    .join("\n");

  const cta = input.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
        <tr>
          <td style="border-radius:6px;background:${palette.primary};">
            <a href="${escapeHtml(input.cta.url)}"
               style="display:inline-block;padding:10px 22px;font-family:${FONT_STACK};font-size:14px;font-weight:600;line-height:20px;color:${palette.primaryForeground};text-decoration:none;border-radius:6px;">
              ${escapeHtml(input.cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const ctaFallback =
    input.cta && input.showCtaUrlFallback !== false
      ? `<p style="margin:14px 0 0;font-size:12px;line-height:18px;color:${palette.muted};word-break:break-all;">
           If the button doesn't work, copy this link into your browser:<br/>
           <a href="${escapeHtml(input.cta.url)}" style="color:${palette.primary};text-decoration:underline;">${escapeHtml(input.cta.url)}</a>
         </p>`
      : "";

  const note = input.noteHtml
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:${palette.muted};">${input.noteHtml}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <meta name="color-scheme" content="light"/>
    <title>${escapeHtml(input.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${palette.canvas};font-family:${FONT_STACK};-webkit-text-size-adjust:100%;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${palette.canvas};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;">
            <!-- Brand header -->
            <tr>
              <td style="padding:0 4px 14px;">
                <span style="font-size:17px;font-weight:700;letter-spacing:-0.2px;color:${palette.text};">
                  <span style="display:inline-block;width:22px;height:22px;border-radius:5px;background:${palette.primary};color:${palette.primaryForeground};font-size:13px;font-weight:700;text-align:center;line-height:22px;vertical-align:-4px;">${escapeHtml(brand.name.charAt(0))}</span>
                  &nbsp;${escapeHtml(brand.name)}
                </span>
              </td>
            </tr>
            <!-- Card -->
            <tr>
              <td style="background:${palette.card};border:1px solid ${palette.border};border-radius:12px;padding:28px 28px 24px;">
                <h1 style="margin:0 0 16px;font-size:19px;line-height:26px;font-weight:700;letter-spacing:-0.2px;color:${palette.text};">
                  ${escapeHtml(input.heading)}
                </h1>
                ${paragraphs}
                ${cta}
                ${ctaFallback}
                ${note}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:16px 4px 0;">
                <p style="margin:0;font-size:12px;line-height:18px;color:${palette.muted};">
                  ${escapeHtml(brand.name)} — ${escapeHtml(brand.tagline)}<br/>
                  You're receiving this because of activity in your ${escapeHtml(brand.name)} workspace.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
