import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentTree } from "../document-tree";
import type { DocumentTreeNode } from "@/lib/documents/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The Move-to dialog is loaded lazily; it has its own tests.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@/app/actions", () => ({
  actionDuplicateDocument: vi.fn(async () => ({ ok: true })),
  actionMoveDocument: vi.fn(async () => ({ ok: true })),
  actionRenameDocument: vi.fn(async () => ({ ok: true })),
  actionToggleFavorite: vi.fn(async () => ({ ok: true, data: {} })),
  actionTrashDocument: vi.fn(async () => ({ ok: true, data: {} })),
}));

import {
  actionMoveDocument,
  actionTrashDocument,
} from "@/app/actions";

afterEach(cleanup);

// Radix menus need a few DOM APIs jsdom does not implement.
beforeEach(() => {
  vi.clearAllMocks();
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

function makeNode(
  id: string,
  title: string,
  children: DocumentTreeNode[] = [],
  overrides: Partial<DocumentTreeNode> = {},
): DocumentTreeNode {
  return {
    id,
    title,
    parentId: null,
    icon: null,
    visibility: "workspace",
    docType: "doc",
    locked: false,
    updatedAt: new Date("2026-07-12T23:34:00"),
    createdById: "user_1",
    updatedByName: "Allen Abraham",
    children,
    ...overrides,
  };
}

const child = makeNode("doc_child", "Child page", [], { parentId: "doc_a" });
const nodes: DocumentTreeNode[] = [
  makeNode("doc_a", "Alpha", [child]),
  makeNode("doc_b", "Beta"),
];

function renderTree(props: Partial<React.ComponentProps<typeof DocumentTree>> = {}) {
  return render(
    <DocumentTree
      nodes={nodes}
      workspaceId="ws_1"
      workspaceSlug="rowsone"
      activePath=""
      favoriteIds={new Set()}
      canEdit
      rootLabel="Private"
      onCreateChild={() => {}}
      onMoved={() => {}}
      {...props}
    />,
  );
}

function rowFor(title: string) {
  // The row <div> wrapping the page link (drag handle + context menu trigger).
  return screen.getByText(title).closest("div[draggable]") as HTMLElement;
}

describe("DocumentTree context menu", () => {
  it("right-click opens a Notion-style menu instead of the browser default", () => {
    renderTree();
    const row = rowFor("Alpha");
    const notPrevented = fireEvent.contextMenu(row);

    // Radix calls preventDefault, suppressing the native browser menu.
    expect(notPrevented).toBe(false);

    for (const item of [
      "Add to favorites",
      "Copy link",
      "Duplicate",
      "Rename",
      "Move to",
      "Move to trash",
      "Open in new tab",
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getByText("Last edited by Allen Abraham")).toBeInTheDocument();
    expect(screen.getByText("Jul 12, 2026, 11:34 PM")).toBeInTheDocument();
  });

  it("shows a reduced read-only menu when the viewer cannot edit", () => {
    renderTree({ canEdit: false });
    fireEvent.contextMenu(rowFor("Beta"));

    expect(screen.getByText("Add to favorites")).toBeInTheDocument();
    expect(screen.getByText("Copy link")).toBeInTheDocument();
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    for (const item of ["Duplicate", "Rename", "Move to", "Move to trash"]) {
      expect(screen.queryByText(item)).not.toBeInTheDocument();
    }
  });

  it("moves a page to trash from the context menu", async () => {
    renderTree();
    fireEvent.contextMenu(rowFor("Beta"));
    fireEvent.click(screen.getByText("Move to trash"));

    await waitFor(() =>
      expect(actionTrashDocument).toHaveBeenCalledWith({
        documentId: "doc_b",
      }),
    );
  });

  it("keeps the same items in the ··· dropdown menu", () => {
    renderTree();
    // Radix dropdown triggers open on pointerdown rather than click.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Page options for Beta" }),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );

    expect(screen.getByText("Move to")).toBeInTheDocument();
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    expect(screen.getByText("Last edited by Allen Abraham")).toBeInTheDocument();
  });
});

describe("DocumentTree drag & drop", () => {
  const dataTransfer = () => ({
    setData: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  });

  it("nests a page when dropped onto another page", async () => {
    renderTree();
    const source = rowFor("Beta");
    const target = rowFor("Alpha");
    const dt = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.dragEnter(target, { dataTransfer: dt });
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });

    await waitFor(() =>
      expect(actionMoveDocument).toHaveBeenCalledWith({
        documentId: "doc_b",
        newParentId: "doc_a",
      }),
    );
  });

  it("rejects drops onto the page itself or its own sub-pages", () => {
    renderTree({ activePath: "/app/ws_1/docs/doc_child" });
    const source = rowFor("Alpha");
    const dt = dataTransfer();

    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(source, { dataTransfer: dt });
    fireEvent.drop(rowFor("Child page"), { dataTransfer: dt });

    expect(actionMoveDocument).not.toHaveBeenCalled();
  });

  it("is not draggable for read-only viewers", () => {
    renderTree({ canEdit: false });
    expect(
      screen.getByText("Beta").closest("div[draggable]"),
    ).toHaveAttribute("draggable", "false");
  });
});
