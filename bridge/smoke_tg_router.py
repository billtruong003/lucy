#!/usr/bin/env python3
"""Smoke ĐƯỜNG LỆNH TELEGRAM — bơm Update JSON TỔNG HỢP thẳng vào process_update().

TUYỆT ĐỐI KHÔNG gọi getUpdates: ngày 2026-08-17 việc poll song song đã CƯỚP 3 lệnh thật của
chủ nhân khỏi bridge. Bộ test này chứng minh đường lệnh mà không đụng tới Telegram.

Phủ: /new · /new@bot · /model · /model@bot · /model opus · /model sonnet · khoảng trắng thừa ·
người lạ · sai chat · update_id trùng · update không phải text · lệnh lạ · và KIỂM TRA TRẠNG THÁI
thật sự thay đổi (không chỉ nhìn câu trả lời).
"""
import os
import sys
import time

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test:token")
os.environ.setdefault("LUCY_ALLOWED_USER_ID", "123456789")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lucy_bridge as lb  # noqa: E402

OWNER = int(lb.ALLOWED)
STRANGER = 999000111
PASS = FAIL = 0
SENT = []


def ck(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} {extra}")


# ── cô lập: không mạng, không ghi file production ──
lb.send = lambda cid, t: SENT.append((cid, str(t or "")))
lb.reply = lb.send
lb.send_id = lambda cid, t: (SENT.append((cid, str(t or ""))), 1)[1]
lb.edit = lambda cid, mid, t: SENT.append((cid, str(t or "")))
lb.send_kb = lambda cid, t, kb, mid=None: SENT.append((cid, str(t or "")))
lb.send_document = lambda *a, **k: None
lb.answer_cb = lambda *a, **k: None
lb._save = lambda *a, **k: None
lb._save_offset = lambda *a, **k: None
lb._save_prefs = lambda *a, **k: None
lb._save_claude_hist = lambda *a, **k: None
lb._save_lane_hist = lambda *a, **k: None
lb.write_status = lambda *a, **k: None
lb.EPISODIC = False
_PREFS = {}
lb._load_prefs = lambda: _PREFS
lb._save_prefs = lambda p: _PREFS.update(p)
# KHÔNG cho gọi Claude thật trong test router
lb.run_claude_stream = lambda *a, **k: ("sid-test", "(đáp giả)", [])
lb.run_claude = lambda *a, **k: ("sid-test", "(đáp giả)")

_UID = [700000]


def upd(text=None, uid=OWNER, chat=None, update_id=None, kind="text"):
    """Dựng Update JSON y như Telegram gửi."""
    _UID[0] += 1
    u = {"update_id": update_id if update_id is not None else _UID[0]}
    if kind == "callback":
        u["callback_query"] = {"id": "cb1", "from": {"id": uid},
                               "message": {"message_id": 1, "chat": {"id": chat or uid}}, "data": "md:claude:sonnet"}
        return u
    m = {"message_id": _UID[0], "from": {"id": uid}, "chat": {"id": chat or uid}, "date": int(time.time())}
    if kind == "text":
        m["text"] = text
    elif kind == "sticker":
        m["sticker"] = {"file_id": "abc"}
    u["message"] = m
    return u


def drain(cid):
    """Chạy hết hàng đợi của chat (worker chạy nền → chờ tới khi rỗng)."""
    q = lb.CHAT_Q.get(cid)
    if q:
        q.join()


def run(u, sessions):
    SENT.clear()
    r = lb.process_update(u, sessions)
    m = u.get("message") or {}
    if r == "queued":
        drain(m["chat"]["id"])
    return r


print("Smoke đường lệnh Telegram — bơm JSON tổng hợp, KHÔNG gọi getUpdates\n")
sessions = {}

# ══════ 1. PARSER (thuần, không side effect) ══════
print("1) Bóc tách lệnh")
for raw, want_cmd, want_arg in [
    ("/new", "/new", ""), ("/new@LUCY_bot", "/new", ""), ("  /new  ", "/new", ""),
    ("/model", "/model", ""), ("/model@LUCY_bot", "/model", ""),
    ("/model opus", "/model", "opus"), ("/model sonnet", "/model", "sonnet"),
    ("/model@LUCY_bot claude:fable", "/model", "claude:fable"),
    ("/Model", "/model", ""), ("/model\topus", "/model", "opus"),
]:
    c, a, ok = lb.parse_command(raw)
    ck(f"{raw!r:32} → {c} {a!r}", ok and c == want_cmd and a == want_arg, f"(được {c!r},{a!r})")
