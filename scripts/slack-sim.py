#!/usr/bin/env python3
"""Simulate Slack requests against the local app + stub, and assert behavior.

Prerequisites:
  1. Local Postgres seeded via `pnpm db:seed` (needs the 'My Workspace'
     demo workspace and a 'Welcome…' doc).
  2. A slack_connections row for team T_TEST and a slack_user_links row
     mapping the demo user to U_DEMO (see README → Slack integration).
  3. The stub running:      node scripts/slack-stub.mjs
  4. The app running with:  SLACK_API_BASE=http://localhost:4571 and
     SLACK_SIGNING_SECRET matching SLACK_SIM_SIGNING_SECRET below.

Usage: python3 scripts/slack-sim.py
"""
import hashlib, hmac, json, os, subprocess, time, urllib.parse, urllib.request

APP = os.environ.get("SLACK_SIM_APP", "http://localhost:3000")
STUB = os.environ.get("SLACK_SIM_STUB", "http://localhost:4571")
SECRET = os.environ.get(
    "SLACK_SIM_SIGNING_SECRET", "stub-signing-secret-for-local-tests"
)
TEAM = "T_TEST"
import random
NONCE = f"{random.randrange(16**8):08x}"

DB_URL = os.environ.get(
    "SLACK_SIM_DATABASE_URL", "postgresql://docloom:docloom@localhost:5432/docloom"
)

def psql(q):
    out = subprocess.run(["psql", DB_URL, "-tAc", q], capture_output=True, text=True)
    return out.stdout.strip()

WS = psql("SELECT id FROM workspaces WHERE is_personal=false AND name='My Workspace' LIMIT 1")
DOC = psql(f"SELECT id FROM documents WHERE workspace_id='{WS}' AND archived_at IS NULL AND title LIKE 'Welcome%' LIMIT 1")
TRASHED = psql(f"SELECT id FROM documents WHERE archived_at IS NOT NULL LIMIT 1")
PERSONAL_DOC = psql("SELECT d.id FROM documents d JOIN workspaces w ON w.id=d.workspace_id WHERE w.is_personal LIMIT 1")
print(f"workspace={WS} doc={DOC} trashed={TRASHED or '(none)'} personal={PERSONAL_DOC or '(none)'}")

def sign(body: str, ts: str) -> str:
    base = f"v0:{ts}:{body}".encode()
    return "v0=" + hmac.new(SECRET.encode(), base, hashlib.sha256).hexdigest()

def post(path, body, content_type, ts=None, sig=None):
    ts = ts or str(int(time.time()))
    sig = sig or sign(body, ts)
    req = urllib.request.Request(
        APP + path, data=body.encode(),
        headers={"Content-Type": content_type,
                 "X-Slack-Request-Timestamp": ts,
                 "X-Slack-Signature": sig})
    start = time.time()
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode(), time.time() - start
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), time.time() - start

def stub_calls():
    with urllib.request.urlopen(STUB + "/calls") as resp:
        return json.load(resp)

def reset_stub():
    urllib.request.urlopen(urllib.request.Request(STUB + "/calls", method="DELETE"))

def event_body(event, event_id):
    return json.dumps({
        "type": "event_callback", "team_id": TEAM, "event_id": event_id,
        "event": event,
    })

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("✅" if ok else "❌"), name, detail)

# ---------------------------------------------------------------- 1. challenge
status, body, dur = post("/api/slack/events", json.dumps({"type": "url_verification", "challenge": "chal_123"}), "application/json")
check("url_verification echoes challenge", status == 200 and json.loads(body).get("challenge") == "chal_123", f"({status}, {dur*1000:.0f}ms)")

# ------------------------------------------------------------ 2. bad signature
status, body, dur = post("/api/slack/events", event_body({"type": "link_shared"}, "Evbad"), "application/json", sig="v0=deadbeef" + "0"*56)
check("invalid signature rejected 401", status == 401, f"({status})")

