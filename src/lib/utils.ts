import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * Parse a Notion-style "Email or group, separated by commas" input.
 * Splits on commas/semicolons/whitespace, lowercases, dedupes, and sorts
 * entries into valid emails vs invalid tokens.
 */
export function parseEmailList(input: string): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[\s,;]+/)) {
    const token = raw.trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (EMAIL_RE.test(token)) valid.push(token);
    else invalid.push(token);
  }
  return { valid, invalid };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