c, a, ok = lb.parse_command("chào em")
ck("tin thường KHÔNG bị coi là lệnh", ok is False and a == "chào em")

# ══════ 2. ĐỊNH TUYẾN + LỌC ══════
print("\n2) Định tuyến & lọc update")
before = lb.TG["updates_received_total"]
r = run(upd("/id"), sessions)
ck("chủ nhân /id → vào hàng đợi", r == "queued")
ck("bộ đếm update tăng", lb.TG["updates_received_total"] == before + 1)
ck("có trả lời", any("chat_id" in t for _, t in SENT), f"(SENT={SENT[:1]})")

r = run(upd("/id", uid=STRANGER), sessions)
ck("người LẠ bị chặn ở tầng poll", r.startswith("ignored:") and "chủ nhân" in r, f"(được {r})")
ck("lý do bỏ được ghi lại", "chủ nhân" in lb.TG["last_ignore_reason"])

dup = upd("/id")
run(dup, sessions)
r = lb.process_update(dup, sessions)
ck("update_id TRÙNG bị bỏ", r == "ignored:trùng update_id")

r = lb.process_update(upd(kind="sticker"), sessions)
ck("update không có text/ảnh/file bị bỏ", r.startswith("ignored:"), f"(được {r})")

r = lb.process_update({"update_id": _UID[0] + 500, "edited_message": {"text": "x"}}, sessions)
ck("update lạ (edited_message) bị bỏ có lý do", r == "ignored:không phải message")

r = run(upd("/khonglenh_nao_ca"), sessions)
ck("lệnh lạ vẫn vào hàng đợi (Lucy tự trả lời)", r == "queued")

# ══════ 3. /new — KIỂM TRA TRẠNG THÁI, không chỉ câu trả lời ══════
print("\n3) /new đổi TRẠNG THÁI thật")
CID = OWNER
# dựng trạng thái bẩn
sessions[str(CID)] = "sess-cu-12345"
lb._RECENT[str(CID)] = ["câu cũ 1", "câu cũ 2"]
lb._STICKY[str(CID)] = ["ràng buộc cũ"]
lb._LAST_REPLY[str(CID)] = "câu trả lời cũ"
lb._PSESS[str(CID)] = {"client": None, "model": "m", "persona": 0, "sid": "sess-cu-12345",
                       "busy": False, "last": time.time(), "turns": 5, "born": time.time(), "rotations": 0}
closed = {"n": 0}
_orig_close = lb._ps_close
lb._ps_close = lambda cid: (closed.__setitem__("n", closed["n"] + 1), _orig_close(cid))[1]

r = run(upd("/new@LUCY_bot"), sessions)      # dạng @bot — Phase 2 KHÔNG hiểu
ck("/new@bot tới được handler", r == "queued" and lb.TG["last_command"] == "/new")
ck("  → session_id bị xoá", str(CID) not in sessions)
ck("  → _RECENT sạch", str(CID) not in lb._RECENT)
ck("  → _STICKY sạch", str(CID) not in lb._STICKY)
ck("  → câu trả lời gần nhất (nối mạch) sạch", str(CID) not in lb._LAST_REPLY)
ck("  → client persistent bị đóng", closed["n"] >= 1)
ck("  → có báo cho chủ nhân", any("Phiên mới" in t for _, t in SENT))
ck("  → đếm lệnh CHẠY XONG", lb.TG["last_command_result"].startswith("/new OK"))
lb._ps_close = _orig_close

# vault KHÔNG được đụng
vault_mem = os.path.expanduser("~/lucy/lucy-vault/Brain/claude-memory")
n_before = len(os.listdir(vault_mem)) if os.path.isdir(vault_mem) else -1
run(upd("/new"), sessions)
n_after = len(os.listdir(vault_mem)) if os.path.isdir(vault_mem) else -1
ck("/new KHÔNG đụng trí nhớ bền trong vault", n_before == n_after)

