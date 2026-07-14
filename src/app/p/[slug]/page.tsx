import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublicDocument,
  refreshSubpageTitles,
} from "@/lib/documents/service";
import { brand } from "@/config/brand";
import { PublicDocumentView } from "./public-view";

/** Always render on demand so publish/unpublish invalidation is prompt. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getPublicDocument(slug);
  if (!doc) {
    return { title: "Not found" };
  }

  const description =
    doc.plainTextContent.slice(0, 160) || brand.tagline;

  return {
    title: doc.title,
    description,
    openGraph: {
      title: doc.title,
      description,
      type: "article",
      siteName: brand.name,
      images: doc.coverImageUrl ? [{ url: doc.coverImageUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: doc.title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function PublicDocumentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getPublicDocument(slug);
  if (!doc) notFound();

  return (
    <PublicDocumentView
      title={doc.title}
      contentJson={await refreshSubpageTitles(doc.contentJson)}
      updatedAt={doc.updatedAt.toISOString()}
      creatorName={doc.creatorName}
    />
  );
}
