/**
 * Version snapshot policy.
 *
 * We snapshot the *previous* state of a document right before overwriting it
 * when the edit is "significant". This keeps history useful without creating
 * a version for every keystroke of the debounced autosave.
 */

export const VERSION_MIN_AGE_MS = 10 * 60 * 1000; // 10 minutes
export const VERSION_MIN_CHAR_DELTA = 200;

export type VersionDecisionInput = {
  /** When the most recent snapshot was created (null = no snapshots yet). */
  lastVersionAt: Date | null;
  /** Previous document title (about to be replaced). */
  previousTitle: string;
  /** New title being saved. */
  nextTitle: string;
  /** Previous plain text content. */
  previousPlainText: string;
  /** New plain text content. */
  nextPlainText: string;
  /** Current time (injectable for tests). */
  now?: Date;
};

export function shouldCreateVersion(input: VersionDecisionInput): boolean {
  const now = input.now ?? new Date();

  const hasContent =
    input.previousPlainText.trim().length > 0 ||
    input.previousTitle.trim().length > 0;
  if (!hasContent) return false; // nothing worth snapshotting

  // Title changes are always significant.
  if (input.previousTitle.trim() !== input.nextTitle.trim()) return true;

  const delta = Math.abs(
    input.nextPlainText.length - input.previousPlainText.length,
  );
  if (delta >= VERSION_MIN_CHAR_DELTA) return true;

  // Otherwise snapshot at most once per VERSION_MIN_AGE_MS while edits continue.
  if (!input.lastVersionAt) return true;
  return now.getTime() - input.lastVersionAt.getTime() >= VERSION_MIN_AGE_MS;
}
