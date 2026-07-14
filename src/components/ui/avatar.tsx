import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Simple initials avatar. Falls back to the first letters of the name.
 */
export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name}
        className={cn(
          "h-7 w-7 shrink-0 rounded-full object-cover",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-[10px] font-semibold text-[var(--secondary-foreground)]",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
