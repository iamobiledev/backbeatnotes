import { Fragment, createElement, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type TipTapMark = {
  type?: string;
  attrs?: Record<string, unknown>;
};

type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TipTapMark[];
  content?: TipTapNode[];
};

function safeUrl(value: unknown, allowRelative = false): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (allowRelative && value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : null;
  } catch {
    return null;
  }
}

function renderMarks(text: ReactNode, marks: TipTapMark[] | undefined) {
  return (marks ?? []).reduce<ReactNode>((value, mark, index) => {
    switch (mark.type) {
      case "bold":
        return <strong key={index}>{value}</strong>;
      case "italic":
        return <em key={index}>{value}</em>;
      case "strike":
        return <s key={index}>{value}</s>;
      case "underline":
        return <u key={index}>{value}</u>;
      case "code":
        return <code key={index}>{value}</code>;
      case "link": {
        const href = safeUrl(mark.attrs?.href, true);
        return href ? (
          <a key={index} href={href} rel="noreferrer noopener">
            {value}
          </a>
        ) : (
          value
        );
      }
      default:
        return value;
    }
  }, text);
}

function childrenOf(node: TipTapNode): ReactNode[] {
  return (node.content ?? []).map((child, index) => (
    <Fragment key={index}>{renderNode(child)}</Fragment>
  ));
}

function renderNode(node: TipTapNode): ReactNode {
  const children = childrenOf(node);
  switch (node.type) {
    case "doc":
      return children;
    case "text":
      return renderMarks(node.text ?? "", node.marks);
    case "paragraph":
      return <p>{children}</p>;
    case "heading": {
      const level = Math.min(
        6,
        Math.max(1, Number(node.attrs?.level) || 1),
      );
      return createElement(`h${level}`, null, children);
    }
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol start={Number(node.attrs?.start) || undefined}>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "taskList":
      return <ul data-type="taskList">{children}</ul>;
    case "taskItem": {
      const checked = Boolean(node.attrs?.checked);
      return (
        <li data-checked={checked ? "true" : "false"}>
          <label>
            <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
          </label>
          <div>{children}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "horizontalRule":
      return <hr />;
    case "hardBreak":
      return <br />;
    case "codeBlock": {
      const language =
        typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return (
        <pre>
          <code className={language ? `language-${language}` : undefined}>
            {(node.content ?? []).map((child) => child.text ?? "").join("")}
          </code>
        </pre>
      );
    }
    case "image": {
      const src = safeUrl(node.attrs?.src, true);
      if (!src) return null;
      const alt =
        typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      );
    }
    case "subpage": {
      const documentId =
        typeof node.attrs?.documentId === "string"
          ? node.attrs.documentId
          : null;
      const workspaceId =
        typeof node.attrs?.workspaceId === "string"
          ? node.attrs.workspaceId
          : null;
      const title =
        typeof node.attrs?.title === "string" ? node.attrs.title : "Untitled";
      if (!documentId || !workspaceId) return null;
      return (
        <div data-type="subpage">
          <Link href={`/app/${workspaceId}/docs/${documentId}`}>{title}</Link>
        </div>
      );
    }
    default:
      return children;
  }
}

/** Safe server renderer for persisted TipTap JSON; no HTML injection. */
export function StaticDocument({
  contentJson,
  className,
}: {
  contentJson: Record<string, unknown>;
  className?: string;
}) {
  return (
    <div className={cn("prose prose-neutral max-w-none", className)}>
      {renderNode(contentJson as TipTapNode)}
    </div>
  );
}
