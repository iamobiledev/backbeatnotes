"use client";

import { useCallback } from "react";
import { DocumentEditor } from "@/components/editor/document-editor";
import { actionSaveDocument } from "@/app/actions";

export function DocumentEditorClient({
  documentId,
  workspaceId,
  initialTitle,
  initialContent,
  readOnly,
}: {
  documentId: string;
  workspaceId: string;
  initialTitle: string;
  initialContent: Record<string, unknown>;
  readOnly?: boolean;
}) {
  const onSave = useCallback(
    async (payload: {
      title: string;
      contentJson: Record<string, unknown>;
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await actionSaveDocument({
        documentId,
        title: payload.title,
        contentJson: payload.contentJson,
      });
      if (result.ok) return { ok: true };
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
      onSave={onSave}
      readOnly={readOnly}
    />
  );
}
