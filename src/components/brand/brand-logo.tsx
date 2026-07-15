import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  title?: string;
};

/**
 * BackBeat Notes' pulse mark. It stays legible at favicon size and uses
 * currentColor so it works across the marketing site, app chrome, and auth.
 */
export function BrandMark({ className, title }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-8 w-8 shrink-0 text-[var(--primary)]", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M6.5 17h4.1l2.4-6.2 4.1 11.5 2.7-7.4 1.4 2.1h4.3"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type BrandLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
};

export function BrandLogo({
  className,
  markClassName,
  wordmarkClassName,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={markClassName} />
      <span
        className={cn(
          "font-[family-name:var(--font-display)] font-bold tracking-tight",
          wordmarkClassName,
        )}
      >
        {brand.logoText}
      </span>
    </span>
  );
}
