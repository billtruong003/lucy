#!/usr/bin/env python3
"""Smoke Đường C (persistent client) — OFFLINE, không mạng, không claude thật.
Kiểm: dispatcher flags, interrupt_chat khi không có session, _ps_close idempotent,
run_claude_stream định tuyến persist theo chat_id, fallback one-shot khi persist nổ."""
import os, sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test:token")
os.environ.setdefault("LUCY_ALLOWED_USER_ID", "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lucy_bridge as lb

PASS = FAIL = 0
def ck(name, cond):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {name}")
    else: FAIL += 1; print(f"  ✗ {name}")

print("Đường C smoke — persistent engine (offline)\n")

# ── 1. dispatcher flags ──
ck("engine mặc định = persist", lb._ENGINE == "persist" or os.environ.get("LUCY_BRIDGE_ENGINE"))
ck("_USE_PERSIST bật khi có SDK + engine persist", lb._USE_PERSIST == (lb._HAS_SDK and lb._ENGINE not in ("sdk", "spawn")))
ck("strict-mcp mặc định (LUCY_CHAT_MCP off)", lb._CHAT_MCP is False or os.environ.get("LUCY_CHAT_MCP"))

# ── 2. interrupt/close khi KHÔNG có session: an toàn, không nổ ──
ck("interrupt_chat chat lạ → False", lb.interrupt_chat("khong-ton-tai") is False)
lb._ps_close("khong-ton-tai")
ck("_ps_close chat lạ → không nổ", True)

# ── 3. interrupt chỉ khi busy ──
lb._PSESS["c1"] = {"client": None, "busy": False, "last": 0, "model": "m", "persona": 0, "sid": None}
ck("session rảnh → không ngắt", lb.interrupt_chat("c1") is False)
del lb._PSESS["c1"]

# ── 4. run_claude_stream định tuyến: có chat_id → persist; không chat_id → one-shot ──
calls = []
_orig_persist, _orig_sdk = lb._run_claude_stream_persist, lb._run_claude_stream_sdk
lb._run_claude_stream_persist = lambda cid, p, s, m, pt, cb: (calls.append("persist"), ("sid-p", "ans", []))[1]
lb._run_claude_stream_sdk = lambda p, s, m, pt, cb: (calls.append("sdk"), ("sid-s", "ans", []))[1]
if lb._USE_PERSIST:
    lb.run_claude_stream("hi", None, "sonnet", None, lambda a: None, chat_id="42")
    ck("chat_id → đường persist", calls[-1] == "persist")
    lb.run_claude_stream("hi", None, "sonnet", None, lambda a: None)
    ck("không chat_id → one-shot sdk", calls[-1] == "sdk")
else:
    ck("(bỏ qua — persist off)", True); ck("(bỏ qua)", True)
lb._run_claude_stream_persist, lb._run_claude_stream_sdk = _orig_persist, _orig_sdk

# ── 5. persist nổ → fallback one-shot (chat không chết) ──
def _boom(*a, **k): raise RuntimeError("client chết")
lb._run_claude_stream_sdk = lambda p, s, m, pt, cb: ("sid-fb", "fallback-ans", [])
_orig_open = lb._ps_open
lb._ps_open = _boom
sid, ans, think = lb._run_claude_stream_persist("c-fb", "hi", None, "sonnet", None, lambda a: None)
ck("persist lỗi → fallback trả kết quả one-shot", ans == "fallback-ans" and sid == "sid-fb")
ck("session hỏng bị dọn khỏi _PSESS", "c-fb" not in lb._PSESS)
lb._ps_open = _orig_open
lb._run_claude_stream_sdk = _orig_sdk

# ── 6. _sdk_opts strict-mcp ──
if lb._HAS_SDK and not lb._CHAT_MCP:
    o = lb._sdk_opts("claude-sonnet-5", None, None, True)
    ck("opts có strict_mcp_config", getattr(o, "strict_mcp_config", False) is True)
    ck("opts mcp_servers rỗng", getattr(o, "mcp_servers", None) == {})
else:
    ck("(bỏ qua — SDK/MCP flag)", True); ck("(bỏ qua)", True)

print(f"\n{'=' * 40}\nKẾT QUẢ: {PASS} PASS · {FAIL} FAIL")
sys.exit(1 if FAIL else 0)
