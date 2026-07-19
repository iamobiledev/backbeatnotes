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

type PostgresErrorLayer = {
  code?: unknown;
  column?: unknown;
  table?: unknown;
  message?: unknown;
  cause?: unknown;
};

function errorLayers(error: unknown): PostgresErrorLayer[] {
  const layers: PostgresErrorLayer[] = [];
  let current = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 12; depth++) {
    if (!current || typeof current !== "object" || visited.has(current)) break;
    visited.add(current);
    const layer = current as PostgresErrorLayer;
    layers.push(layer);
    current = layer.cause;
  }

  return layers;
}

/**
 * True only when PostgreSQL says a known optional relation is unavailable.
 * The object-name check prevents unrelated schema bugs from being swallowed.
 */
export function isMissingPostgresRelation(
  error: unknown,
  relation: string,
): boolean {
  const escaped = relation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactMissingRelation = new RegExp(
    `\\brelation\\s+"(?:public\\.)?${escaped}"\\s+does not exist\\b`,
    "i",
  );

  return errorLayers(error).some((layer) => {
    if (layer.code !== "42P01") return false;
    if (layer.table === relation || layer.table === `public.${relation}`) {
      return true;
    }
    return (
      typeof layer.message === "string" &&
      exactMissingRelation.test(layer.message)
    );
  });
}

/**
 * True only when PostgreSQL says a known optional column is unavailable.
 * Match the code and column on the same driver-error layer so an outer
 * Drizzle query string cannot make an unrelated schema failure look safe.
 */
export function isMissingPostgresColumn(
  error: unknown,
  column: string,
): boolean {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactMissingColumn = new RegExp(
    `\\bcolumn\\s+"(?:[^"]+\\.)?${escaped}"\\s+does not exist\\b`,
    "i",
  );

  return errorLayers(error).some((layer) => {
    if (layer.code !== "42703") return false;
    if (layer.column === column) return true;
    return (
      typeof layer.message === "string" &&
      exactMissingColumn.test(layer.message)
    );
  });
}
