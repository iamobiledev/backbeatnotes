"use client";

import { useCallback } from "react";
import dynamic from "next/dynamic";
import { actionSaveDocument } from "@/app/actions";

const DocumentEditor = dynamic(
  () =>
    import("@/components/editor/document-editor").then(
      (module) => module.DocumentEditor,
    ),
  {
    loading: () => (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="h-10 w-2/3 animate-pulse rounded-md bg-[var(--muted)]" />
        <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--muted)]" />
      </div>
    ),
  },
);

export function DocumentEditorClient({
  documentId,
  workspaceId,
  initialTitle,
  initialContent,
  initialUpdatedAt,
  readOnly,
}: {
  documentId: string;
  workspaceId: string;
  initialTitle: string;
  initialContent: Record<string, unknown>;
  initialUpdatedAt: string;
  readOnly?: boolean;
}) {
  const onSave = useCallback(
    async (payload: {
      title: string;
      contentJson: string;
      expectedUpdatedAt: string;
    }): Promise<
      | { ok: true; updatedAt: string }
      | { ok: false; error: string }
    > => {
      const result = await actionSaveDocument({
        documentId,
        title: payload.title,
        contentJson: payload.contentJson,
        expectedUpdatedAt: payload.expectedUpdatedAt,
      });
      if (result.ok) {
        return { ok: true, updatedAt: result.data.updatedAt };
      }
      return { ok: false, error: result.error };
    },
    [documentId],
  );

  return (
    <DocumentEditor
      documentId={documentId}
      workspaceId={workspaceId}
      initialTitle={initialTitle}
      initialContent={initialContent}
      initialUpdatedAt={initialUpdatedAt}
      onSave={onSave}
      readOnly={readOnly}
    />
  );
}