# ------------------------------------------------------- 3. stale timestamp
old_ts = str(int(time.time()) - 600)
b = event_body({"type": "link_shared"}, "Evstale")
status, body, dur = post("/api/slack/events", b, "application/json", ts=old_ts)
check("stale timestamp rejected 401", status == 401, f"({status})")

# ------------------------------------------- 4. link_shared: linked sharer, full card
reset_stub()
ev = {"type": "link_shared", "channel": "C_GENERAL", "message_ts": "111.222",
      "user": "U_DEMO", "links": [{"url": f"{APP}/app/{WS}/docs/{DOC}", "domain": "localhost"}]}
status, body, dur = post("/api/slack/events", event_body(ev, "Ev001-"+NONCE), "application/json")
ack_ms = dur * 1000
time.sleep(2.5)
calls = stub_calls()
unfurls = [c for c in calls if c["method"] == "chat.unfurl"]
ok = len(unfurls) == 1
detail = f"(ack {ack_ms:.0f}ms, {len(unfurls)} unfurl calls)"
if ok:
    payload = json.loads(unfurls[0]["body"]["unfurls"]) if isinstance(unfurls[0]["body"], dict) else {}
    blocks = json.dumps(payload, ensure_ascii=False)
    ok = "Welcome" in blocks and "Open in Docloom" in blocks and "✍️" in blocks
    detail += " full card w/ title+author+button" if ok else f" MISSING content: {blocks[:200]}"
check("link_shared (linked sharer w/ access) → full unfurl", ok and ack_ms < 3000, detail)
check("events ack under 3s", ack_ms < 3000, f"({ack_ms:.0f}ms)")

# --------------------------------------------- 5. duplicate event_id skipped
status, body, dur = post("/api/slack/events", event_body(ev, "Ev001-"+NONCE), "application/json")
time.sleep(1.5)
unfurls = [c for c in stub_calls() if c["method"] == "chat.unfurl"]
check("duplicate event_id not reprocessed", len(unfurls) == 1, f"({len(unfurls)} total unfurl calls)")

# ------------------------------------- 6. unlinked sharer → minimal card
reset_stub()
ev2 = dict(ev, user="U_STRANGER")
status, body, dur = post("/api/slack/events", event_body(ev2, "Ev002-"+NONCE), "application/json")
time.sleep(2)
unfurls = [c for c in stub_calls() if c["method"] == "chat.unfurl"]
ok = len(unfurls) == 1
if ok:
    blocks = json.dumps(unfurls[0]["body"])
    ok = "Welcome" not in blocks and "open it in Docloom to view" in json.loads(unfurls[0]["body"]["unfurls"]) .__str__()
check("link_shared (unlinked sharer) → minimal card, no title leak", ok)

# ------------------------------------- 7. nonexistent doc → minimal card
reset_stub()
ev3 = dict(ev, links=[{"url": f"{APP}/app/{WS}/docs/doesnotexist123", "domain": "localhost"}])
status, body, dur = post("/api/slack/events", event_body(ev3, "Ev003-"+NONCE), "application/json")
time.sleep(2)
unfurls = [c for c in stub_calls() if c["method"] == "chat.unfurl"]
ok = len(unfurls) == 1 and "open it in Docloom to view" in str(unfurls[0]["body"])
check("link_shared (deleted doc) → neutral minimal card", ok)

# -------------------------------- 8. personal notebook doc → minimal card
if PERSONAL_DOC:
    reset_stub()
    pws = psql(f"SELECT workspace_id FROM documents WHERE id='{PERSONAL_DOC}'")
    ev4 = dict(ev, links=[{"url": f"{APP}/app/{pws}/docs/{PERSONAL_DOC}", "domain": "localhost"}])
    status, body, dur = post("/api/slack/events", event_body(ev4, "Ev004-"+NONCE), "application/json")
    time.sleep(2)
    unfurls = [c for c in stub_calls() if c["method"] == "chat.unfurl"]
    ok = len(unfurls) == 1 and "Secret" not in str(unfurls[0]["body"]) and "open it in Docloom to view" in str(unfurls[0]["body"])
    check("link_shared (personal notebook doc) → minimal card, no leak", ok)

