import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getSearchService } from "@/lib/search";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Search endpoint — permission filtering is enforced inside the SQL query.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit({
    key: `search:${session.user.id}`,
    limit: 30,
    windowMs: 10_000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many searches — give it a second." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)),
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = z
    .object({
      q: z.string().min(1).max(200),
      workspaceId: z.string().max(100).optional(),
      ownerId: z.string().max(100).optional(),
      parentId: z.string().max(100).optional(),
      updatedAfter: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    })
    .safeParse({
      q: searchParams.get("q"),
      workspaceId: searchParams.get("workspaceId") ?? undefined,
      ownerId: searchParams.get("ownerId") ?? undefined,
      parentId: searchParams.get("parentId") ?? undefined,
      updatedAfter: searchParams.get("updatedAfter") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await getSearchService().search({
      query: parsed.data.q,
      userId: session.user.id,
      workspaceId: parsed.data.workspaceId,
      ownerId: parsed.data.ownerId,
      parentId: parsed.data.parentId,
      updatedAfter: parsed.data.updatedAfter,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("api.search.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
