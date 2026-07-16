import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { unzipHtmlExport } from "../zip";

describe("unzipHtmlExport", () => {
  it("extracts the first HTML entry and sibling files", () => {
    const zipped = zipSync({
      "doc.html": strToU8("<html><body><p>Hi</p></body></html>"),
      "images/pic.png": new Uint8Array([1, 2, 3, 4]),
    });

    const result = unzipHtmlExport(zipped);
    expect(result.htmlPath).toBe("doc.html");
    expect(result.html).toContain("<p>Hi</p>");
    expect(result.files.get("images/pic.png")).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("falls back to raw HTML when the buffer is not a zip", () => {
    const html = "<html><body><p>Plain</p></body></html>";
    const result = unzipHtmlExport(strToU8(html));
    expect(result.html).toContain("Plain");
    expect(result.files.size).toBe(0);
  });

  it("throws when zip has no HTML", () => {
    const zipped = zipSync({
      "readme.txt": strToU8("nope"),
    });
    expect(() => unzipHtmlExport(zipped)).toThrow(/ZIP_MISSING_HTML/);
  });
});
