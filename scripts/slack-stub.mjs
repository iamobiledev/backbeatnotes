#!/usr/bin/env node
/**
 * Local Slack API stub for testing the integration without a real Slack
 * workspace (and without ngrok).
 *
 * Usage:
 *   node scripts/slack-stub.mjs [port]           # default 4571
 *
 * Point the app at it with SLACK_API_BASE=http://localhost:4571 and use it
 * as a response_url target in simulated payloads. Inspect what the app sent
 * with GET /calls (JSON) or DELETE /calls to reset.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4571);
const calls = [];

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/calls") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(calls, null, 2));
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/calls") {
      calls.length = 0;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }

    let parsed = body;
    const contentType = req.headers["content-type"] ?? "";
    try {
      if (contentType.includes("json")) parsed = JSON.parse(body);
      else if (contentType.includes("urlencoded")) {
        parsed = Object.fromEntries(new URLSearchParams(body));
      }
    } catch {
      /* keep raw */
    }

    calls.push({
      time: new Date().toISOString(),
      method: url.pathname.replace(/^\//, ""),
      auth: req.headers.authorization ?? null,
      body: parsed,
    });
    console.log(`[slack-stub] ${req.method} ${url.pathname}`);

    // Method-specific canned responses.
    const method = url.pathname.replace(/^\//, "");
    let response = { ok: true };
    if (method === "conversations.list") {
      response = {
        ok: true,
        channels: [
          { id: "C_GENERAL", name: "general", is_archived: false },
          { id: "C_ENG", name: "engineering", is_archived: false },
        ],
        response_metadata: { next_cursor: "" },
      };
    } else if (method === "chat.postMessage") {
      response = { ok: true, ts: `${Date.now() / 1000}`, channel: "C_GENERAL" };
    } else if (method === "oauth.v2.access") {
      response = {
        ok: true,
        access_token: "xoxb-stub-token",
        bot_user_id: "B_STUB",
        scope: "links:read,links:write,chat:write,commands,app_mentions:read",
        team: { id: "T_STUB", name: "Stub Team" },
      };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
});

server.listen(port, () => {
  console.log(`[slack-stub] listening on http://localhost:${port}`);
});
