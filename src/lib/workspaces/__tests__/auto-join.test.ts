import { describe, expect, it } from "vitest";
import {
  actorCanClaimAutoJoinDomain,
  emailDomainOf,
  excludeWorkspacesWithPendingInvite,
  membershipRoleFromInvitation,
  normalizeAutoJoinDomain,
  shouldApplyInvitationRoleToMembership,
  validateAutoJoinDomain,
  PUBLIC_EMAIL_DOMAINS,
} from "@/lib/workspaces/auto-join";

describe("emailDomainOf", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomainOf("alice@rowsone.com")).toBe("rowsone.com");
    expect(emailDomainOf("Alice@RowsOne.COM")).toBe("rowsone.com");
    expect(emailDomainOf("  bob@rowsone.com  ")).toBe("rowsone.com");
  });

  it("supports subdomains", () => {
    expect(emailDomainOf("dev@team.rowsone.com")).toBe("team.rowsone.com");
  });

  it("uses the last @ for quoted/plus addresses", () => {
    expect(emailDomainOf("a+tag@rowsone.com")).toBe("rowsone.com");
  });

  it("returns null for malformed emails", () => {
    expect(emailDomainOf("not-an-email")).toBeNull();
    expect(emailDomainOf("@rowsone.com")).toBeNull();
    expect(emailDomainOf("alice@")).toBeNull();
    expect(emailDomainOf("alice@nodot")).toBeNull();
    expect(emailDomainOf("alice@-bad-.com")).toBeNull();
    expect(emailDomainOf("")).toBeNull();
  });
});

describe("normalizeAutoJoinDomain", () => {
  it("trims, lowercases, and strips a leading @", () => {
    expect(normalizeAutoJoinDomain("  @RowsOne.com ")).toBe("rowsone.com");
    expect(normalizeAutoJoinDomain("rowsone.com")).toBe("rowsone.com");
    expect(normalizeAutoJoinDomain("@@rowsone.com")).toBe("rowsone.com");
  });
});

describe("validateAutoJoinDomain", () => {
  it("accepts real company domains", () => {
    expect(validateAutoJoinDomain("rowsone.com")).toEqual({
      ok: true,
      domain: "rowsone.com",
    });
    expect(validateAutoJoinDomain("@rowsone.com")).toEqual({
      ok: true,
      domain: "rowsone.com",
    });
    expect(validateAutoJoinDomain("team.rowsone.co.uk")).toEqual({
      ok: true,
      domain: "team.rowsone.co.uk",
    });
  });

  it("rejects invalid shapes", () => {
    for (const input of [
      "",
      "   ",
      "nodot",
      "spaces in.com",
      "rowsone..com",
      "-rowsone.com",
      "rowsone.com/path",
      "https://rowsone.com",
      "alice@rowsone.com",
      "rowsone.123",
    ]) {
      expect(validateAutoJoinDomain(input)).toEqual({
        ok: false,
        error: "INVALID_DOMAIN",
      });
    }
  });

  it("rejects public consumer email domains", () => {
    for (const domain of ["gmail.com", "Googlemail.com", "@yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me"]) {
      expect(validateAutoJoinDomain(domain)).toEqual({
        ok: false,
        error: "PUBLIC_EMAIL_DOMAIN",
      });
    }
  });

  it("keeps the denylist in sync with auto-join skips", () => {
    // Every denylisted domain must be a valid hostname shape, otherwise the
    // PUBLIC_EMAIL_DOMAIN branch would be unreachable for it.
    for (const domain of PUBLIC_EMAIL_DOMAINS) {
      expect(validateAutoJoinDomain(domain).ok).toBe(false);
    }
  });
});

describe("excludeWorkspacesWithPendingInvite", () => {
  it("removes workspaces that already have a pending invite", () => {
    expect(
      excludeWorkspacesWithPendingInvite(
        ["ws-a", "ws-b", "ws-c"],
        ["ws-b", "ws-d"],
      ),
    ).toEqual(["ws-a", "ws-c"]);
  });

  it("keeps all workspaces when no invites are pending", () => {
    expect(excludeWorkspacesWithPendingInvite(["ws-a"], [])).toEqual(["ws-a"]);
  });
});

describe("membershipRoleFromInvitation", () => {
  it("maps owner invites to admin membership", () => {
    expect(membershipRoleFromInvitation("owner")).toBe("admin");
    expect(membershipRoleFromInvitation("admin")).toBe("admin");
    expect(membershipRoleFromInvitation("member")).toBe("member");
    expect(membershipRoleFromInvitation("guest")).toBe("guest");
  });
});

describe("shouldApplyInvitationRoleToMembership", () => {
  it("applies guest/admin over an auto-joined member row", () => {
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "member",
        invitationRole: "guest",
      }),
    ).toBe(true);
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "member",
        invitationRole: "admin",
      }),
    ).toBe(true);
  });

  it("upgrades guests when they accept a higher-role invite", () => {
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "guest",
        invitationRole: "admin",
      }),
    ).toBe(true);
  });

  it("never demotes an owner or admin via invitation accept", () => {
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "owner",
        invitationRole: "guest",
      }),
    ).toBe(false);
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "admin",
        invitationRole: "guest",
      }),
    ).toBe(false);
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "admin",
        invitationRole: "member",
      }),
    ).toBe(false);
  });

  it("skips a no-op when roles already match", () => {
    expect(
      shouldApplyInvitationRoleToMembership({
        existingRole: "guest",
        invitationRole: "guest",
      }),
    ).toBe(false);
  });
});

describe("actorCanClaimAutoJoinDomain", () => {
  it("requires the actor email to be at the claimed domain", () => {
    expect(
      actorCanClaimAutoJoinDomain({
        actorEmail: "allen@rowsone.com",
        domain: "rowsone.com",
      }),
    ).toBe(true);
    expect(
      actorCanClaimAutoJoinDomain({
        actorEmail: "allen@rowsone.com",
        domain: "elsewhere.com",
      }),
    ).toBe(false);
    expect(
      actorCanClaimAutoJoinDomain({
        actorEmail: "not-an-email",
        domain: "rowsone.com",
      }),
    ).toBe(false);
  });
});
