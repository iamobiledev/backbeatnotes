import { unzipSync, strFromU8 } from "fflate";

export type UnzippedHtmlExport = {
  /** Primary HTML document contents. */
  html: string;
  /** Relative path of the HTML entry inside the zip. */
  htmlPath: string;
  /** Non-HTML files keyed by zip-relative path (images, css, etc.). */
  files: Map<string, Uint8Array>;
};

/**
 * Unzip a Google Drive HTML export (`application/zip`).
 * Picks the first `.html` / `.htm` entry as the document body.
 */
export function unzipHtmlExport(bytes: Uint8Array): UnzippedHtmlExport {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    // Some responses may be bare HTML incorrectly typed as zip — try UTF-8.
    const asText = strFromU8(bytes);
    if (asText.includes("<html") || asText.includes("<body")) {
      return {
        html: asText,
        htmlPath: "index.html",
        files: new Map(),
      };
    }
    throw new Error("ZIP_MISSING_HTML");
  }

  const files = new Map<string, Uint8Array>();
  let htmlPath = "";
  let html = "";

  for (const [path, data] of Object.entries(entries)) {
    const normalized = path.replace(/^\.\//, "");
    if (!normalized || normalized.endsWith("/")) continue;
    const lower = normalized.toLowerCase();
    if ((lower.endsWith(".html") || lower.endsWith(".htm")) && !htmlPath) {
      htmlPath = normalized;
      html = strFromU8(data);
      continue;
    }
    files.set(normalized, data);
  }

  if (!htmlPath) {
    throw new Error("ZIP_MISSING_HTML");
  }

  return { html, htmlPath, files };
}