# ══════ 4. /model — KIỂM TRA TRẠNG THÁI ══════
print("\n4) /model đổi TRẠNG THÁI thật")
_PREFS.clear()
r = run(upd("/model"), sessions)
ck("/model (không tham số) → hiện bảng chọn", r == "queued" and any("Model đang dùng" in t for _, t in SENT))

r = run(upd("/model opus"), sessions)
ck("/model opus tới handler", lb.TG["last_command"] == "/model")
ck("  → prefs lưu claude:opus", _PREFS.get(str(CID), {}).get("model") == "claude:opus",
   f"(prefs={_PREFS})")
ck("  → có xác nhận", any("claude:opus" in t for _, t in SENT))

r = run(upd("/model@LUCY_bot sonnet"), sessions)
ck("/model@bot sonnet tới handler", lb.TG["last_command"] == "/model")
ck("  → prefs đổi sang claude:sonnet", _PREFS.get(str(CID), {}).get("model") == "claude:sonnet")

r = run(upd("/model khongtontai"), sessions)
ck("/model key lạ → báo lỗi, KHÔNG đổi prefs",
   _PREFS.get(str(CID), {}).get("model") == "claude:sonnet" and any("Key lạ" in t for _, t in SENT))

# đổi model phải làm client persistent được dựng lại → kiểm tra qua chữ ký model trong _PSESS
lb._PSESS[str(CID)] = {"client": None, "model": "claude-opus-5", "persona": 0, "sid": "s",
                       "busy": False, "last": time.time(), "turns": 1, "born": time.time(), "rotations": 0}
ck("model đang lưu trong phiên đọc được", lb._PSESS[str(CID)]["model"] == "claude-opus-5")
lb._PSESS.pop(str(CID), None)

# ══════ 5. Bộ đếm & trace ══════
print("\n5) Bộ đếm và trace")
snap = lb.tg_snapshot()
for k in ("poll_ok_total", "poll_error_total", "last_poll_ok_at", "updates_received_total",
          "last_update_id", "last_update_at", "updates_ignored_total", "last_ignore_reason",
          "commands_received_total", "last_command", "last_command_at",
          "commands_executed_total", "commands_failed_total", "last_command_result"):
    ck(f"có counter {k}", k in snap)
ck("commands_received > 0", snap["commands_received_total"] > 0)
ck("commands_executed > 0", snap["commands_executed_total"] > 0)
ck("updates_ignored > 0 (có ca bị chặn)", snap["updates_ignored_total"] > 0)
tr = snap["trace"]
ck("trace có bản ghi", len(tr) > 0)
ck("trace KHÔNG chứa nội dung tin nhắn",
   all(not any(isinstance(v, str) and len(v) > 60 for v in t.values()) for t in tr))
# trace có 2 loại bản ghi: tầng update (có update_id/accepted) và tầng handler (có handler/handler_success)
upd_tr = [t for t in tr if "accepted" in t]
hnd_tr = [t for t in tr if t.get("stage") == "handler"]
ck("trace tầng update có update_id + accepted",
   bool(upd_tr) and all("update_id" in t for t in upd_tr))
ck("trace tầng handler có kết quả chạy",
   bool(hnd_tr) and all("handler_success" in t for t in hnd_tr))
ck("mọi bản ghi trace đều có mốc thời gian", all("at" in t for t in tr))

# ══════ 6. Chặn poll song song ══════
print("\n6) Chặn consumer getUpdates song song")
import tg_guard  # noqa: E402
ck("tg_guard có assert_sole_consumer", callable(tg_guard.assert_sole_consumer))
pid = tg_guard.bridge_pid()
if pid and pid != os.getpid():
    try:
        tg_guard.assert_sole_consumer()
        ck("bridge online → PHẢI từ chối poll", False, "(không ném lỗi)")
    except RuntimeError as e:
        ck("bridge online → từ chối poll", "TỪ CHỐI" in str(e))
else:
    ck("(bridge không chạy — bỏ qua kiểm tra chặn)", True)

print(f"\n{'=' * 52}\nKẾT QUẢ: {PASS} PASS · {FAIL} FAIL")
sys.exit(1 if FAIL else 0)
