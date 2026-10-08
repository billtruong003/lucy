#!/usr/bin/env python3
"""PHASE 2.1 — dựng bảng so TRƯỚC/SAU bằng CÙNG một thước đo (mission §35).

Nguồn "trước":
  • 43 kịch bản cũ  → chấm LẠI dữ liệu thô Phase 2 (qa-after.json) bằng policy mới  [qa_rescore]
  • 25 kịch bản mới → chạy thật với mọi cơ chế Phase 2.1 TẮT (qa-phase21-baseline.json)
Nguồn "sau": qa-phase21-after.json (68 kịch bản, Phase 2.1 bật).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qa_rescore  # noqa: E402

ST = "/root/lucy/.state"
CATNAME = {
    "A": "Follow-up tức thì", "B": "Sửa lời / đính chính", "C": "Ngắt giữa chừng",
    "D": "Nhảy chủ đề", "E": "Trí nhớ bền", "F": "Trí nhớ giả-liên-quan",
    "G": "Quyết định bị thay", "H": "Ký ức phiên", "I": "Tán gẫu (không tool)",
    "J": "Việc agentic (cần tool)", "K": "Tham chiếu suy được", "L": "Mơ hồ thật",
    "N": "Kỷ luật tool", "O": "An toàn ghi trí nhớ", "P": "Trí nhớ vs lệnh hiện tại",
    "Q": "Cách ly ngữ cảnh lạ", "R": "Tham chiếu sau xoay vòng",
    "S": "Sửa lời + hỏi trí nhớ", "T": "Câu hỏi trí nhớ ngắn",
}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def q(lst, p):
    lst = sorted(lst)
    return round(lst[min(len(lst) - 1, int(len(lst) * p))], 2) if lst else 0


def main():
    sys.argv = ["x", f"{ST}/qa-after.json"]
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        old43 = qa_rescore.main()          # [{id,cat,old_pass,new}]
    base_new = load(f"{ST}/qa-phase21-baseline.json")
    after = load(f"{ST}/qa-phase21-after.json")

    before = {r["id"]: r["new"] for r in old43}
    for r in base_new["results"]:
        before[r["id"]] = r["status"]
    aft = {r["id"]: r["status"] for r in after["results"]}
    cat = {r["id"]: r["cat"] for r in after["results"]}

    common = [k for k in aft if k in before]
    def cnt(d, ids, st):
        return sum(1 for k in ids if d.get(k) == st)

    print("# Phase 2.1 — TRƯỚC vs SAU (cùng thước đo 9 chiều)\n")
    print(f"Bộ kịch bản: **{len(common)}** (43 cũ + {len(common)-43} mới)\n")
    print("| | TRƯỚC (Phase 2) | SAU (Phase 2.1) |")
    print("|---|---|---|")
    print(f"| **Trải nghiệm TỐT (PASS)** | **{cnt(before,common,'PASS')}/{len(common)}** | **{cnt(aft,common,'PASS')}/{len(common)}** |")
    print(f"| WARN | {cnt(before,common,'WARN')} | {cnt(aft,common,'WARN')} |")
    print(f"| FAIL | {cnt(before,common,'FAIL')} | {cnt(aft,common,'FAIL')} |")

    a = after["agg"]; b = base_new["agg"]
    print("\n## Chỉ số lượt (mission §4)\n")
    print("| Chỉ số | TRƯỚC¹ | SAU |")
    print("|---|---|---|")
    rows = [
        ("Lượt TÁN GẪU có dùng tool", f"{b['talk_turns_with_tools']}/{b['talk_turns']}", f"{a['talk_turns_with_tools']}/{a['talk_turns']}"),
        ("Lượt gọi >3 tool", b["turns_over_3_tools"], a["turns_over_3_tools"]),
        ("Chèn trí nhớ thừa", b["irrelevant_memory"], a["irrelevant_memory"]),
        ("Ý cũ đè lệnh hiện tại", b["stale_over_current"], a["stale_over_current"]),
        ("Trỏ sai tham chiếu", b["wrong_reference"], a["wrong_reference"]),
        ("Ghi trí nhớ bền sai", b["durable_write_violations"], a["durable_write_violations"]),
        ("TÁN GẪU TTFT median", f"{q(b['talk_ttft'],.5)}s", f"{q(a['talk_ttft'],.5)}s"),
        ("TÁN GẪU TTFT p90", f"{q(b['talk_ttft'],.9)}s", f"{q(a['talk_ttft'],.9)}s"),
        ("TÁN GẪU TTFT p95", f"{q(b['talk_ttft'],.95)}s", f"{q(a['talk_ttft'],.95)}s"),
        ("TÁN GẪU TTFT >15s", b["talk_ttft_over15"], a["talk_ttft_over15"]),
        ("TÁN GẪU TTFT >30s", b["talk_ttft_over30"], a["talk_ttft_over30"]),
        ("TÁN GẪU số tool p95", q(b["talk_tools_list"], .95), q(a["talk_tools_list"], .95)),
    ]
    for n, x, y in rows:
        print(f"| {n} | {x} | {y} |")
    print("\n¹ cột TRƯỚC của bảng này lấy từ lần chạy baseline 25 kịch bản MỚI (tắt hết cơ chế Phase 2.1);"
          " 43 kịch bản cũ không có số lượt tương đương vì được chấm lại từ dữ liệu thô.\n")

    print("## Theo nhóm\n")
    print("| Nhóm | | TRƯỚC | SAU |")
    print("|---|---|---|---|")
    for c in sorted({cat[k] for k in common}):
        ids = [k for k in common if cat[k] == c]
        print(f"| {c} | {CATNAME.get(c,'')} | {cnt(before,ids,'PASS')}/{len(ids)} | {cnt(aft,ids,'PASS')}/{len(ids)} |")

    fixed = sorted(k for k in common if before[k] != "PASS" and aft[k] == "PASS")
    broke = sorted(k for k in common if before[k] == "PASS" and aft[k] != "PASS")
    print(f"\n**Sửa được ({len(fixed)}):** {', '.join(fixed) or '—'}")
    print(f"**Hỏng thêm ({len(broke)}):** {', '.join(broke) or '—'}")


if __name__ == "__main__":
    main()
