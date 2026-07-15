/**
 * Walk wrapped database errors without depending on a specific driver class.
 * Drizzle adds one or more `cause` layers around Neon/node-postgres errors.
 */
export function postgresErrorCode(error: unknown): string | null {
  let current = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 12; depth++) {
    if (!current || typeof current !== "object" || visited.has(current)) {
      return null;
    }
    visited.add(current);

    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }

  return null;
}

function errorMessages(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 12; depth++) {
    if (!current || visited.has(current)) break;
    visited.add(current);

    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as { message?: unknown; cause?: unknown };
      if (typeof record.message === "string") messages.push(record.message);
      current = record.cause;
      continue;
    }
    break;
  }

  return messages.join("\n");
}

/**
 * True only when PostgreSQL says a known optional relation is unavailable.
 * The object-name check prevents unrelated schema bugs from being swallowed.
 */
export function isMissingPostgresRelation(
  error: unknown,
  relation: string,
): boolean {
  return (
    postgresErrorCode(error) === "42P01" &&
    errorMessages(error).toLocaleLowerCase().includes(relation.toLocaleLowerCase())
  );
}
