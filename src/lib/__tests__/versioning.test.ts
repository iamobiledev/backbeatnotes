import { describe, expect, it } from "vitest";
import {
  shouldCreateVersion,
  VERSION_MIN_AGE_MS,
  VERSION_MIN_CHAR_DELTA,
} from "@/lib/documents/versioning";

const base = {
  previousTitle: "Doc",
  nextTitle: "Doc",
  previousPlainText: "hello world, this is content",
  nextPlainText: "hello world, this is content plus a bit",
  now: new Date("2026-01-01T12:00:00Z"),
};

describe("shouldCreateVersion", () => {
  it("skips empty documents", () => {
    expect(
      shouldCreateVersion({
        ...base,
        previousTitle: " ",
        previousPlainText: "",
        lastVersionAt: null,
      }),
    ).toBe(false);
  });

  it("always snapshots on title change", () => {
    expect(
      shouldCreateVersion({
        ...base,
        nextTitle: "Doc v2",
        lastVersionAt: new Date(base.now.getTime() - 1000),
      }),
    ).toBe(true);
  });

  it("snapshots on large content delta", () => {
    expect(
      shouldCreateVersion({
        ...base,
        nextPlainText:
          base.previousPlainText + "x".repeat(VERSION_MIN_CHAR_DELTA),
        lastVersionAt: new Date(base.now.getTime() - 1000),
      }),
    ).toBe(true);
  });

  it("first snapshot is created for non-empty docs", () => {
    expect(shouldCreateVersion({ ...base, lastVersionAt: null })).toBe(true);
  });

  it("throttles small edits to once per window", () => {
    expect(
      shouldCreateVersion({
        ...base,
        lastVersionAt: new Date(base.now.getTime() - 1000),
      }),
    ).toBe(false);
    expect(
      shouldCreateVersion({
        ...base,
        lastVersionAt: new Date(base.now.getTime() - VERSION_MIN_AGE_MS - 1),
      }),
    ).toBe(true);
  });
});
