#!/usr/bin/env python3
"""PHASE 2 — DOGFOOD: chạy đúng các chuỗi hội thoại chủ nhân mô tả, qua đường production thật.
In nguyên câu trả lời + trace để người đọc tự đánh giá (không chấm tự động).

Chạy: python3 qa_dogfood.py            (mặc định KHÔNG gửi Telegram)
      LUCY_DOGFOOD_TG=1 python3 qa_dogfood.py   (gửi thật vào Telegram chủ nhân)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "qa:token")
import lucy_bridge as lb  # noqa: E402

TG = os.environ.get("LUCY_DOGFOOD_TG") == "1"
CAP, EDITS = {}, {}
if not TG:
    lb.EPISODIC = False
    lb._save = lambda *a, **k: None
    lb._save_claude_hist = lambda *a, **k: None
    lb.send = lambda cid, t: CAP.setdefault(str(cid), []).append(str(t or ""))
    lb.reply = lb.send
    lb.send_id = lambda cid, t: 1
    lb.edit = lambda cid, mid, t: EDITS.setdefault(str(cid), []).append(str(t or ""))
    lb.send_document = lambda *a, **k: None

ROTATE_AFTER = {"8. option sau khi xoay vòng phiên": 0}

FLOWS = [
    ("1. cái thứ 2 = PM2, KHÔNG được chạy Bash", [
        "có 3 cách: docker, pm2, systemd",
        "cái thứ 2 ngon hơn nhỉ",
    ]),
    ("2. 'con đó' = Jina, không cần tra vault", [
        "Jina đang làm recall",
        "thế con đó bỏ được ko?",
    ]),
    ("3. 'ừ làm tiếp' — nối danh sách, KHÔNG Bash/Read", [
        "liệt kê tiếp lý do Lucy chậm đi, lý do 1 là boot CLI",
        "ừ làm tiếp",
    ]),
    ("4. bàn ý tưởng rồi CẤM tool tuyệt đối", [
        "cái lexical filter này sai ở ý tưởng nào?",
        "đừng đọc file, nói ý tưởng thôi",
    ]),
    ("5. lệnh mới đè trí nhớ cũ", [
        "m nhớ bridge đang chạy engine gì không?",
        "từ giờ trong lượt này coi như dùng spawn nhé. Engine là gì?",
    ]),
    ("6. giả định — KHÔNG được ghi trí nhớ bền", [
        "giả sử từ giờ t dùng preset Kestrel thì m sẽ làm gì?",
    ]),
    ("7. chốt thật — ĐƯỢC ghi trí nhớ bền", [
        "chốt thật nhé: từ giờ mọi báo cáo để đơn vị VND. Nhớ giùm t.",
    ]),
    ("8. option sau khi xoay vòng phiên", [
        "cho t 3 cách tăng tốc recall, đánh số 1 2 3, mỗi cái 1 dòng",
        "option 2 đi",
    ]),
    ("9. A → đồ ăn → quay lại A", [
        "mình đang bàn context compiler cho Lucy nhé",
        "thôi bỏ vụ Lucy. Nay ăn gì nhỉ?",
        "quay lại Lucy, phần context compiler hồi nãy ấy",
    ]),
]


def run(cid, text):
    CAP[str(cid)] = []
    EDITS[str(cid)] = []
    t0 = time.time()
    lb.handle({"chat": {"id": cid}, "from": {"id": int(lb.ALLOWED or 1)}, "text": text}, {})
    wall = time.time() - t0
    if TG:
        return "(đã gửi Telegram)", wall, lb.trace_get(cid)
    ed = EDITS.get(str(cid)) or []
    return "\n".join(([ed[-1]] if ed else []) + CAP.get(str(cid), [])), wall, lb.trace_get(cid)


def main():
    base = int(lb.ALLOWED) if TG else -950000
    for i, (name, turns) in enumerate(FLOWS):
        cid = base if TG else base - i
        print(f"\n{'=' * 66}\n▶ {name}\n{'=' * 66}", flush=True)
        for ti, t in enumerate(turns):
            ans, wall, tr = run(cid, t)
            print(f"\n👤 {t}", flush=True)
            print(f"🤖 {ans[:700]}", flush=True)
            print(f"   ⟨{wall:.1f}s · TTFT {tr.get('ttft', 0):.1f}s · trí nhớ {tr.get('mem_tok', 0)} tok"
                  + (f" ({tr.get('recall_skip')})" if tr.get("recall_skip") else "")
                  + f" · tool {tr.get('tools') or 'không'}"
                  + f" · mode {tr.get('tool_mode')}/{tr.get('write_mode')}⟩", flush=True)
            if ROTATE_AFTER.get(name) == ti:
                print(f"   ↻ ép xoay vòng phiên: {lb.force_rotate(cid)}", flush=True)
        if not TG:
            lb._ps_close(cid)


if __name__ == "__main__":
    main()
