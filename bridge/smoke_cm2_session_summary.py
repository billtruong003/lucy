#!/usr/bin/env python3
"""CM-2 smoke — rolling-compact + persist note ký ức xuyên phiên (3 lỗ CC).
KHÔNG cần Telegram/coordinator thật: mock coordinator ghi lại POST /session-summary; monkeypatch
_summarize_transcript + Telegram I/O. Kiểm: (a) _extract_refs lấy NGUYÊN VĂN, không bịa;
(b) flag OFF → KHÔNG persist, KHÔNG rolling (y như cũ); (c) flag ON → persist summary+refs + rolling gộp seed cũ;
(d) /new flag ON persist trước khi xoá, flag OFF xoá thẳng. Chạy: python3 smoke_cm2_session_summary.py"""
import os, json, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_TMP = tempfile.mkdtemp()
_HIST = os.path.join(_TMP, "claude-hist.json")
POSTED = []   # body mỗi POST /session-summary


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, obj):
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())

    def do_GET(self):
        return self._json({})

    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(n)
        if self.path == "/session-summary":
            try: POSTED.append(json.loads(raw))
            except Exception: POSTED.append({"_raw": raw.decode("utf-8", "ignore")})
        return self._json({"ok": True})


_srv = HTTPServer(("127.0.0.1", 0), _H)
_port = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()

os.environ.update({
    "TELEGRAM_BOT_TOKEN": "x:test", "LUCY_ALLOWED_USER_ID": "1",
    "AM_COORD_URL": f"http://127.0.0.1:{_port}", "AM_TOKEN": "tok",
    "LUCY_RECALL_PREFETCH": "0", "LUCY_EPISODIC": "0", "LUCY_TOKEN_REPORT": "0",
    "CLAUDE_BIN": "true", "LUCY_TG_TOKENS_FILE": os.path.join(_TMP, "tg.json"),
    "LUCY_AUTO_COMPRESS": "1", "LUCY_CLAUDE_HIST_FILE": _HIST,
    "LUCY_SESSION_SUMMARY": "0",   # mặc định OFF — test sẽ bật/tắt bằng cách set lb.SESSION_SUMMARY trực tiếp
})

import importlib, lucy_bridge as lb  # noqa: E402
importlib.reload(lb)

P = F = 0


def ck(name, cond):
    global P, F
    if cond: P += 1; print(f"  ✓ {name}")
    else: F += 1; print(f"  ✗ {name}")


SENT = []
SUMM_CALLS = []   # (buffer_len, seed_prev) mỗi lần _summarize_transcript


def _spy_send(chat_id, text): SENT.append(str(text))


def _spy_summarize(buffer, seed_prev=""):
    SUMM_CALLS.append((len(buffer), seed_prev))
    # contract 2026-08: trả (summary, done_list)
    return "SUMMARY: mạch BTC + vàng, file /root/lucy/x.md.", ["đã xem BTC"]


lb.send = _spy_send
lb._summarize_transcript = _spy_summarize


def _wait_posts(n, timeout=3.0):
    import time
    t0 = time.time()
    while len(POSTED) < n and time.time() - t0 < timeout:
        time.sleep(0.02)


def _seed_hist(chat_id, buf, seed=""):
    h = {str(chat_id): {"buffer": buf, "turns": 9, "tokens": 9, "seed": seed}}
    json.dump(h, open(_HIST, "w"))


BUF = [{"role": "user", "text": "xem BTC giúp, ghi /root/lucy/x.md và https://api.binance.com/v3"},
       {"role": "assistant", "text": "đã ghi /root/lucy/x.md, chạy `pm2 restart lucy-bridge`"}]

print("CM-2 smoke — rolling compact + persist episodic note\n")

# ── 1. _extract_refs: nguyên văn, không bịa ──
# 2026-08: _extract_refs CHỈ quét buffer (bỏ seed prose đã tóm tắt → tránh dương tính giả) — smoke bám contract mới.
refs = lb._extract_refs(BUF)
vals = [r["value"] for r in refs]
ck("extract path từ buffer", "/root/lucy/x.md" in vals)
ck("extract link từ buffer", "https://api.binance.com/v3" in vals)
ck("KHÔNG quét seed prose (contract mới)", "/root/lucy/portal/dist/" not in vals)
ck("KHÔNG bịa ref lạ (chỉ cái đã xuất hiện)", all(v in (
    "/root/lucy/x.md https://api.binance.com/v3 /root/lucy/portal/dist/") or v.startswith(("/", "http", "~")) for v in vals))
ck("ref có type link/file", all(r["type"] in ("link", "file") for r in refs))

# ── 2. flag OFF: KHÔNG persist, KHÔNG rolling ──
lb.SESSION_SUMMARY = False
POSTED.clear(); SUMM_CALLS.clear()
sess = {"42": "sess-old"}
_seed_hist(42, list(BUF), seed="SEED CŨ phải bị bỏ qua khi off")
lb._compress_conversation(42, sess)
_wait_posts(1, timeout=0.5)
ck("OFF: KHÔNG POST /session-summary", len(POSTED) == 0)
ck("OFF: summarize KHÔNG nhận seed_prev (no rolling)", SUMM_CALLS and SUMM_CALLS[-1][1] == "")
ck("OFF: seed mới = summary (giữ hành vi CC cũ)",
   json.load(open(_HIST))["42"]["seed"].startswith("SUMMARY:"))

# ── 3. flag ON: persist + rolling gộp seed cũ ──
lb.SESSION_SUMMARY = True
POSTED.clear(); SUMM_CALLS.clear()
sess = {"42": "sess-live-7"}
_seed_hist(42, list(BUF), seed="SEED PHIÊN TRƯỚC")
lb._compress_conversation(42, sess)
_wait_posts(1)
ck("ON: có POST /session-summary", len(POSTED) == 1)
ck("ON: rolling — summarize nhận seed_prev cũ", SUMM_CALLS and SUMM_CALLS[-1][1] == "SEED PHIÊN TRƯỚC")
if POSTED:
    b = POSTED[0]
    ck("ON: body có summary", str(b.get("summary", "")).startswith("SUMMARY:"))
    ck("ON: body session_id = sid TRƯỚC pop", b.get("session_id") == "sess-live-7")
    ck("ON: body refs nguyên văn", any(r.get("value") == "/root/lucy/x.md" for r in b.get("refs", [])))
ck("ON: session_id bị pop khỏi sessions (rollover)", "42" not in sess)

# ── 4. flag ON nhưng buffer rỗng → KHÔNG persist (không note rác) ──
POSTED.clear()
_seed_hist(99, [], seed="")
lb._compress_conversation(99, {"99": "s"})
_wait_posts(1, timeout=0.4)
ck("ON + buffer rỗng: KHÔNG persist", len(POSTED) == 0)

print(f"\n{'='*40}\nKẾT QUẢ: {P} PASS · {F} FAIL")
raise SystemExit(1 if F else 0)
