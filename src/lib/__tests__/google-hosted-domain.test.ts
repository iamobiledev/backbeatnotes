import { afterEach, describe, expect, it } from "vitest";
import { isGoogleHostedDomainAllowed } from "better-auth/social-providers";
import { getGoogleAuthConfig } from "@/env/server";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_HOSTED_DOMAIN",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/**
 * We pass `GOOGLE_HOSTED_DOMAIN` through as Better Auth's Google `hd` option.
 * Better Auth (≥1.6.16) enforces that option against the verified id-token
 * `hd` claim in `verifyIdToken` / `getUserInfo`. These tests lock in the
 * library contract we depend on and the env → provider wiring.
 */
describe("Google hosted domain enforcement contract", () => {
  it("accepts a matching Workspace hd claim and rejects mismatches / missing claims", () => {
    expect(isGoogleHostedDomainAllowed("rowsone.com", "rowsone.com")).toBe(
      true,
    );
    expect(isGoogleHostedDomainAllowed("rowsone.com", "elsewhere.com")).toBe(
      false,
    );
    expect(isGoogleHostedDomainAllowed("rowsone.com", undefined)).toBe(false);
    expect(isGoogleHostedDomainAllowed("rowsone.com", "")).toBe(false);
    expect(isGoogleHostedDomainAllowed(undefined, "rowsone.com")).toBe(true);
    expect(isGoogleHostedDomainAllowed("*", "rowsone.com")).toBe(true);
    expect(isGoogleHostedDomainAllowed("*", undefined)).toBe(false);
  });

  it("wires GOOGLE_HOSTED_DOMAIN into the Google provider hd option shape", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_HOSTED_DOMAIN = " RowsOne.com ";

    const google = getGoogleAuthConfig();
    expect(google).not.toBeNull();

    // Mirrors src/lib/auth.ts socialProviders.google construction.
    const providerOptions = {
      clientId: google!.clientId,
      clientSecret: google!.clientSecret,
      ...(google!.hostedDomain ? { hd: google!.hostedDomain } : {}),
    };

    expect(providerOptions.hd).toBe("rowsone.com");
    expect(
      isGoogleHostedDomainAllowed(providerOptions.hd, "rowsone.com"),
    ).toBe(true);
    expect(
      isGoogleHostedDomainAllowed(providerOptions.hd, "gmail.com"),
    ).toBe(false);
  });
});
