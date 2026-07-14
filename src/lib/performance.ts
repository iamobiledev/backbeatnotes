import "server-only";
import { performance } from "node:perf_hooks";
import { logger } from "@/lib/logger";

const DEFAULT_SLOW_OPERATION_MS = 250;

function slowOperationThreshold(): number {
  const configured = Number(process.env.SLOW_OPERATION_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SLOW_OPERATION_MS;
}

/**
 * Measure a server operation without logging payloads or query text.
 * Successful fast calls stay silent; failures and threshold breaches are
 * structured so Vercel log drains can aggregate them by operation.
 */
export async function measureServerOperation<T>(
  operation: string,
  work: () => Promise<T>,
  fields?: Record<string, string | number | boolean | null>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await work();
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    if (durationMs >= slowOperationThreshold()) {
      logger.warn("performance.slow_operation", {
        operation,
        durationMs,
        ...fields,
      });
    }
    return result;
  } catch (error) {
    logger.error("performance.operation_failed", {
      operation,
      durationMs:
        Math.round((performance.now() - startedAt) * 10) / 10,
      ...fields,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
