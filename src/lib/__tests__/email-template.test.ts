import { describe, expect, it } from "vitest";
import { escapeHtml, p, strong, renderEmail } from "@/lib/email/template";
import { brand } from "@/config/brand";

describe("email template", () => {
  it("escapeHtml neutralizes markup", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quotes'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;",
    );
  });

  it("p`` escapes interpolated values but not literals", () => {
    const name = `<img src=x onerror=alert(1)>`;
    expect(p`Hi ${name},`).toBe(
      "Hi &lt;img src=x onerror=alert(1)&gt;,",
    );
  });

  it("strong() wraps escaped content", () => {
    const out = strong("<b>Page</b>");
    expect(out).toContain("&lt;b&gt;Page&lt;/b&gt;");
    expect(out).toMatch(/^<strong /);
  });

  it("renderEmail produces a branded, self-contained document", () => {
    const html = renderEmail({
      preheader: "Preview line",
      heading: "Join My Workspace",
      paragraphsHtml: [p`Hello there.`],
      cta: { label: "Accept invitation", url: "https://app.example.com/i/t0k3n" },
      noteHtml: p`Expires in 7 days.`,
    });
    // Brand header + footer tagline (footer text is HTML-escaped).
    expect(html).toContain(brand.name);
    expect(html).toContain(escapeHtml(brand.tagline));
    // Heading, body, CTA + URL fallback.
    expect(html).toContain("Join My Workspace");
    expect(html).toContain("Hello there.");
    expect(html).toContain("Accept invitation");
    expect(html.match(/https:\/\/app\.example\.com\/i\/t0k3n/g)!.length)
      .toBeGreaterThanOrEqual(2);
    // App palette (primary button + foreground text).
    expect(html).toContain("#2383e2");
    expect(html).toContain("#37352f");
    // Email-client-safe construction: inline styles, no external assets.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).toContain('role="presentation"');
  });

  it("renderEmail escapes hostile dynamic content everywhere", () => {
    const hostile = `<script>alert("pwn")</script>`;
    const html = renderEmail({
      preheader: hostile,
      heading: hostile,
      paragraphsHtml: [p`${hostile}`],
      cta: { label: hostile, url: `https://x.test/"><script>` },
    });
    expect(html).not.toContain("<script>");
  });
});
