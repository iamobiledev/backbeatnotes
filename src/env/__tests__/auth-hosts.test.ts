import { afterEach, describe, expect, it } from "vitest";
import { getAuthAllowedHosts } from "@/env/server";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...overrides } as NodeJS.ProcessEnv;
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
});

describe("getAuthAllowedHosts", () => {
  it("includes the configured app URL host and Vercel aliases", () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://backbeatnotes.com",
      VERCEL: "1",
      VERCEL_URL: "snakepit-mauve.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "backbeatnotes.com",
      BETTER_AUTH_TRUSTED_ORIGINS: undefined,
    });

    const hosts = getAuthAllowedHosts();
    expect(hosts).toEqual(
      expect.arrayContaining([
        "backbeatnotes.com",
        "snakepit-mauve.vercel.app",
        "*.vercel.app",
      ]),
    );
  });

  it("parses extra BETTER_AUTH_TRUSTED_ORIGINS hosts and origins", () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://backbeatnotes.com",
      VERCEL: undefined,
      VERCEL_URL: undefined,
      BETTER_AUTH_TRUSTED_ORIGINS:
        "https://www.backbeatnotes.com, staging.backbeatnotes.com",
    });

    const hosts = getAuthAllowedHosts();
    expect(hosts).toEqual(
      expect.arrayContaining([
        "backbeatnotes.com",
        "www.backbeatnotes.com",
        "staging.backbeatnotes.com",
      ]),
    );
  });

  it("adds local loopback hosts outside production", () => {
    setEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      VERCEL: undefined,
      VERCEL_URL: undefined,
      BETTER_AUTH_TRUSTED_ORIGINS: undefined,
    });

    expect(getAuthAllowedHosts()).toEqual(
      expect.arrayContaining(["localhost:3000", "127.0.0.1:3000"]),
    );
  });
});
