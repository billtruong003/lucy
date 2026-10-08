#!/usr/bin/env python3
"""Smoke PHASE 2 — recall gate v2, ngưỡng điểm liên quan, contextual query, vòng đời phiên.
OFFLINE: không gọi Claude, không gọi coordinator (mock HTTP), không đụng production."""
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
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}")


print("PHASE 2 smoke — thẩm quyền ngữ cảnh & recall chính xác\n")

# ── 1. GATE v2: sửa lời KHÔNG được tra vault ──
for msg in ["ý t là context window ko phải context compiler",
            "thôi bỏ pm2, t nói systemd cơ",
            "không phải ý t, đổi lại đi",
            "khoan, nhầm rồi"]:
    ok, why = lb.recall_intent(msg)
    ck(f"sửa lời → không tra: {msg[:34]}", ok is False)

# ── 2. GATE v2: hỏi trí nhớ PHẢI tra ──
for msg in ["hôm trước t nói gì về BillEngine",
            "m nhớ t thích kiểu content nào không",
            "lần trước mình quyết định dùng engine nào",
            "tuần trước đã chốt cái gì rồi ấy nhỉ"]:
    ok, why = lb.recall_intent(msg)
    ck(f"hỏi trí nhớ → có tra: {msg[:34]}", ok is True and why == "hỏi trí nhớ")

# ── 3. GATE v2: follow-up thuần đại từ → không tra ──
for msg in ["thế cái đó thì sao nhỉ", "con kia thì thế nào", "cái đầu tiên đi", "làm tiếp đi nào"]:
    ok, why = lb.recall_intent(msg)
    ck(f"follow-up → không tra: {msg[:34]}", ok is False)

# ── 4. GATE v2: câu có thực thể lạ vẫn tra dù có đại từ ──
ok, _ = lb.recall_intent("cái đó liên quan tới pxpipe không")
ck("đại từ + thực thể lạ (pxpipe) → vẫn tra", ok is True)

# ── 5. contextual_query: bù từ khoá từ mạch gần khi câu thiếu nghĩa ──
CID = "ctx-test"
lb._RECENT.pop(CID, None)
lb.remember_recent(CID, "con BillEngine chạy tới đâu rồi")
lb.remember_recent(CID, "hôm trước vụ đó sao rồi")
q = lb.contextual_query("hôm trước vụ đó sao rồi", CID)
ck("câu nghèo nghĩa được bù từ khoá", "billengine" in q.lower())
ck("giữ nguyên câu gốc, chỉ nối thêm", q.startswith("hôm trước vụ đó sao rồi"))

lb.remember_recent(CID, "phân tích giúp t kiến trúc recall hybrid vector rerank")
q2 = lb.contextual_query("phân tích giúp t kiến trúc recall hybrid vector rerank", CID)
ck("câu đã đủ nghĩa → KHÔNG bù", q2 == "phân tích giúp t kiến trúc recall hybrid vector rerank")

# ── 6. Ngưỡng điểm: hit điểm thấp bị loại, điểm cao được giữ ──
CALLS = {}


class _Resp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._p


def _fake_post(url, json=None, headers=None, timeout=None):
    CALLS["body"] = json
    return _Resp({"configured": True, "hits": [
        {"title": "Note RẤT liên quan", "snippet": "abc", "file_path": "a.md", "score": 0.91, "scoreKind": "rerank", "mtime": 0},
        {"title": "Note lạc đề", "snippet": "xyz", "file_path": "b.md", "score": 0.04, "scoreKind": "rerank", "mtime": 0},
        {"title": "Note trung bình", "snippet": "def", "file_path": "c.md", "score": 0.42, "scoreKind": "rerank", "mtime": 0},
    ]})


_orig_post = lb.requests.post
lb.requests.post = _fake_post
os.environ["LUCY_RECALL_MIN_SCORE"] = "0.35"
out = lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="score-test")
ck("giữ hit điểm cao (0.91)", "RẤT liên quan" in out)
ck("giữ hit trên ngưỡng (0.42)", "trung bình" in out)
ck("LOẠI hit điểm thấp (0.04)", "Note lạc đề" not in out)

# ── 6b. Điểm 'rrf' KHÔNG được tin tuyệt đối: rrf chuẩn hoá trong cùng câu hỏi nên hit đầu luôn =1.0.
#        Nếu tin nó, câu hỏi lạc đề nào cũng lọt 1 note. Phải rơi về lưới trùng-chữ. ──
def _fake_post_rrf(url, json=None, headers=None, timeout=None):
    return _Resp({"configured": True, "hits": [
        {"title": "Note hoàn toàn lạc đề về shader Unity", "snippet": "toon outline URP",
         "file_path": "u.md", "score": 1.0, "scoreKind": "rrf", "mtime": 0},
        {"title": "Note về kiến trúc memory vault", "snippet": "memory vault kiến trúc",
         "file_path": "m.md", "score": 0.7, "scoreKind": "rrf", "mtime": 0},
    ]})


lb.requests.post = _fake_post_rrf
out_rrf = lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="rrf-test")
ck("rrf điểm 1.0 nhưng lạc đề → vẫn LOẠI (không tin rrf)", "shader Unity" not in out_rrf)
ck("rrf trùng chữ thật → giữ", "kiến trúc memory" in out_rrf)
lb.requests.post = _orig_post

