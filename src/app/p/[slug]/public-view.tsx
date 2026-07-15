import { StaticDocument } from "@/components/documents/static-document";
import { brand } from "@/config/brand";
import Link from "next/link";

export function PublicDocumentView({
  title,
  contentJson,
  updatedAt,
  creatorName,
}: {
  title: string;
  contentJson: Record<string, unknown>;
  updatedAt: string;
  creatorName: string;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--primary)]"
        >
          {brand.name}
        </Link>
        <p className="text-xs text-[var(--muted-foreground)]">
          Published · {new Date(updatedAt).toLocaleDateString()} · {creatorName}
        </p>
      </header>
      <h1 className="mb-6 font-[family-name:var(--font-display)] text-4xl tracking-tight">
        {title}
      </h1>
      <StaticDocument contentJson={contentJson} />
    </main>
  );
}