# ----------------------------------------------------- 9. app_mention reply
reset_stub()
mention = {"type": "app_mention", "channel": "C_GENERAL", "user": "U_DEMO",
           "text": "<@U_BOT> can you find the welcome doc?", "ts": "333.444"}
status, body, dur = post("/api/slack/events", event_body(mention, "Ev005-"+NONCE), "application/json")
time.sleep(2.5)
posts = [c for c in stub_calls() if c["method"] == "chat.postMessage"]
ok = len(posts) == 1
if ok:
    blocks = str(posts[0]["body"])
    ok = "Welcome" in blocks and posts[0]["body"].get("thread_ts") == "333.444"
check("@docloom mention → threaded reply with doc card", ok, f"(ack {dur*1000:.0f}ms)")

# ------------------------------------ 10. app_mention from unlinked user
reset_stub()
mention2 = dict(mention, user="U_STRANGER")
status, body, dur = post("/api/slack/events", event_body(mention2, "Ev006-"+NONCE), "application/json")
time.sleep(2.5)
posts = [c for c in stub_calls() if c["method"] == "chat.postMessage"]
ok = len(posts) == 1 and "Link my Docloom account" in str(posts[0]["body"]) and "Welcome" not in str(posts[0]["body"])
check("@docloom mention (unlinked) → link-account prompt, no results", ok)

# ------------------------------------------------ 11. /docs slash command
reset_stub()
form = urllib.parse.urlencode({
    "command": "/docs", "text": "welcome", "team_id": TEAM,
    "user_id": "U_DEMO", "channel_id": "C_GENERAL",
    "response_url": f"{STUB}/response_url_docs",
})
status, body, dur = post("/api/slack/commands", form, "application/x-www-form-urlencoded")
ack = json.loads(body)
check("/docs acks fast with placeholder", status == 200 and dur < 3 and "Searching" in ack.get("text", ""), f"({dur*1000:.0f}ms)")
time.sleep(2.5)
responses = [c for c in stub_calls() if c["method"] == "response_url_docs"]
ok = len(responses) == 1
if ok:
    blocks = str(responses[0]["body"])
    ok = "Welcome" in blocks and "Share to channel" in blocks and responses[0]["body"].get("response_type") == "ephemeral"
check("/docs → ephemeral results with share buttons", ok)

# ---------------------------------------- 12. /docs from unlinked user
reset_stub()
form = urllib.parse.urlencode({
    "command": "/docs", "text": "welcome", "team_id": TEAM,
    "user_id": "U_STRANGER", "channel_id": "C_GENERAL",
    "response_url": f"{STUB}/response_url_unlinked",
})
status, body, dur = post("/api/slack/commands", form, "application/x-www-form-urlencoded")
time.sleep(2.5)
responses = [c for c in stub_calls() if c["method"] == "response_url_unlinked"]
ok = len(responses) == 1 and "Link my Docloom account" in str(responses[0]["body"])
check("/docs (unlinked) → link-account button", ok)

# ------------------------------------- 13. interactive: share to channel
reset_stub()
payload = json.dumps({
    "type": "block_actions", "team": {"id": TEAM}, "user": {"id": "U_DEMO"},
    "channel": {"id": "C_ENG"}, "response_url": f"{STUB}/response_url_share",
    "actions": [{"action_id": "share_doc_to_channel", "value": DOC}],
})
form = urllib.parse.urlencode({"payload": payload})
status, body, dur = post("/api/slack/interactive", form, "application/x-www-form-urlencoded")
check("interactive acks 200 fast", status == 200 and dur < 3, f"({dur*1000:.0f}ms)")
time.sleep(2.5)
posts = [c for c in stub_calls() if c["method"] == "chat.postMessage"]
ok = len(posts) == 1 and posts[0]["body"].get("channel") == "C_ENG" and "Welcome" in str(posts[0]["body"])
check("share-to-channel posts rich card to channel", ok)

# ------------------------------------------------------------------- summary
print()
failed = [r for r in results if not r[1]]
print(f"{len(results) - len(failed)}/{len(results)} passed")
exit(1 if failed else 0)
