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
  initialRevision,
  readOnly,
}: {
  documentId: string;
  workspaceId: string;
  initialTitle: string;
  initialContent: Record<string, unknown>;
  initialRevision: number;
  readOnly?: boolean;
}) {
  const onSave = useCallback(
    async (payload: {
      title: string;
      contentJson: string;
      expectedRevision: number;
    }): Promise<
      | { ok: true; revision: number }
      | { ok: false; error: string }
    > => {
      const result = await actionSaveDocument({
        documentId,
        title: payload.title,
        contentJson: payload.contentJson,
        expectedRevision: payload.expectedRevision,
      });
      if (result.ok) {
        return { ok: true, revision: result.data.revision };
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
      initialRevision={initialRevision}
      onSave={onSave}
      readOnly={readOnly}
    />
  );
}
