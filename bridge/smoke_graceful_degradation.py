#!/usr/bin/env python3
"""GD smoke — graceful degradation (Claude hết cửa → lane free). KHÔNG cần Telegram/coordinator thật:
mock HTTP server cho /llm/models + /token-guard + /recall + /episodic; monkeypatch run_claude_stream + run_lane + Telegram I/O.
Chạy: python3 smoke_graceful_degradation.py"""
import os, json, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_TMP = tempfile.mkdtemp()

# trạng thái mock có thể đổi giữa các test
STATE = {
    "providers": [
        {"provider": "mistral", "hasKey": True},
        {"provider": "openrouter", "hasKey": True},
        {"provider": "deepseek", "hasKey": True},
        {"provider": "google", "hasKey": True},
    ],
    "tg_hard": False,
}
CATALOG = [
    {"key": "devstral-med", "provider": "mistral", "free": True, "role": "executor"},
    {"key": "or-nemotron-super", "provider": "openrouter", "free": True, "role": "reasoning"},
    {"key": "ds-v4-flash-free", "provider": "deepseek", "free": True, "role": "reasoning"},
    {"key": "gemini-flash", "provider": "google", "free": False, "role": "content"},
]
ROUTE_TABLE = {
    "agentic-code": ["devstral-med", "or-nemotron-super"],
    "reasoning": ["ds-v4-flash-free", "or-nemotron-super"],
}


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj):
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())

    def do_GET(self):
        if self.path == "/llm/models":
            return self._json({"catalog": CATALOG, "providers": STATE["providers"],
                               "routeTable": ROUTE_TABLE, "router": "or-nemotron-super"})
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
    # CC: cô lập khỏi GD — không auto-compress, buffer ghi file tạm (đừng đụng ~/.lucy-claude-history.json)
    "LUCY_AUTO_COMPRESS": "0", "LUCY_CLAUDE_HIST_FILE": os.path.join(_TMP, "claude-hist.json"),
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


# ── Telegram I/O + lane spies ──
SENT = []          # mọi text gửi/edit/reply ra Telegram
LANE_CALLS = []    # (prompt, model_key) mỗi lần run_lane bị gọi


def _spy_send(chat_id, text): SENT.append(str(text))
def _spy_edit(chat_id, mid, text): SENT.append(str(text))
def _spy_send_id(chat_id, text): SENT.append(str(text)); return 999
def _spy_reply(chat_id, text): SENT.append(str(text))


def _spy_run_lane(prompt, model_key, chat_id=None, persona_id=None):
    LANE_CALLS.append((prompt, model_key))
    return (model_key, "Câu trả lời lane dự phòng.", None)


lb.send = _spy_send
lb.edit = _spy_edit
lb.send_id = _spy_send_id
lb.reply = _spy_reply
lb.run_lane = _spy_run_lane


def _reset():
    SENT.clear(); LANE_CALLS.clear()


print("GD smoke — graceful degradation")

# ───────────────── GD-1: pick_fallback_brain ─────────────────
print("GD-1 pick_fallback_brain")

# 1) đủ key → con đầu agentic-code (devstral-med), deterministic
STATE["providers"] = [{"provider": p, "hasKey": True} for p in ("mistral", "openrouter", "deepseek", "google")]
ck("đủ key → devstral-med (đầu agentic-code)", lb.pick_fallback_brain() == "devstral-med")

# 2) chỉ deepseek còn key → bỏ qua devstral/nemotron → ds-v4-flash-free
STATE["providers"] = [{"provider": "deepseek", "hasKey": True},
                      {"provider": "mistral", "hasKey": False},
                      {"provider": "openrouter", "hasKey": False}]
ck("chỉ deepseek → ds-v4-flash-free", lb.pick_fallback_brain() == "ds-v4-flash-free")

# 3) hết sạch key → None
STATE["providers"] = [{"provider": "mistral", "hasKey": False}, {"provider": "google", "hasKey": False}]
ck("hết sạch key → None", lb.pick_fallback_brain() is None)

# 4) providers rỗng → None
STATE["providers"] = []
ck("providers rỗng → None", lb.pick_fallback_brain() is None)

# 5) deterministic — gọi lại cùng input cho cùng kết quả
STATE["providers"] = [{"provider": p, "hasKey": True} for p in ("mistral", "openrouter", "deepseek")]
ck("deterministic (gọi 2 lần = nhau)", lb.pick_fallback_brain() == lb.pick_fallback_brain() == "devstral-med")

