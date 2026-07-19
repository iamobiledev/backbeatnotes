import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { actionTransferWorkspaceOwnership } from "@/app/actions";
import { MembersSection } from "../members-section";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/actions", () => ({
  actionInviteMember: vi.fn(),
  actionUpdateMemberRole: vi.fn(),
  actionTransferWorkspaceOwnership: vi.fn(),
  actionRemoveMember: vi.fn(),
  actionRevokeInvitation: vi.fn(),
  actionResendInvitation: vi.fn(),
}));

const formatDistanceToNow = vi.fn(
  (): string => "less than a minute ago",
);

vi.mock("date-fns", async () => {
  const actual = await vi.importActual<typeof import("date-fns")>("date-fns");
  return {
    ...actual,
    formatDistanceToNow: () => formatDistanceToNow(),
  };
});

const owner = {
  userId: "user_1",
  name: "Demo User",
  email: "demo@backbeatnotes.local",
  image: null,
  role: "owner",
};

const teammate = {
  userId: "user_2",
  name: "Team Mate",
  email: "teammate@backbeatnotes.local",
  image: null,
  role: "member",
};

describe("MembersSection", () => {
  afterEach(cleanup);

  beforeEach(() => {
    formatDistanceToNow.mockClear();
    vi.mocked(actionTransferWorkspaceOwnership).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("does not re-render the invitations list while typing in #invite-email", () => {
    render(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="user_1"
        isAdmin
        isOwner
        members={[owner]}
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

  it("shows ownership transfer only to the current owner", () => {
    const { rerender } = render(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="user_1"
        isAdmin
        isOwner
        members={[owner, teammate]}
        invitations={[]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Make owner" }),
    ).toBeInTheDocument();

    rerender(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="admin_1"
        isAdmin
        isOwner={false}
        members={[owner, teammate]}
        invitations={[]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Make owner" }),
    ).not.toBeInTheDocument();
  });

  it("confirms the target and transfers ownership", async () => {
    vi.mocked(actionTransferWorkspaceOwnership).mockResolvedValue({
      ok: true,
      data: undefined,
    });
    render(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="user_1"
        isAdmin
        isOwner
        members={[owner, teammate]}
        invitations={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    expect(
      screen.getByRole("heading", {
        name: "Transfer workspace ownership?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Team Mate will become the workspace owner/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );

    await waitFor(() =>
      expect(actionTransferWorkspaceOwnership).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        targetUserId: "user_2",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Team Mate is now the workspace owner",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Transfer workspace ownership?",
        }),
      ).not.toBeInTheDocument(),
    );
  });

  it("cancels without calling the action and keeps errors actionable", async () => {
    vi.mocked(actionTransferWorkspaceOwnership).mockResolvedValue({
      ok: false,
      error: "Only the workspace owner can transfer ownership.",
    });
    render(
      <MembersSection
        workspaceId="ws_1"
        currentUserId="user_1"
        isAdmin
        isOwner
        members={[owner, teammate]}
        invitations={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(actionTransferWorkspaceOwnership).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Only the workspace owner can transfer ownership.",
      ),
    );
    expect(
      screen.getByRole("heading", {
        name: "Transfer workspace ownership?",
      }),
    ).toBeInTheDocument();
  });
});
