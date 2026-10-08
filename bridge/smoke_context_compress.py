#!/usr/bin/env python3
"""CC smoke — auto context-compression (claude-path dài → tóm tắt + rollover session mới).
KHÔNG cần Telegram/coordinator thật: mock /llm/models (cho pick_fallback_brain), monkeypatch
run_claude_stream + run_lane + run_claude + Telegram I/O. Chạy: python3 smoke_context_compress.py"""
import os, json, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_TMP = tempfile.mkdtemp()
_HIST = os.path.join(_TMP, "claude-hist.json")

CATALOG = [{"key": "devstral-med", "provider": "mistral", "free": True, "role": "executor"}]
ROUTE_TABLE = {"agentic-code": ["devstral-med"]}
STATE = {"providers": [{"provider": "mistral", "hasKey": True}], "tg_hard": False}


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj):
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())

    def do_GET(self):
        if self.path == "/llm/models":
            return self._json({"catalog": CATALOG, "providers": STATE["providers"],
                               "routeTable": ROUTE_TABLE, "router": "devstral-med"})
        if self.path == "/token-guard":
            return self._json({"configured": True, "status": {"hard": STATE["tg_hard"], "soft": False, "used": 1}})
        return self._json({})

    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        _ = self.rfile.read(n)
        return self._json({"ok": True, "hits": []})


_srv = HTTPServer(("127.0.0.1", 0), _H)
_port = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()

os.environ.update({
    "TELEGRAM_BOT_TOKEN": "x:test", "LUCY_ALLOWED_USER_ID": "1",
    "AM_COORD_URL": f"http://127.0.0.1:{_port}", "AM_TOKEN": "tok",
    "LUCY_RECALL_PREFETCH": "0", "LUCY_EPISODIC": "0", "LUCY_TOKEN_REPORT": "0",
    "CLAUDE_BIN": "true", "LUCY_TG_TOKENS_FILE": os.path.join(_TMP, "tg.json"),
    "LUCY_AUTO_COMPRESS": "1", "LUCY_CLAUDE_HIST_FILE": _HIST,
    "LUCY_COMPRESS_TURN_MAX": "3", "LUCY_COMPRESS_TOKEN_MAX": "100000",
})

import importlib, lucy_bridge as lb  # noqa: E402
importlib.reload(lb)

P = F = 0


def ck(name, cond):
    global P, F
    if cond:
        P += 1; print(f"  ✓ {name}")
    else:
        F += 1; print(f"  ✗ {name}")


# ── spies ──
SENT = []
LANE_CALLS = []
STREAM_PROMPTS = []      # prompt thật gửi vào claude mỗi turn


def _spy_send(chat_id, text): SENT.append(str(text))
def _spy_edit(chat_id, mid, text): SENT.append(str(text))
def _spy_send_id(chat_id, text): SENT.append(str(text)); return 999
def _spy_reply(chat_id, text): SENT.append(str(text))


def _spy_run_lane(prompt, model_key, chat_id=None, persona_id=None):
    LANE_CALLS.append((prompt, model_key))
    return (model_key, "TÓM TẮT: đang bàn BTC + vàng, chủ nhân thích số thật.", None)


def _spy_stream(prompt, session_id, model, persona_text, on_delta, chat_id=None):
    STREAM_PROMPTS.append(prompt)
    return ("sess-" + str(len(STREAM_PROMPTS)), "Trả lời claude bình thường.", [])


lb.send = _spy_send
lb.edit = _spy_edit
lb.send_id = _spy_send_id
lb.reply = _spy_reply
lb.run_lane = _spy_run_lane
lb.run_claude_stream = _spy_stream


def _reset():
    SENT.clear(); LANE_CALLS.clear(); STREAM_PROMPTS.clear()
    try:
        os.remove(_HIST)
    except OSError:
        pass


def _msg(t):
    return {"chat": {"id": 1}, "from": {"id": "1"}, "text": t}


def _hist():
    try:
        return json.load(open(_HIST))
    except Exception:
        return {}


print("CC smoke — auto context-compression")

# ───────────── CC-1: should_compress + buffer append ─────────────
print("CC-1 counter + should_compress")
_reset()
ck("chat chưa có hội thoại → should_compress False", lb.should_compress(1) is False)