# ── 7. Hit không có điểm (episodic/bm25) → vẫn dùng lưới trùng-chữ cũ ──
def _fake_post_noscore(url, json=None, headers=None, timeout=None):
    return _Resp({"configured": True, "hits": [
        {"title": "💬 Chủ nhân (2026-07-11)", "snippet": "nói về kiến trúc memory", "file_path": "episodic:1", "scoreKind": "fts", "mtime": 0},
        {"title": "💬 Lucy (2026-07-12)", "snippet": "chuyện hoàn toàn khác biệt", "file_path": "episodic:2", "scoreKind": "fts", "mtime": 0},
    ]})


lb.requests.post = _fake_post_noscore
out2 = lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="noscore-test")
ck("episodic trùng chữ → giữ", "2026-07-11" in out2)
ck("episodic lạc đề → loại", "2026-07-12" not in out2)

# ── 8. episodic chỉ xin khi có tín hiệu chuyện cũ ──
lb.requests.post = _fake_post
lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="epi-on")
ck("có 'hôm trước' → xin episodic", CALLS["body"].get("episodic") is True)
lb.recall_prefetch("giải thích kiến trúc memory vault hoạt động ra sao", chat_id="epi-off")
ck("không có tín hiệu cũ → KHÔNG xin episodic", CALLS["body"].get("episodic") is False)
lb.requests.post = _orig_post

# ── 9. bookend được ưu tiên hơn snippet ──
def _fake_post_bookend(url, json=None, headers=None, timeout=None):
    return _Resp({"configured": True, "hits": [
        {"title": "Phiên 2026-08-10", "snippet": "mảnh vụn 14 chữ", "bookend": "[goal] sửa recall · [pending] thêm ngưỡng",
         "file_path": "d.md", "score": 0.8, "scoreKind": "rerank", "mtime": 0},
    ]})


lb.requests.post = _fake_post_bookend
out3 = lb.recall_prefetch("hôm trước mình bàn gì về kiến trúc memory vault", chat_id="bk")
ck("dùng bookend thay snippet", "[goal]" in out3 and "mảnh vụn" not in out3)
lb.requests.post = _orig_post

# ── 10. Vòng đời phiên: carry-over nhỏ và giữ ý mới nhất ──
CID2 = "rot-test"
lb._RECENT.pop(CID2, None)
for m in ["bàn về recall", "à đổi sang FTS thuần", "chốt FTS nhé"]:
    lb.remember_recent(CID2, m)
carry = lb._carry_over(CID2)
ck("carry-over có ý mới nhất", "chốt FTS" in carry)
ck("carry-over nhỏ (<800 ký tự)", 0 < len(carry) < 800)
ck("carry-over rỗng khi chưa có mạch", lb._carry_over("chua-co-gi") == "")

# ── 10b. Ràng buộc/đính chính phải SỐNG SÓT qua nhiều lần xoay vòng ──
# Bug đo được 2026-08-16 (ép xoay mỗi 6 lượt): nối mạch chỉ giữ 4 câu gần nhất → rớt cả fact
# chủ nhân dặn từ đầu lẫn câu đính chính giữa phiên. Túi 'dính' sinh ra để vá đúng chỗ này.
CID4 = "sticky-test"
lb._RECENT.pop(CID4, None); lb._STICKY.pop(CID4, None)
lb.remember_recent(CID4, "Nhớ giúp em: mã dự án là ORCHID-77, deadline 30 tháng 9")
for i in range(12):
    lb.remember_recent(CID4, f"câu tán gẫu vô thưởng vô phạt số {i}")
lb.remember_recent(CID4, "à sửa lại: deadline đổi thành 15 tháng 10, không phải 30 tháng 9 nữa")
for i in range(12):
    lb.remember_recent(CID4, f"thêm câu phiếm nữa số {i}")
carry2 = lb._carry_over(CID4)
ck("fact dặn-nhớ sống sót sau 24 lượt", "ORCHID-77" in carry2)
ck("đính chính sống sót sau 24 lượt", "15 tháng 10" in carry2)
ck("câu phiếm KHÔNG chiếm chỗ trong túi dính",
   not any("vô thưởng" in s for s in lb._STICKY[CID4]))
ck("carry-over vẫn nhỏ (<1400 ký tự)", len(carry2) < 1400)
ck("/new xoá cả túi dính", (lb._STICKY.pop(CID4, None) is not None))

# ── 11. mạch gần bị cắt theo trần ──
CID3 = "ring-test"
lb._RECENT.pop(CID3, None)
for i in range(20):
    lb.remember_recent(CID3, f"tin {i}")
ck("mạch gần cắt đúng trần", len(lb._RECENT[CID3]) == lb._RECENT_MAX)
ck("giữ tin mới nhất", lb._RECENT[CID3][-1] == "tin 19")

# ── 12. cờ tắt được (rollback) ──
ck("LUCY_RECALL_GATE2 tồn tại", isinstance(lb._GATE2, bool))
ck("ngưỡng đọc từ env", float(os.environ.get("LUCY_RECALL_MIN_SCORE", "0.35")) == 0.35)

print(f"\n{'=' * 46}\nKẾT QUẢ: {PASS} PASS · {FAIL} FAIL")
sys.exit(1 if FAIL else 0)
