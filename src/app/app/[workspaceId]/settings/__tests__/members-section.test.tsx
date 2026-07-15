import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersSection } from "../members-section";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/actions", () => ({
  actionInviteMember: vi.fn(),
  actionUpdateMemberRole: vi.fn(),
  actionRemoveMember: vi.fn(),
  actionRevokeInvitation: vi.fn(),
  actionResendInvitation: vi.fn(),
}));

const formatDistanceToNow = vi.fn(() => "less than a minute ago");

vi.mock("date-fns", async () => {
  const actual = await vi.importActual<typeof import("date-fns")>("date-fns");
  return {
    ...actual,
    formatDistanceToNow: (...args: unknown[]) => formatDistanceToNow(...args),
  };
});

describe("MembersSection invite email INP", () => {
  beforeEach(() => {
    formatDistanceToNow.mockClear();
  });

  it("does not re-render the invitations list while typing in #invite-email", () => {
    render(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="user_1"
        isAdmin
        members={[
          {
            userId: "user_1",
            name: "Demo User",
            email: "demo@backbeatnotes.local",
            image: null,
            role: "owner",
          },
        ]}
        invitations={[
          {
            id: "inv_1",
            email: "pending@example.com",
            role: "member",
            expiresAt: new Date().toISOString(),
            lastSentAt: new Date().toISOString(),
          },
        ]}
      />,
    );

    expect(formatDistanceToNow).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "invite-email");
    expect(input).not.toHaveAttribute("value");

    fireEvent.change(input, { target: { value: "teammate@company.com" } });
    fireEvent.change(input, { target: { value: "teammate@company.comx" } });
    fireEvent.input(input, { target: { value: "fast-typing@company.com" } });

    // Parent MembersSection (which formats invitation timestamps) must stay idle.
    expect(formatDistanceToNow).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("fast-typing@company.com");
  });
});
