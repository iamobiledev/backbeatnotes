import { beforeEach, describe, expect, it } from "vitest";
import {
  createGoogleStateToken,
  verifyGoogleStateToken,
} from "../state";

describe("google oauth state", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET =
      process.env.BETTER_AUTH_SECRET ??
      "test-secret-at-least-thirty-two-chars!!";
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:pass@localhost:5432/docloom";
    process.env.NEXT_PUBLIC_APP_URL =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    process.env.SKIP_ENV_VALIDATION = "1";
  });

  it("round-trips a valid state token", () => {
    const token = createGoogleStateToken({
      userId: "user_1",
      workspaceId: "ws_1",
    });
    const payload = verifyGoogleStateToken(token);
    expect(payload).toMatchObject({
      kind: "google_connect",
      userId: "user_1",
      workspaceId: "ws_1",
    });
  });

  it("rejects tampered tokens", () => {
    const token = createGoogleStateToken({
      userId: "user_1",
      workspaceId: "ws_1",
    });
    const [data] = token.split(".");
    expect(verifyGoogleStateToken(`${data}.bogus`)).toBeNull();
  });
});
