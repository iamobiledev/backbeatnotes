import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "../crypto";
import {
  computeSlackSignature,
  verifySlackSignature,
} from "../verify";
import { decideUnfurl, parseDocLinks } from "../unfurl";
import {
  buildExcerpt,
  documentCard,
  minimalCard,
  escapeSlackText,
} from "../blocks";
import {
  extractQueryHeuristic,
  parseAssistantRequestHeuristic,
  stripMentions,
} from "../query";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

/* ------------------------------- crypto ---------------------------------- */

describe("slack token crypto", () => {
  const key = Buffer.from("k".repeat(32)).toString("base64");

  it("round-trips tokens", () => {
    const token = "xoxb-secret-bot-token-1234567890";
    const encrypted = encryptToken(token, key);
    expect(encrypted).not.toContain(token);
    expect(decryptToken(encrypted, key)).toBe(token);
  });

  it("produces unique ciphertexts (random IV)", () => {
    const a = encryptToken("same", key);
    const b = encryptToken("same", key);
    expect(a).not.toBe(b);
  });

  it("rejects tampered payloads", () => {
    const encrypted = encryptToken("token", key);
    const [iv, tag, data] = encrypted.split(".");
    const tampered = [
      iv,
      tag,
      Buffer.from("tampered!!").toString("base64"),
    ].join(".");
    expect(() => decryptToken(tampered, key)).toThrow();
    void data;
  });

  it("rejects wrong key sizes", () => {
    expect(() => encryptToken("x", Buffer.from("short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});

/* ----------------------------- verification ------------------------------ */

describe("slack signature verification", () => {
  const signingSecret = "8f742231b10e8888abcd99yyyzzz85a5";
  const rawBody = "token=xyz&team_id=T1234&command=%2Fdocs&text=hello";
  const now = 1_700_000_000;
  const timestamp = String(now);

  const valid = () =>
    computeSlackSignature({ signingSecret, timestamp, rawBody });

  it("accepts a valid signature", () => {
    expect(
      verifySlackSignature({
        signingSecret,
        timestamp,
        signature: valid(),
        rawBody,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("rejects tampered bodies", () => {
    expect(
      verifySlackSignature({
        signingSecret,
        timestamp,
        signature: valid(),
        rawBody: rawBody + "&extra=1",
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects wrong secrets", () => {
    expect(
      verifySlackSignature({
        signingSecret: "different-secret",
        timestamp,
        signature: valid(),
        rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects stale timestamps (replay)", () => {
    expect(
      verifySlackSignature({
        signingSecret,
        timestamp,
        signature: valid(),
        rawBody,
        nowSeconds: now + 6 * 60, // 6 minutes later
      }),
    ).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(
      verifySlackSignature({
        signingSecret,
        timestamp: null,
        signature: valid(),
        rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret,
        timestamp,
        signature: null,
        rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});

/* ------------------------------ unfurl matrix ---------------------------- */

describe("decideUnfurl (security matrix)", () => {
  const base = {
    exists: true,
    archived: false,
    published: false,
    sharerLinked: true,
    sharerAccess: "editor" as const,
  };

  it("full card for accessible docs shared by linked users", () => {
    expect(decideUnfurl(base)).toBe("full");
    expect(decideUnfurl({ ...base, sharerAccess: "viewer" })).toBe("full");
    // Direct-share "full access" sharers also unfurl fully.
    expect(decideUnfurl({ ...base, sharerAccess: "full" })).toBe("full");
  });

  it("minimal for deleted docs", () => {
    expect(decideUnfurl({ ...base, exists: false })).toBe("minimal");
  });

  it("minimal for trashed docs — even published ones", () => {
    expect(decideUnfurl({ ...base, archived: true })).toBe("minimal");
    expect(
      decideUnfurl({ ...base, archived: true, published: true }),
    ).toBe("minimal");
  });

  it("full for published docs regardless of sharer", () => {
    expect(
      decideUnfurl({
        ...base,
        published: true,
        sharerLinked: false,
        sharerAccess: "none",
      }),
    ).toBe("full");
  });

  it("minimal when the sharer isn't linked", () => {
    expect(
      decideUnfurl({ ...base, sharerLinked: false, sharerAccess: "none" }),
    ).toBe("minimal");
  });

  it("minimal when the sharer has no access (revoked)", () => {
    expect(decideUnfurl({ ...base, sharerAccess: "none" })).toBe("minimal");
  });
});

/* ------------------------------ link parsing ------------------------------ */

describe("parseDocLinks", () => {
  const appUrl = "https://docloom.example.com";

  it("extracts doc ids and public slugs from app URLs", () => {
    const links = parseDocLinks(
      [
        `${appUrl}/app/ws1/docs/abc123`,
        `${appUrl}/p/launch-plan-xyz`,
        `${appUrl}/app/ws1/settings`,
        "https://other.com/app/ws1/docs/evil",
        "not a url",
      ],
      appUrl,
    );
    expect(links).toEqual([
      { kind: "doc", documentId: "abc123", url: `${appUrl}/app/ws1/docs/abc123` },
      { kind: "public", slug: "launch-plan-xyz", url: `${appUrl}/p/launch-plan-xyz` },
    ]);
  });
});

/* -------------------------------- blocks --------------------------------- */

describe("block builders", () => {
  it("buildExcerpt caps at ~200 chars on a word boundary", () => {
    const text = "word ".repeat(100);
    const excerpt = buildExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(201);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(buildExcerpt("short text")).toBe("short text");
    expect(buildExcerpt("  spaced\n\nout   ")).toBe("spaced out");
  });

  it("escapes mrkdwn control characters", () => {
    expect(escapeSlackText("<script> & >")).toBe("&lt;script&gt; &amp; &gt;");
  });

  it("documentCard contains title, excerpt, author, date, and button", () => {
    const blocks = documentCard({
      title: "Launch <Plan>",
      excerptSource: "The quick brown fox jumps over the lazy dog.",
      authorName: "Demo User",
      updatedAt: new Date("2026-07-01T10:00:00Z"),
      url: "https://app.example.com/app/w/docs/d",
      workspaceName: "My Workspace",
    });
    const json = JSON.stringify(blocks);
    expect(json).toContain("Launch &lt;Plan&gt;");
    expect(json).toContain("quick brown fox");
    expect(json).toContain("Demo User");
    expect(json).toContain("<!date^");
    expect(json).toContain("Open in Docloom");
    expect(json).toContain("My Workspace");
  });

  it("minimalCard never contains document content", () => {
    const json = JSON.stringify(
      minimalCard({ url: "https://app.example.com/app/w/docs/d" }),
    );
    expect(json).toContain("open it in Docloom to view");
    expect(json).not.toContain("Launch");
  });

  it("matched paragraph cards deep-link and label their excerpt", () => {
    const json = JSON.stringify(
      documentCard({
        title: "Password reset runbook",
        excerptSource: "Check the email provider suppression list.",
        authorName: "Demo User",
        updatedAt: new Date("2026-07-01T10:00:00Z"),
        url: "https://app.example.com/app/w/docs/d#block-abc_123",
        matchedParagraph: true,
      }),
    );
    expect(json).toContain("#block-abc_123");
    expect(json).toContain("Matching paragraph");
    expect(json).toContain("Open matched paragraph");
  });
});

/* ----------------------------- query heuristic ---------------------------- */

describe("extractQueryHeuristic", () => {
  it("strips mentions and filler", () => {
    expect(
      extractQueryHeuristic(
        "<@U123ABC> can you find the onboarding checklist doc?",
      ),
    ).toBe("onboarding checklist");
    expect(
      extractQueryHeuristic("<@U123ABC> search for Q3 launch plan please"),
    ).toBe("Q3 launch plan");
  });

  it("keeps meaningful words when everything else is filler", () => {
    expect(extractQueryHeuristic("<@U1> find docs")).not.toBe("");
  });

  it("strips mention tokens", () => {
    expect(stripMentions("<@U42|docloom> hello").trim()).toBe("hello");
  });

  it("preserves the full reference text for similarity requests", () => {
    expect(
      parseAssistantRequestHeuristic(
        "<@U42> find documents like this: customers can sign in but password reset emails never arrive",
      ),
    ).toEqual({
      intent: "similar",
      query:
        "customers can sign in but password reset emails never arrive",
    });
    expect(
      parseAssistantRequestHeuristic(
        "<@U42> show me pages related to recurring billing failures",
      ),
    ).toEqual({
      intent: "similar",
      query: "recurring billing failures",
    });
  });

  it("keeps ordinary requests in keyword mode", () => {
    expect(
      parseAssistantRequestHeuristic(
        "<@U42> can you find the onboarding checklist doc?",
      ),
    ).toEqual({ intent: "keyword", query: "onboarding checklist" });
  });
});

/* -------------------------------- rate limit ------------------------------ */

describe("rateLimit", () => {
  it("enforces fixed windows and resets", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(
        rateLimit({ key: "t", limit: 3, windowMs: 1000, now }).allowed,
      ).toBe(true);
    }
    const blocked = rateLimit({ key: "t", limit: 3, windowMs: 1000, now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(
      rateLimit({ key: "t", limit: 3, windowMs: 1000, now: now + 1001 })
        .allowed,
    ).toBe(true);
    expect(
      rateLimit({ key: "other", limit: 3, windowMs: 1000, now }).allowed,
    ).toBe(true);
  });
});
