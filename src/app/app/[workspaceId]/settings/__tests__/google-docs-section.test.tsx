import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDocsSection } from "../google-docs-section";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/google-actions", () => ({
  actionDisconnectGoogle: vi.fn(),
  actionImportGoogleDoc: vi.fn(),
  actionListGoogleDocs: vi.fn(),
}));

describe("GoogleDocsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an honest not-configured state", () => {
    const { container } = render(
      <GoogleDocsSection
        workspaceId="ws_1"
        canImport
        google={{ configured: false, connected: false, email: null }}
      />,
    );

    const section = within(container);
    expect(
      section.getByRole("heading", { name: "Google Docs" }),
    ).toBeInTheDocument();
    expect(
      section.getByText(/isn’t configured for this deployment yet/i),
    ).toBeInTheDocument();
    expect(
      section.queryByRole("link", { name: /connect google/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Connect Google when configured but not connected", () => {
    const { container } = render(
      <GoogleDocsSection
        workspaceId="ws_1"
        canImport
        google={{ configured: true, connected: false, email: null }}
      />,
    );

    const link = within(container).getByRole("link", {
      name: /connect google/i,
    });
    expect(link).toHaveAttribute(
      "href",
      "/api/google/oauth/start?workspaceId=ws_1",
    );
  });

  it("hides connect/import controls for guests", () => {
    const { container } = render(
      <GoogleDocsSection
        workspaceId="ws_1"
        canImport={false}
        google={{ configured: true, connected: false, email: null }}
      />,
    );

    const section = within(container);
    expect(
      section.queryByRole("link", { name: /connect google/i }),
    ).not.toBeInTheDocument();
    expect(
      section.getByText(/ask a workspace member to import/i),
    ).toBeInTheDocument();
  });
});
