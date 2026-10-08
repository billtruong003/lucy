#!/usr/bin/env python3
"""PT smoke — bridge token spend parity (DASH-FIX S2). KHÔNG cần Telegram/coordinator thật:
mock HTTP server bắt POST /spend + GET /token-guard. Chạy: python3 smoke_token_parity.py"""
import os, json, time, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

_TMP = tempfile.mkdtemp()
_RECV = []  # các body POST /spend nhận được


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path in ("/spend", "/token-guard/add"):
            _RECV.append(body)
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"configured": True, "status": {
            "ok": True, "soft": False, "hard": False, "used": 12345,
            "softLimit": 500000, "hardLimit": 1000000, "date": "2026-06-15"}}).encode())


_srv = HTTPServer(("127.0.0.1", 0), _H)
_port = _srv.server_address[1]
threading.Thread(target=_srv.serve_forever, daemon=True).start()

os.environ.update({
    "TELEGRAM_BOT_TOKEN": "x:test", "LUCY_ALLOWED_USER_ID": "1",
    "AM_COORD_URL": f"http://127.0.0.1:{_port}", "AM_TOKEN": "tok",
    "LUCY_TG_TOKENS_FILE": os.path.join(_TMP, "tg-tokens.json"),
    "LUCY_TOKEN_REPORT": "1", "CLAUDE_BIN": "true",
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


def _wait_recv(n, timeout=3):
    t0 = time.time()
    while len(_RECV) < n and time.time() - t0 < timeout:
        time.sleep(0.02)


print("PT token parity smoke")

# 1) claude-path: usage kiểu Anthropic — /spend tách inTok 'tươi' + cache read/write riêng
_RECV.clear()
lb.report_tokens({"input_tokens": 100, "output_tokens": 50,
                  "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 200},
                 0.0123)
_wait_recv(1)
ck("claude usage → 1 POST /spend", len(_RECV) == 1)
ck("inTok = input 'tươi' (100)", _RECV and _RECV[0]["inTok"] == 100)
ck("cacheReadTok = cache_read (1000)", _RECV and _RECV[0]["cacheReadTok"] == 1000)
ck("cacheWriteTok = cache_creation (200)", _RECV and _RECV[0]["cacheWriteTok"] == 200)
ck("outTok = output_tokens (50)", _RECV and _RECV[0]["outTok"] == 50)
ck("source = 'bridge'", _RECV and _RECV[0]["source"] == "bridge")

d = lb._load_tg_tokens()
ck("local counter inTok=1300 (gộp cache)", d["inTok"] == 1300)
ck("local counter outTok=50", d["outTok"] == 50)
ck("local cost ~0.0123", abs(d["costUsd"] - 0.0123) < 1e-6)
ck("local turns=1", d["turns"] == 1)

# 2) lane-path: _report_tok(200,80) → /spend (source mặc định 'bridge', cache 0) + counter cộng dồn
_RECV.clear()
lb._report_tok(200, 80)
_wait_recv(1)
ck("lane → POST inTok=200,outTok=80", _RECV and _RECV[0]["inTok"] == 200 and _RECV[0]["outTok"] == 80)
ck("lane cache 0", _RECV and _RECV[0]["cacheReadTok"] == 0 and _RECV[0]["cacheWriteTok"] == 0)
d2 = lb._load_tg_tokens()
ck("lane cộng dồn inTok=1500", d2["inTok"] == 1500)
ck("lane cộng dồn outTok=130", d2["outTok"] == 130)
ck("turns=2 sau lane report", d2["turns"] == 2)

# 3) usage rỗng / 0 → KHÔNG report
_RECV.clear()
lb.report_tokens(None)
lb.report_tokens({"input_tokens": 0, "output_tokens": 0})
lb._report_tok(0, 0)
time.sleep(0.3)
ck("usage rỗng/0 → 0 POST", len(_RECV) == 0)

# 4) flag tắt → không report, không đếm
os.environ["LUCY_TOKEN_REPORT"] = "0"
importlib.reload(lb)
os.environ["LUCY_TG_TOKENS_FILE"] = os.path.join(_TMP, "tg-tokens-off.json")
importlib.reload(lb)
_RECV.clear()
lb.report_tokens({"input_tokens": 999, "output_tokens": 999})
time.sleep(0.3)
ck("flag tắt → 0 POST", len(_RECV) == 0)
ck("flag tắt → counter trống", lb._load_tg_tokens()["inTok"] == 0)
os.environ["LUCY_TOKEN_REPORT"] = "1"
importlib.reload(lb)

# 5) reset theo ngày
stale = {"date": "2000-01-01", "inTok": 5, "outTok": 5, "costUsd": 1.0, "turns": 9}
json.dump(stale, open(os.environ["LUCY_TG_TOKENS_FILE"], "w"))
fresh = lb._load_tg_tokens()
ck("sang ngày mới → reset về 0", fresh["inTok"] == 0 and fresh["turns"] == 0)
ck("date = hôm nay UTC", fresh["date"] == lb._today_utc())

# 6) _sdk_usage rút dict
class _M:
    usage = {"input_tokens": 7, "output_tokens": 3}
ck("_sdk_usage rút dict", lb._sdk_usage(_M()) == {"input_tokens": 7, "output_tokens": 3})
class _M2:
    usage = None
ck("_sdk_usage None khi không có", lb._sdk_usage(_M2()) is None)

print(f"\n{P}/{P+F} PASS" + ("" if F == 0 else f" — {F} FAIL"))
raise SystemExit(1 if F else 0)
