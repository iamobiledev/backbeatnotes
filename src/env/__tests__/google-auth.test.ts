import { afterEach, describe, expect, it } from "vitest";
import { getGoogleAuthConfig } from "@/env/server";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...overrides } as NodeJS.ProcessEnv;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
});

describe("getGoogleAuthConfig", () => {
  it("returns null when Google OAuth is not configured", () => {
    setEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_HOSTED_DOMAIN: undefined,
    });
    expect(getGoogleAuthConfig()).toBeNull();
  });

  it("returns null when only one of id/secret is set", () => {
    setEnv({
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(getGoogleAuthConfig()).toBeNull();

    setEnv({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(getGoogleAuthConfig()).toBeNull();
  });

  it("returns the config when both id and secret are set", () => {
    setEnv({
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_HOSTED_DOMAIN: undefined,
    });
    expect(getGoogleAuthConfig()).toEqual({
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "secret",
      hostedDomain: undefined,
    });
  });

  it("normalizes the hosted domain to lowercase", () => {
    setEnv({
      GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_HOSTED_DOMAIN: " RowsOne.com ",
    });
    expect(getGoogleAuthConfig()?.hostedDomain).toBe("rowsone.com");
  });
});
