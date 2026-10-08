#!/usr/bin/env python3
"""PHASE 2 — Hiệu chỉnh NGƯỠNG điểm liên quan cho recall (đo, không đoán).

Chạy 1 bộ câu hỏi có nhãn (câu nào ĐÁNG tra vault, câu nào KHÔNG) → in phân bố điểm rerank
→ chọn ngưỡng tách được "hit đúng" khỏi "hit rác". Cũng đo precision@k trước/sau ngưỡng.

Chạy: python3 qa_calibrate_recall.py [ngưỡng_thử=0.2,0.3,0.35,0.4,0.5]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "qa:token")
import lucy_bridge as lb  # noqa: E402
import requests  # noqa: E402

# (câu hỏi, có đáng tra vault không, từ khoá của note ĐÚNG nếu có)
CASES = [
    ("hôm trước t nói gì về bill truong chủ nhân là ai", True, ["bill", "owner", "user"]),
    ("cái vụ pxpipe làm mất persona nguyên nhân là gì", True, ["pxpipe", "persona"]),
    ("engine nào đang chạy cho bridge lucy telegram", True, ["persist", "bridge", "engine"]),
    ("fitcity preview bị lỗi gì mà crash loop", True, ["fitcity", "crash"]),
    ("recall vector bitemporal của lucy hoạt động sao", True, ["bitemporal", "recall", "memory"]),
    ("nay ăn gì ngon nhỉ trưa nay", False, []),
    ("kể em nghe một câu chuyện vui đi nào", False, []),
    ("em thấy thời tiết hôm nay thế nào", False, []),
    ("giải thích lãi kép cho t nghe với", False, []),
    ("viết lại đoạn văn trên cho ngắn gọn hơn", False, []),
]
THRESHOLDS = [float(x) for x in (sys.argv[1].split(",") if len(sys.argv) > 1 else
                                 ["0.2", "0.3", "0.35", "0.4", "0.5", "0.6"])]

hdr = {"x-worker-token": lb.COORD_TOK} if lb.COORD_TOK else {}


def fetch(q, episodic=False):
    r = requests.post(f"{lb.COORD_URL}/recall", json={"q": q, "limit": 8, "episodic": episodic},
                      headers=hdr, timeout=30)
    r.raise_for_status()
    return (r.json() or {}).get("hits") or []


print("Hiệu chỉnh ngưỡng recall — điểm rerank thật từ coordinator\n")
rows = []
for q, want, keys in CASES:
    try:
        hits = fetch(q)
    except Exception as e:
        print(f"  ! {q[:40]}: {type(e).__name__} {e}")
        continue
    scored = [(h.get("score"), h.get("scoreKind"), (h.get("title") or "")[:44]) for h in hits]
    scored = [s for s in scored if s[0] is not None]
    if not scored:
        print(f"  ! {q[:40]}: KHÔNG có score (coordinator chưa restart?)")
        continue
    top = max(s[0] for s in scored)
    good = [s for s in scored if keys and any(k in s[2].lower() for k in keys)]
    rows.append({"q": q, "want": want, "scores": [round(s[0], 3) for s in scored],
                 "top": top, "good_scores": [round(g[0], 3) for g in good]})
    tag = "CẦN tra " if want else "KHÔNG cần"
    print(f"[{tag}] {q[:46]}")
    print(f"    top={top:.3f} · phân bố={[round(s[0],2) for s in scored]}")
    for s in scored[:3]:
        mark = "★" if keys and any(k in s[2].lower() for k in keys) else " "
        print(f"    {mark} {s[0]:.3f} {s[2]}")

print("\n" + "=" * 60)
print("Ngưỡng | note-chèn/câu-CẦN | note-chèn/câu-KHÔNG-cần | note ĐÚNG giữ được")
for th in THRESHOLDS:
    need = [r for r in rows if r["want"]]
    noneed = [r for r in rows if not r["want"]]
    a = sum(len([s for s in r["scores"] if s >= th]) for r in need) / max(1, len(need))
    b = sum(len([s for s in r["scores"] if s >= th]) for r in noneed) / max(1, len(noneed))
    g = sum(1 for r in need if r["good_scores"] and max(r["good_scores"]) >= th)
    gtot = sum(1 for r in need if r["good_scores"])
    print(f" {th:.2f}  |      {a:5.2f}        |        {b:5.2f}          |   {g}/{gtot}")
print("\nChọn ngưỡng: cột 2 còn >0 (vẫn nhớ được), cột 3 ~0 (hết rác), cột 4 giữ tối đa.")
