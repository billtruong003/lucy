#!/usr/bin/env python3
"""PHASE 2 — So kết quả TRƯỚC/SAU trên cùng bộ kịch bản. Không bịa số, đọc thẳng JSON của qa_harness.

Chạy: python3 qa_compare.py /root/lucy/.state/qa-baseline.json /root/lucy/.state/qa-after.json
"""
import json
import sys

CATNAME = {
    "A": "Follow-up tức thì", "B": "Sửa lời / đính chính", "C": "Ngắt giữa chừng",
    "D": "Nhảy chủ đề", "E": "Trí nhớ bền", "F": "Trí nhớ giả-liên-quan",
    "G": "Quyết định bị thay", "H": "Ký ức phiên", "I": "Tán gẫu (không tool)",
    "J": "Việc agentic (cần tool)", "K": "Tham chiếu suy được", "L": "Mơ hồ thật",
}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def turns_of(d):
    return [t for r in d["results"] for t in r["turns"] if "flags" in t]


def q(lst, p):
    lst = sorted(lst)
    return round(lst[min(len(lst) - 1, int(len(lst) * p))], 2) if lst else 0


def main():
    a, b = load(sys.argv[1]), load(sys.argv[2])
    ta, tb = turns_of(a), turns_of(b)
    print(f"TRƯỚC = {a['label']}  ·  SAU = {b['label']}\n")

    print(f"{'Chỉ số':<34}{'TRƯỚC':>12}{'SAU':>12}")
    print("-" * 58)
    rows = [
        ("Scenario đạt", f"{a['agg']['scenarios_pass']}/{a['agg']['scenarios_total']}",
         f"{b['agg']['scenarios_pass']}/{b['agg']['scenarios_total']}"),
        ("Intent hiểu đúng", f"{a['agg']['intent_ok']}/{a['agg']['turns_total']}",
         f"{b['agg']['intent_ok']}/{b['agg']['turns_total']}"),
        ("Không rò ngữ cảnh cũ", f"{a['agg']['no_leak']}/{a['agg']['turns_total']}",
         f"{b['agg']['no_leak']}/{b['agg']['turns_total']}"),
        ("Chèn trí nhớ thừa (lượt)", a["agg"]["irrelevant_memory"], b["agg"]["irrelevant_memory"]),
        ("Dùng tool thừa (lượt)", a["agg"]["unnecessary_tool"], b["agg"]["unnecessary_tool"]),
        ("TTFT median (s)", q(a["agg"]["ttft_list"], .5), q(b["agg"]["ttft_list"], .5)),
        ("TTFT p90 (s)", q(a["agg"]["ttft_list"], .9), q(b["agg"]["ttft_list"], .9)),
        ("TTFT p95 (s)", q(a["agg"]["ttft_list"], .95), q(b["agg"]["ttft_list"], .95)),
        ("Turn wall median (s)", q(a["agg"]["wall_list"], .5), q(b["agg"]["wall_list"], .5)),
    ]
    for name, x, y in rows:
        print(f"{name:<34}{str(x):>12}{str(y):>12}")

    print("\nTheo nhóm kịch bản:")
    print(f"{'Nhóm':<32}{'TRƯỚC':>10}{'SAU':>10}")
    print("-" * 52)
    for k in sorted(set(a["bycat"]) | set(b["bycat"])):
        ca = a["bycat"].get(k, {"pass": 0, "total": 0})
        cb = b["bycat"].get(k, {"pass": 0, "total": 0})
        print(f"{k + ' — ' + CATNAME.get(k, ''):<32}{ca['pass']}/{ca['total']:<8}{cb['pass']}/{cb['total']}")

    # scenario nào đổi trạng thái
    pa = {r["id"]: r["pass"] for r in a["results"]}
    pb = {r["id"]: r["pass"] for r in b["results"]}
    fixed = sorted(k for k in pa if pa[k] is False and pb.get(k) is True)
    broke = sorted(k for k in pa if pa[k] is True and pb.get(k) is False)
    print(f"\nSửa được ({len(fixed)}): {', '.join(fixed) or '—'}")
    print(f"Hỏng thêm ({len(broke)}): {', '.join(broke) or '—'}")


if __name__ == "__main__":
    main()
