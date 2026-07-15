#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const baseUrl = new URL(
  option("base", process.env.PERF_BASE_URL ?? "http://localhost:3000"),
);
const routes = option("routes", "/,/sign-in")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const outputPath = option("out", "");
const maxTtfb = Number(option("max-ttfb", process.env.PERF_MAX_TTFB_MS ?? 0));
const maxAssets = Number(
  option("max-assets", process.env.PERF_MAX_ASSET_BYTES ?? 0),
);

async function measuredFetch(input, redirects = 0) {
  const url = input instanceof URL ? input : new URL(input);
  const startedAt = performance.now();
  const transport = url.protocol === "http:" ? http : https;
  const result = await new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        headers: {
          "accept-encoding": "gzip, br",
          "user-agent": "backbeat-notes-performance-audit",
        },
      },
      (response) => {
        const headersAt = performance.now();
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            url,
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
            ttfbMs: Number((headersAt - startedAt).toFixed(1)),
            totalMs: Number((performance.now() - startedAt).toFixed(1)),
            transferBytes: body.length,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });

  const location = result.headers.location;
  if (
    location &&
    [301, 302, 303, 307, 308].includes(result.status) &&
    redirects < 5
  ) {
    return measuredFetch(new URL(location, url), redirects + 1);
  }
  return result;
}

function discoverAssets(html, documentUrl) {
  const assets = new Set();
  const pattern = /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g;
  for (const match of html.matchAll(pattern)) {
    const url = new URL(match[1], documentUrl);
    if (url.origin === documentUrl.origin) assets.add(url.href);
  }
  return [...assets];
}

function decodedBody(result) {
  const encoding = result.headers["content-encoding"];
  if (encoding === "br") return brotliDecompressSync(result.body);
  if (encoding === "gzip") return gunzipSync(result.body);
  if (encoding === "deflate") return inflateSync(result.body);
  return result.body;
}

async function auditRoute(route) {
  const url = new URL(route, baseUrl);
  const document = await measuredFetch(url);
  const contentType = document.headers["content-type"] ?? "";
  const assetUrls = contentType.includes("text/html")
    ? discoverAssets(decodedBody(document).toString("utf8"), document.url)
    : [];
  const assets = await Promise.all(
    assetUrls.map(async (assetUrl) => {
      const result = await measuredFetch(assetUrl);
      return {
        url: assetUrl,
        status: result.status,
        transferBytes: result.transferBytes,
        totalMs: result.totalMs,
      };
    }),
  );

  return {
    route,
    finalUrl: document.url.href,
    status: document.status,
    cache:
      document.headers["x-vercel-cache"] ??
      document.headers["x-nextjs-cache"] ??
      null,
    ttfbMs: document.ttfbMs,
    totalMs: document.totalMs,
    htmlTransferBytes: document.transferBytes,
    assetTransferBytes: assets.reduce(
      (total, asset) => total + asset.transferBytes,
      0,
    ),
    assets,
  };
}

const auditedAt = new Date().toISOString();
const results = [];
for (const route of routes) {
  results.push(await auditRoute(route));
}

const report = {
  auditedAt,
  baseUrl: baseUrl.href,
  budgets: {
    maxTtfbMs: maxTtfb || null,
    maxAssetTransferBytes: maxAssets || null,
  },
  routes: results,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(json);
if (outputPath) await writeFile(outputPath, json);

const failures = [];
for (const result of results) {
  if (!result.status || result.status >= 400) {
    failures.push(`${result.route}: HTTP ${result.status}`);
  }
  if (maxTtfb && result.ttfbMs > maxTtfb) {
    failures.push(
      `${result.route}: TTFB ${result.ttfbMs}ms exceeds ${maxTtfb}ms`,
    );
  }
  if (maxAssets && result.assetTransferBytes > maxAssets) {
    failures.push(
      `${result.route}: assets ${result.assetTransferBytes}B exceed ${maxAssets}B`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(`Performance budget failed:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
}
