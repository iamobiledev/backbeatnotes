import Link from "next/link";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ImportGoogleDocsButton({
  workspaceId,
}: {
  workspaceId: string;
}) {
  return (
    <Button variant="outline" className="gap-1.5" asChild>
      <Link href={`/app/${workspaceId}/settings#google-docs`}>
        <FileDown className="h-4 w-4" />
        Import from Google Docs
      </Link>
    </Button>
  );
}