lb.claude_hist_append(1, "hỏi A", "đáp A", tokens=10)
e = _hist().get("1", {})
ck("append 1 lượt → 2 message (user+assistant)", len(e.get("buffer", [])) == 2)
ck("counter turns = 1", e.get("turns") == 1)
ck("counter tokens occupancy lượt gần nhất = 10", e.get("tokens") == 10)
ck("buffer giữ đúng nội dung", e["buffer"][0]["text"] == "hỏi A" and e["buffer"][1]["text"] == "đáp A")
ck("chưa vượt ngưỡng (1<3 lượt) → False", lb.should_compress(1) is False)

lb.claude_hist_append(1, "hỏi B", "đáp B", tokens=5)
lb.claude_hist_append(1, "hỏi C", "đáp C", tokens=5)
e = _hist().get("1", {})
ck("3 lượt → turns=3, tokens=5 (occupancy lượt gần nhất, KHÔNG cộng dồn)", e.get("turns") == 3 and e.get("tokens") == 5)
ck("vượt ngưỡng lượt (3>=3) → should_compress True", lb.should_compress(1) is True)

# ngưỡng token
_reset()
lb.claude_hist_append(2, "x", "y", tokens=100000)
ck("1 lượt nhưng token>=ngưỡng → True", lb.should_compress(2) is True)

# flag tắt → luôn False
_reset()
lb.AUTO_COMPRESS = False
lb.claude_hist_append(3, "x", "y", tokens=100000)
ck("AUTO_COMPRESS=off → should_compress luôn False", lb.should_compress(3) is False)
lb.AUTO_COMPRESS = True

# ───────────── CC-2: auto-rollover qua handle() ─────────────
print("CC-2 auto-rollover trong handle()")
_reset()
SESS = {}
# 3 lượt claude bình thường (ngưỡng=3) → lượt thứ 3 kích rollover
lb.handle(_msg("tin 1"), SESS)
ck("lượt 1: KHÔNG rollover, chưa tóm tắt", len(LANE_CALLS) == 0)
ck("lượt 1: session lưu", SESS.get("1") == "sess-1")
lb.handle(_msg("tin 2"), SESS)
ck("lượt 2: vẫn chưa rollover", len(LANE_CALLS) == 0)

lb.handle(_msg("tin 3"), SESS)
ck("lượt 3 vượt ngưỡng → summarizer (run_lane) ĐƯỢC gọi", len(LANE_CALLS) == 1)
ck("rollover → BỎ session cũ (sessions.pop)", "1" not in SESS)
ck("rollover → banner gói gọn", any("gói gọn lại hội thoại" in s for s in SENT))
h1 = _hist().get("1", {})
ck("rollover → counter reset (turns=0)", h1.get("turns") == 0)
ck("rollover → buffer reset (rỗng)", h1.get("buffer") == [])
ck("rollover → seed = summary chờ prepend", "TÓM TẮT" in (h1.get("seed") or ""))

# lượt kế tiếp: seed được prepend vào prompt + session mới sinh
SENT.clear(); LANE_CALLS.clear()
lb.handle(_msg("tin 4 sau khi gói"), SESS)
ck("lượt sau rollover: prompt ĐẦU có seed prepend", "NGỮ CẢNH HỘI THOẠI TRƯỚC" in STREAM_PROMPTS[-1])
ck("lượt sau rollover: seed đã xoá (không prepend lần 2 ngầm)", not (_hist().get("1", {}).get("seed")))
ck("lượt sau rollover: session mới được lưu", SESS.get("1", "").startswith("sess-"))

# ───────────── không vượt ngưỡng → KHÔNG đụng (đường cũ nguyên vẹn) ─────────────
print("CC: dưới ngưỡng → KHÔNG nén")
_reset()
SESS2 = {}
lb.handle(_msg("chào em"), SESS2)
ck("1 lượt < ngưỡng → KHÔNG gọi summarizer", len(LANE_CALLS) == 0)
ck("1 lượt < ngưỡng → KHÔNG banner gói gọn", not any("gói gọn" in s for s in SENT))
ck("1 lượt < ngưỡng → session resume bình thường", SESS2.get("1") == "sess-1")
ck("prompt KHÔNG có seed (chưa rollover)", "NGỮ CẢNH HỘI THOẠI TRƯỚC" not in STREAM_PROMPTS[-1])

# ───────────── /new xoá buffer + counter + seed ─────────────
print("CC: /new dọn sạch claude-hist")
_reset()
lb.claude_hist_append(1, "x", "y", tokens=5)
ck("trước /new: có entry", "1" in _hist())
lb.handle(_msg("/new"), {})
ck("sau /new: entry bị xoá", "1" not in _hist())

print(f"\n{P}/{P+F} PASS" + ("" if F == 0 else f" — {F} FAIL"))
raise SystemExit(1 if F else 0)
