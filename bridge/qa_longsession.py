#!/usr/bin/env python3
"""PHASE 2 — CATEGORY M: đo phiên DÀI (persistent client) có xuống cấp không.

Chạy N lượt hội thoại tổng hợp trên MỘT phiên, cứ mỗi K lượt lại:
  • đo context usage (SDK get_context_usage) + TTFT
  • cắm 1 câu "kiểm tra trí nhớ" (fact gài từ lượt 1) → còn nhớ không?
  • cắm 1 câu "kiểm tra ý mới nhất" (đính chính ở giữa) → ý cũ có sống lại không?

Chạy:  python3 qa_longsession.py [số_lượt=40]
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "qa:token")
import lucy_bridge as lb  # noqa: E402

TURNS = int(sys.argv[1]) if len(sys.argv) > 1 else 40
PROBE_EVERY = int(os.environ.get("LUCY_QA_PROBE_EVERY", "10"))
OUT = os.environ.get("LUCY_QA_OUT", "/root/lucy/.state/qa-longsession.json")

lb.EPISODIC = False
lb._save = lambda *a, **k: None
lb._save_claude_hist = lambda *a, **k: None
lb._save_prefs = lambda *a, **k: None
CAP, EDITS = {}, {}
lb.send = lambda cid, t: CAP.setdefault(str(cid), []).append(str(t or ""))
lb.reply = lb.send
lb.send_id = lambda cid, t: 1
lb.edit = lambda cid, mid, t: EDITS.setdefault(str(cid), []).append(str(t or ""))
lb.send_document = lambda *a, **k: None
lb.send_kb = lambda *a, **k: None

CID = -960001
SESSIONS = {}

# Fact gài đầu phiên + đính chính giữa phiên
SEED_FACT = "Nhớ giúp em: mã dự án của mình là ORCHID-77, và deadline là ngày 30 tháng 9. Trả lời 1 từ: ok"
CORRECTION_AT = max(3, TURNS // 3)
CORRECTION = "à sửa lại: deadline đổi thành ngày 15 tháng 10 nhé, không phải 30 tháng 9 nữa. Trả lời 1 từ: ok"
FILLER = [
    "Kể em nghe 1 câu ngắn về thị trường crypto hôm nay theo cảm nhận của em thôi, đừng tra cứu.",
    "Nói 1 câu về việc tối ưu context window.",
    "1 câu về lợi ích của FTS so với vector search.",
    "1 câu về việc vì sao nên giữ prompt ngắn.",
    "1 câu về thói quen làm việc buổi sáng.",
    "1 câu về cách đặt tên biến cho dễ đọc.",
    "1 câu về việc nghỉ ngơi khi code lâu.",
    "1 câu về ưu điểm của SQLite.",
]


def turn(text):
    CAP[str(CID)] = []
    EDITS[str(CID)] = []
    t0 = time.time()
    lb.handle({"chat": {"id": CID}, "from": {"id": int(lb.ALLOWED or 1)}, "text": text}, SESSIONS)
    wall = time.time() - t0
    ed = EDITS.get(str(CID)) or []
    ans = "\n".join(([ed[-1]] if ed else []) + CAP.get(str(CID), []))
    return ans, wall, lb.trace_get(CID)


def main():
    rows = []
    probes = []
    print(f"Phiên dài: {TURNS} lượt · probe mỗi {PROBE_EVERY} lượt · engine={lb._ENGINE}\n", flush=True)
    ans, wall, tr = turn(SEED_FACT)
    print(f"[seed] {wall:.1f}s · {ans[:60]}", flush=True)

    for i in range(1, TURNS + 1):
        if i == CORRECTION_AT:
            ans, wall, tr = turn(CORRECTION)
            print(f"[{i}] ĐÍNH CHÍNH deadline · {wall:.1f}s", flush=True)
        else:
            ans, wall, tr = turn(FILLER[i % len(FILLER)])
        h = lb.session_health(CID) if i % PROBE_EVERY == 0 else {}
        rows.append({"i": i, "wall": round(wall, 2), "ttft": round(float(tr.get("ttft") or 0), 2),
                     "ctx_tokens": h.get("ctx_tokens"), "ctx_pct": h.get("ctx_pct"),
                     "turns": h.get("turns"), "rotations": h.get("rotations")})
        if i % PROBE_EVERY == 0:
            # probe 1: fact gài từ đầu còn nhớ?
            a1, w1, _ = turn("mã dự án của mình là gì? trả lời đúng mã thôi.")
            keep_fact = "orchid" in a1.lower()
            # probe 2: ý MỚI NHẤT (sau đính chính) có thắng không?
            a2, w2, _ = turn("deadline là ngày nào? trả lời ngắn.")
            newest = ("15" in a2 and ("10" in a2 or "tháng 10" in a2.lower()))
            stale = ("30" in a2 and "9" in a2)
            after_corr = i >= CORRECTION_AT
            probes.append({"at": i, "fact_kept": keep_fact, "newest_wins": newest if after_corr else None,
                           "stale_alive": stale if after_corr else None,
                           "ctx_pct": h.get("ctx_pct"), "ctx_tokens": h.get("ctx_tokens"),
                           "rotations": h.get("rotations"), "ttft_probe": round(w1, 2)})
            print(f"    ↳ probe@{i}: nhớ_fact={keep_fact} · ý_mới_thắng={newest if after_corr else '-'} "
                  f"· ý_cũ_sống_lại={stale if after_corr else '-'} · ctx={h.get('ctx_pct')}% "
                  f"({h.get('ctx_tokens')} tok) · rotate={h.get('rotations')}", flush=True)

    lb._ps_close(CID)
    ttfts = sorted(r["ttft"] for r in rows if r["ttft"])
    first, last = ttfts[:len(ttfts) // 3] or [0], ttfts[-len(ttfts) // 3:] or [0]
    summary = {
        "turns": TURNS,
        "ttft_median_all": round(ttfts[len(ttfts) // 2], 2) if ttfts else 0,
        "ttft_median_dau": round(sum(first) / len(first), 2),
        "ttft_median_cuoi": round(sum(last) / len(last), 2),
        "ctx_cuoi_pct": rows[-1].get("ctx_pct") if rows else None,
        "probes": probes,
        "fact_kept_all": all(p["fact_kept"] for p in probes) if probes else None,
        "stale_never_alive": not any(p["stale_alive"] for p in probes if p["stale_alive"] is not None),
        "newest_always_wins": all(p["newest_wins"] for p in probes if p["newest_wins"] is not None),
        "rotations": rows[-1].get("rotations") if rows else 0,
    }
    print("\n" + "=" * 52)
    print(f"TTFT đầu phiên {summary['ttft_median_dau']}s → cuối phiên {summary['ttft_median_cuoi']}s")
    print(f"Context cuối: {summary['ctx_cuoi_pct']}% · xoay vòng: {summary['rotations']} lần")
    print(f"Nhớ fact gài đầu: {summary['fact_kept_all']}")
    print(f"Ý mới luôn thắng: {summary['newest_always_wins']} · ý cũ không sống lại: {summary['stale_never_alive']}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"summary": summary, "rows": rows}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"→ ghi {OUT}")


if __name__ == "__main__":
    main()
