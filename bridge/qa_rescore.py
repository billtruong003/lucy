#!/usr/bin/env python3
"""PHASE 2.1 — Chấm LẠI dữ liệu thô của lần chạy cũ bằng thước đo mới (ngữ nghĩa vs trải nghiệm).

Không gọi Claude, không tốn gì: đọc JSON đã có (tools/ttft/mem_tok/answers) rồi áp policy mới.
Mục đích: chứng minh điểm 35/43 của Phase 2 là ảo — nhiều scenario "đạt" nhưng 94-108s và 6-10 tool.

Chạy: python3 qa_rescore.py /root/lucy/.state/qa-after.json
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_policy import MODE_DEFAULTS, countable_tools  # noqa: E402
from qa_scenarios import SCENARIOS  # noqa: E402

SC = {s["id"]: s for s in SCENARIOS}


def mode_of(sid, idx):
    sc = SC.get(sid) or {}
    turns = sc.get("turns") or []
    turn = turns[idx] if idx < len(turns) else {}
    return turn.get("mode") or sc.get("mode") or "talk"


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/root/lucy/.state/qa-after.json"
    d = json.load(open(path, encoding="utf-8"))
    rows = []
    for r in d["results"]:
        st = "PASS"
        detail = []
        for i, t in enumerate(r["turns"]):
            if "flags" not in t and "dims" not in t:
                continue
            m = mode_of(r["id"], i)
            pol = MODE_DEFAULTS.get(m, MODE_DEFAULTS["talk"])
            n = len(countable_tools(t.get("tools")))
            ttft = float(t.get("ttft") or 0)
            bad = []
            if n > pol["max_tools"]:
                bad.append(f"{n} tool (trần {pol['max_tools']})")
            if ttft > pol["ttft_fail"]:
                bad.append(f"TTFT {ttft:.0f}s (trần {pol['ttft_fail']}s)")
            warn = (not bad) and (ttft > pol["ttft_warn"] or n > pol["warn_tools"])
            # lỗi ngữ nghĩa cũ vẫn tính
            sem_bad = [e for e in (t.get("errs") or [])
                       if e.split(":")[0] in ("intent", "context-leak", "memory-noise", "tool-miss")]
            if bad or sem_bad:
                st = "FAIL"
                detail.append(f"[{m}] {t['say'][:38]} → " + "; ".join(bad + sem_bad))
            elif warn and st == "PASS":
                st = "WARN"
                detail.append(f"[{m}] {t['say'][:38]} → chậm/nhiều tool (TTFT {ttft:.0f}s, {n} tool)")
        rows.append({"id": r["id"], "cat": r["cat"], "old_pass": r.get("pass"), "new": st, "detail": detail})

    old_pass = sum(1 for r in rows if r["old_pass"])
    new_pass = sum(1 for r in rows if r["new"] == "PASS")
    new_warn = sum(1 for r in rows if r["new"] == "WARN")
    new_fail = sum(1 for r in rows if r["new"] == "FAIL")
    print(f"Nguồn: {os.path.basename(path)} (nhãn: {d.get('label')}) · {len(rows)} scenario\n")
    print(f"Thước đo CŨ (chỉ ngữ nghĩa):  ĐẠT {old_pass}/{len(rows)}")
    print(f"Thước đo MỚI (thêm trải nghiệm): PASS {new_pass} · WARN {new_warn} · FAIL {new_fail}\n")
    downgraded = [r for r in rows if r["old_pass"] and r["new"] != "PASS"]
    print(f"── {len(downgraded)} scenario TRƯỚC ĐÂY 'ĐẠT' nhưng thực chất KHÔNG khoẻ ──")
    for r in downgraded:
        print(f"  {r['new']:4} {r['id']} ({r['cat']})")
        for dt in r["detail"][:2]:
            print(f"        {dt}")
    return rows


if __name__ == "__main__":
    main()
