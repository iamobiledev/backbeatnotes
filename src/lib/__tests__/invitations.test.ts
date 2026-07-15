import { describe, expect, it } from "vitest";
import {
  invitationMatchesEmail,
  isInvitationActive,
  normalizeInvitationEmail,
  type WorkspaceInvitationDetails,
} from "@/lib/invitations";

function invitation(
  overrides: Partial<WorkspaceInvitationDetails> = {},
): WorkspaceInvitationDetails {
  return {
    kind: "workspace",
    token: "token",
    email: "invitee@example.com",
    status: "pending",
    expiresAt: new Date("2030-01-02T00:00:00.000Z"),
    workspaceId: "workspace",
    workspaceName: "Studio",
    role: "member",
    ...overrides,
  };
}

describe("invitation state", () => {
  it("normalizes and compares invited emails case-insensitively", () => {
    expect(normalizeInvitationEmail("  Invitee@Example.COM ")).toBe(
      "invitee@example.com",
    );
    expect(
      invitationMatchesEmail(
        invitation({ email: "Invitee@Example.COM" }),
        " invitee@example.com ",
      ),
    ).toBe(true);
  });

  it("accepts only pending, unexpired invitations", () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    expect(isInvitationActive(invitation(), now)).toBe(true);
    expect(
      isInvitationActive(invitation({ status: "accepted" }), now),
    ).toBe(false);
    expect(
      isInvitationActive(
        invitation({ expiresAt: new Date("2029-12-31T23:59:59.999Z") }),
        now,
      ),
    ).toBe(false);
  });

  it("treats the exact expiry instant as still valid", () => {
    const expiresAt = new Date("2030-01-02T00:00:00.000Z");
    expect(
      isInvitationActive(invitation({ expiresAt }), expiresAt),
    ).toBe(true);
  });
});
