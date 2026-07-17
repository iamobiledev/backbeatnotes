import { describe, expect, it } from "vitest";
import {
  assertGoogleEmailMatchesHostedDomain,
  emailMatchesHostedDomain,
  hdClaimMatchesHostedDomain,
} from "@/lib/auth/google-hosted-domain";

describe("emailMatchesHostedDomain", () => {
  it("matches the exact domain case-insensitively", () => {
    expect(emailMatchesHostedDomain("alice@rowsone.com", "rowsone.com")).toBe(
      true,
    );
    expect(emailMatchesHostedDomain("Alice@RowsOne.COM", "rowsone.com")).toBe(
      true,
    );
  });

  it("rejects other domains, subdomains, and spoofed suffixes", () => {
    expect(emailMatchesHostedDomain("alice@gmail.com", "rowsone.com")).toBe(
      false,
    );
    expect(
      emailMatchesHostedDomain("alice@team.rowsone.com", "rowsone.com"),
    ).toBe(false);
    expect(
      emailMatchesHostedDomain("alice@rowsone.com.evil", "rowsone.com"),
    ).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(emailMatchesHostedDomain(null, "rowsone.com")).toBe(false);
    expect(emailMatchesHostedDomain("not-an-email", "rowsone.com")).toBe(
      false,
    );
    expect(emailMatchesHostedDomain("alice@rowsone.com", "")).toBe(false);
  });
});

describe("hdClaimMatchesHostedDomain", () => {
  it("matches the verified hd claim case-insensitively", () => {
    expect(hdClaimMatchesHostedDomain("rowsone.com", "rowsone.com")).toBe(true);
    expect(hdClaimMatchesHostedDomain("RowsOne.COM", "rowsone.com")).toBe(true);
  });

  it("rejects missing or mismatched claims", () => {
    expect(hdClaimMatchesHostedDomain(undefined, "rowsone.com")).toBe(false);
    expect(hdClaimMatchesHostedDomain("", "rowsone.com")).toBe(false);
    expect(hdClaimMatchesHostedDomain("elsewhere.com", "rowsone.com")).toBe(
      false,
    );
  });
});

describe("assertGoogleEmailMatchesHostedDomain", () => {
  it("no-ops when hosted domain is unset", () => {
    expect(() =>
      assertGoogleEmailMatchesHostedDomain(
        { email: "alice@gmail.com" },
        undefined,
      ),
    ).not.toThrow();
  });

  it("allows Workspace alias emails when the verified hd claim matches", () => {
    expect(() =>
      assertGoogleEmailMatchesHostedDomain(
        { email: "alice@alias-brand.com", hd: "rowsone.com" },
        "rowsone.com",
      ),
    ).not.toThrow();
  });

  it("rejects a mismatched hd claim even if the email suffix matches", () => {
    expect(() =>
      assertGoogleEmailMatchesHostedDomain(
        { email: "alice@rowsone.com", hd: "elsewhere.com" },
        "rowsone.com",
      ),
    ).toThrow("GOOGLE_HOSTED_DOMAIN_MISMATCH");
  });

  it("falls back to email suffix when hd is absent", () => {
    expect(() =>
      assertGoogleEmailMatchesHostedDomain(
        { email: "alice@gmail.com" },
        "rowsone.com",
      ),
    ).toThrow("GOOGLE_HOSTED_DOMAIN_MISMATCH");
    expect(() =>
      assertGoogleEmailMatchesHostedDomain(
        { email: "alice@rowsone.com" },
        "rowsone.com",
      ),
    ).not.toThrow();
  });
});
