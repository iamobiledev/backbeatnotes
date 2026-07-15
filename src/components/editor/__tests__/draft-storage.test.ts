import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDocumentDraft,
  readDocumentDraft,
  writeDocumentDraft,
} from "../draft-storage";

describe("document draft storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a valid draft and clears it after acknowledgement", () => {
    writeDocumentDraft(
      window.localStorage,
      "doc-1",
      {
        baseSignature: "server-v1",
        title: "Recovered title",
        contentJson: '{"type":"doc","content":[]}',
      },
      1_000,
    );

    expect(readDocumentDraft(window.localStorage, "doc-1", 2_000)).toEqual({
      version: 1,
      baseSignature: "server-v1",
      title: "Recovered title",
      contentJson: '{"type":"doc","content":[]}',
      savedAt: 1_000,
    });

    clearDocumentDraft(window.localStorage, "doc-1");
    expect(readDocumentDraft(window.localStorage, "doc-1", 2_000)).toBeNull();
  });

  it("expires stale or future-dated drafts", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    writeDocumentDraft(
      window.localStorage,
      "old",
      {
        baseSignature: "v1",
        title: "",
        contentJson: '{"type":"doc"}',
      },
      1_000,
    );
    expect(
      readDocumentDraft(window.localStorage, "old", 1_000 + week + 1),
    ).toBeNull();

    writeDocumentDraft(
      window.localStorage,
      "future",
      {
        baseSignature: "v1",
        title: "",
        contentJson: '{"type":"doc"}',
      },
      100_000,
    );
    expect(readDocumentDraft(window.localStorage, "future", 1_000)).toBeNull();
  });

  it("rejects malformed records without throwing", () => {
    window.localStorage.setItem("docloom:draft:bad", "{not json");
    expect(readDocumentDraft(window.localStorage, "bad")).toBeNull();

    window.localStorage.setItem(
      "docloom:draft:bad-content",
      JSON.stringify({
        version: 1,
        baseSignature: "v1",
        title: "",
        contentJson: "{bad",
        savedAt: Date.now(),
      }),
    );
    expect(
      readDocumentDraft(window.localStorage, "bad-content"),
    ).toBeNull();
  });
});