# ───────────────── helpers: _claude_exhausted / _token_guard_hard ─────────────────
print("GD-2 helpers")
ck("exhausted: 'usage limit'", lb._claude_exhausted("❌ Claude lỗi: usage limit reached"))
ck("exhausted: 'rate_limit_error'", lb._claude_exhausted("rate_limit_error: slow down"))
ck("exhausted: '429'", lb._claude_exhausted("HTTP 429 Too Many Requests"))
ck("exhausted: 'extra usage'", lb._claude_exhausted("you have extra usage charges"))
ck("exhausted: 'quota'", lb._claude_exhausted("quota exceeded"))
ck("KHÔNG exhausted: câu trả lời thường", not lb._claude_exhausted("BTC đang quanh 65k, RSI 58."))
ck("KHÔNG exhausted: rỗng", not lb._claude_exhausted(""))

STATE["tg_hard"] = True
ck("token_guard_hard True khi hard", lb._token_guard_hard() is True)
STATE["tg_hard"] = False
ck("token_guard_hard False khi chưa hard", lb._token_guard_hard() is False)

# ───────────────── GD-2: nhánh fallback trong handle() ─────────────────
print("GD-2 handle() fallback")
STATE["providers"] = [{"provider": p, "hasKey": True} for p in ("mistral", "openrouter", "deepseek")]
SESS = {}


def _msg(t):
    return {"chat": {"id": 1}, "from": {"id": "1"}, "text": t}


# A) claude HẾT-CỬA → đi lane + banner
_reset(); STATE["tg_hard"] = False
lb.run_claude_stream = lambda *a, **k: (None, "❌ Claude lỗi (SDK): rate_limit_error 429 usage limit", [])
lb.handle(_msg("phân tích BTC giúp em"), SESS)
ck("claude hết cửa → run_lane được gọi", len(LANE_CALLS) == 1)
ck("lane dùng model fallback (devstral-med)", LANE_CALLS and LANE_CALLS[0][1] == "devstral-med")
ck("có banner 'Claude hết token'", any("Claude hết token" in s for s in SENT))
ck("trả câu lane dự phòng", any("lane dự phòng" in s for s in SENT))

# B) claude OK → KHÔNG fallback (đường thường nguyên vẹn)
_reset()
lb.run_claude_stream = lambda *a, **k: ("sess-1", "BTC quanh 65k, xu hướng tăng nhẹ.", [])
lb.handle(_msg("phân tích BTC giúp em"), SESS)
ck("claude OK → KHÔNG gọi lane", len(LANE_CALLS) == 0)
ck("claude OK → KHÔNG banner", not any("Claude hết token" in s for s in SENT))
ck("claude OK → hiện câu trả lời thật", any("BTC quanh 65k" in s for s in SENT))
ck("claude OK → lưu session", SESS.get("1") == "sess-1")

# C) token-guard hard-limit → tụt thẳng lane, KHÔNG gọi claude
_reset(); STATE["tg_hard"] = True
_called = {"claude": False}
def _trap(*a, **k):
    _called["claude"] = True
    return ("sess-x", "không nên tới đây", [])
lb.run_claude_stream = _trap
lb.handle(_msg("xin chào"), SESS)
ck("hard-limit → KHÔNG gọi claude_stream", _called["claude"] is False)
ck("hard-limit → run_lane được gọi", len(LANE_CALLS) == 1)
ck("hard-limit → có banner", any("Claude hết token" in s for s in SENT))
STATE["tg_hard"] = False

# D) claude hết cửa NHƯNG không lane nào còn cửa → giữ nguyên lỗi claude (đường thường)
_reset(); STATE["providers"] = []
lb.run_claude_stream = lambda *a, **k: (None, "❌ Claude lỗi (SDK): usage limit", [])
lb.handle(_msg("hello"), SESS)
ck("không lane nào còn cửa → KHÔNG gọi lane", len(LANE_CALLS) == 0)
ck("không lane → vẫn hiện lỗi claude gốc", any("usage limit" in s for s in SENT))

print(f"\n{P}/{P+F} PASS" + ("" if F == 0 else f" — {F} FAIL"))
raise SystemExit(1 if F else 0)
