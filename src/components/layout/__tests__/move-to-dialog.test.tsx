import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoveToDialog } from "../move-to-dialog";
import type { DocumentTreeNode } from "@/lib/documents/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/actions", () => ({
  actionMoveDocument: vi.fn(async () => ({ ok: true })),
}));

import { actionMoveDocument } from "@/app/actions";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
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
    updatedAt: new Date(),
    createdById: "user_1",
    updatedByName: null,
    children,
    ...overrides,
  };
}

const grandchild = makeNode("doc_gc", "Grandchild", [], {
  parentId: "doc_moving",
});
const moving = makeNode("doc_moving", "Moving page", [grandchild], {
  parentId: "doc_parent",
});
const parent = makeNode("doc_parent", "Current parent", [moving]);
const other = makeNode("doc_other", "Other page");
const nodes = [parent, other];

function renderDialog() {
  return render(
    <MoveToDialog
      open
      onOpenChange={() => {}}
      document={moving}
      nodes={nodes}
      rootLabel="Private"
      onMoved={() => {}}
    />,
  );
}

describe("MoveToDialog", () => {
  it("lists valid destinations only (no self, sub-pages, or current parent)", () => {
    renderDialog();

    expect(screen.getByText("Top level of Private")).toBeInTheDocument();
    expect(screen.getByText("Other page")).toBeInTheDocument();
    // Its own subtree and the no-op destinations are excluded.
    expect(screen.queryByText("Moving page")).not.toBeInTheDocument();
    expect(screen.queryByText("Grandchild")).not.toBeInTheDocument();
    expect(screen.queryByText("Current parent")).not.toBeInTheDocument();
  });

  it("moves the page under the chosen destination", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Other page"));

    await waitFor(() =>
      expect(actionMoveDocument).toHaveBeenCalledWith({
        documentId: "doc_moving",
        newParentId: "doc_other",
      }),
    );
  });

  it("moves the page to the top level", async () => {
    renderDialog();
    fireEvent.click(screen.getByText("Top level of Private"));

    await waitFor(() =>
      expect(actionMoveDocument).toHaveBeenCalledWith({
        documentId: "doc_moving",
        newParentId: null,
      }),
    );
  });

  it("filters destinations by search query", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Search move destinations"), {
      target: { value: "other" },
    });

    expect(screen.getByText("Other page")).toBeInTheDocument();
    expect(screen.queryByText("Top level of Private")).not.toBeInTheDocument();
  });
});
