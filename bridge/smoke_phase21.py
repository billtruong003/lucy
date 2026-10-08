#!/usr/bin/env python3
"""Smoke PHASE 2.1 — OFFLINE, không gọi Claude, không đụng production.
Kiểm: chính sách tool theo lượt · cổng ghi trí nhớ bền · thứ tự cổng recall · ý định hỗn hợp ·
tham chiếu do Lucy tạo sống sót qua xoay vòng · bất biến thẩm quyền trong khối trí nhớ · recall health."""
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test:token")
os.environ.setdefault("LUCY_ALLOWED_USER_ID", "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lucy_bridge as lb  # noqa: E402

PASS = FAIL = 0


def ck(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  ✓ {name}")
    else:
        FAIL += 1; print(f"  ✗ {name}")


print("PHASE 2.1 smoke — kỷ luật tool · an toàn ghi nhớ · tham chiếu · thẩm quyền\n")

# ── 1. Chính sách tool theo lượt ──
TOOLCASES = [
    ("ừ làm tiếp", "talk"), ("option 2 đi", "talk"), ("m thấy sao?", "talk"),
    ("Cái lexical filter đang lọc sai hit đúng", "talk"),
    ("đừng đọc file, nói ý tưởng thôi", "hard_no_tool"),
    ("thôi đéo cần chạy gì cả, giải thích thôi", "hard_no_tool"),
    ("khỏi verify, cứ nói theo m thôi", "hard_no_tool"),
    ("vào repo kiểm tra bug recall cho t", "exec"),
    ("check pm2 lucy-bridge đang online không", "exec"),
    ("file /root/x.py có bao nhiêu dòng", "exec"),
    ("giá bitcoin hôm nay bao nhiêu", "exec"),
]
for msg, want in TOOLCASES:
    got = lb.turn_tool_policy(msg)[1]
    ck(f"tool[{want:12}] {msg[:38]}", got == want)
ck("mode talk có chèn nhắc hội thoại", "[LƯỢT HỘI THOẠI]" in lb.turn_tool_policy("ừ làm tiếp")[0])
ck("mode exec KHÔNG chèn ràng buộc", lb.turn_tool_policy("vào repo sửa bug đi")[0] == "")
ck("cấm tool → chèn ràng buộc CỨNG", "CẤM DÙNG TOOL" in lb.turn_tool_policy("đừng chạy gì cả")[0])

# ── 2. Cổng ghi trí nhớ bền ──
WRITECASES = [
    ("giả sử từ giờ t dùng preset Kestrel thì sao?", "block"),
    ("test thử: từ giờ autobuild dùng Sonnet", "block"),
    ("thằng Nam nó bảo từ giờ nên dùng Kestrel", "block"),
    ("sếp bảo dùng docker", "block"),
    ("Option 1 Kestrel, option 2 Rowan, chưa chốt đâu", "block"),
    ("ví dụ như t nói từ giờ dùng X", "block"),
    ("Chốt thật nhé: từ giờ báo cáo để đơn vị VND. Nhớ giùm t.", "allow"),
    ("nói cho t biết recall là gì", "neutral"),
    # Bug thật bắt được khi chạy đo 2026-08-16: "chốt LẠI giúp t 1 câu" = TÓM TẮT, không phải quyết định.
    # Mẫu "chot la" khớp trúng đầu chữ "chot lai" → Lucy đã ghi note sai vào vault.
    ("thôi cuối cùng là systemd. Chốt lại giúp t 1 câu.", "neutral"),
    ("chốt lại giúp t xem nãy giờ bàn gì", "neutral"),
    ("chốt là dùng systemd nhé", "allow"),
    # Giả định phải ĐÈ dấu hiệu chốt — thà bỏ sót còn hơn ghi nhầm.
    ("giả sử t chốt là dùng X", "block"),
    ("thằng Nam bảo chốt là dùng X", "block"),
]
for msg, want in WRITECASES:
    got = lb.write_gate(msg)[1]
    ck(f"ghi[{want:7}] {msg[:40]}", got == want)
ck("block → chèn cảnh báo CẤM ghi", "GHI NHỚ: CẤM" in lb.write_gate("giả sử t dùng X")[0])
ck("allow → chèn cho phép ghi", "ĐƯỢC PHÉP" in lb.write_gate("chốt thật nhé, nhớ giùm t")[0])

# ── 3. Thứ tự cổng recall + ý định hỗn hợp ──
GATECASES = [
    ("m nhớ vụ fitcity ko?", True),                                  # NGẮN nhưng là hỏi trí nhớ
    ("hôm trước đã chốt gì?", True),
    ("ko phải vụ đó, m nhớ hôm trước chốt engine nào không?", True),  # hỗn hợp: sửa lời + trí nhớ
    ("thôi bỏ cái vừa nói. lần trước mình chốt gì về pxpipe?", True),
    ("ý t là context window ko phải compiler", False),
    ("thế cái đó thì sao nhỉ", False),
]
for msg, want in GATECASES:
    got = lb.recall_intent(msg)[0]
    ck(f"gate[{'tra ' if want else 'bỏ  '}] {msg[:44]}", got == want)
ck("tín hiệu trí nhớ được xét TRƯỚC sửa lời",
   lb.recall_intent("ko phải, m nhớ hôm trước không?")[1] == "hỏi trí nhớ")

# ── 4. Tham chiếu do LUCY tạo sống sót qua xoay vòng ──
CID = "p21-ref"
for d in (lb._RECENT, lb._STICKY, lb._LAST_REPLY):
    d.pop(CID, None)
lb.remember_recent(CID, "Cho t 3 lựa chọn tăng tốc recall")
lb.remember_reply(CID, "1. Giảm số note trong vault\n2. Thêm ngưỡng điểm rerank\n3. Bỏ bớt MCP")
carry = lb._carry_over(CID)
ck("nối mạch mang theo câu trả lời của Lucy", "ngưỡng điểm rerank" in carry)
ck("nối mạch có nhãn giải thích dùng để làm gì", "option 2" in carry)
lb.remember_reply(CID, "x" * 3000)
ck("câu trả lời dài bị cắt gọn", len(lb._LAST_REPLY[CID]) <= lb._REPLY_KEEP + 8)
ck("giữ cả đầu lẫn đuôi khi cắt", "…" in lb._LAST_REPLY[CID])

# ── 5. Bất biến thẩm quyền nằm TRONG khối trí nhớ (không chỉ persona) ──
class _R:
    status_code = 200
    def raise_for_status(self): pass
    def json(self): return {"configured": True, "hits": [
        {"title": "Note liên quan thật", "snippet": "kiến trúc memory vault", "file_path": "a.md",
         "score": 0.9, "scoreKind": "rerank", "mtime": 0}]}


_orig = lb.requests.post
lb.requests.post = lambda *a, **k: _R()
block = lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="p21-auth")
lb.requests.post = _orig
ck("khối trí nhớ tự khai THẨM QUYỀN THẤP HƠN", "THẨM QUYỀN THẤP HƠN" in block)
ck("khối trí nhớ cấm dùng để bác lệnh chủ nhân", "KHÔNG được dùng khối này để bác bỏ" in block)
ck("khối trí nhớ đóng bằng mốc 'lời chủ nhân'", "đây mới là thứ phải làm theo" in block)

# ── 6. Bất biến runtime recall ──
h = lb.recall_health(force=False) if lb._HEALTH_CACHE.get("data") else {"status": "SKIP"}
ck("recall_health trả trạng thái hợp lệ",
   h.get("status") in ("OK", "OFF", "DEGRADED", "INCONCLUSIVE", "UNKNOWN", "SKIP"))
ck("recall_health có hàm và cache", callable(lb.recall_health) and isinstance(lb._HEALTH_CACHE, dict))

# ── 7. force_rotate an toàn khi chưa có client ──
ck("force_rotate chat lạ → False", lb.force_rotate("khong-co-that") is False)

# ── 8. Cờ tắt được (rollback) ──
ck("LUCY_TOOL_POLICY tồn tại", isinstance(lb._TOOL_POLICY, bool))
ck("LUCY_WRITE_GATE tồn tại", isinstance(lb._WRITE_GATE, bool))

print(f"\n{'=' * 50}\nKẾT QUẢ: {PASS} PASS · {FAIL} FAIL")
sys.exit(1 if FAIL else 0)
