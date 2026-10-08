#!/usr/bin/env python3
"""PHASE 2.1 — chạy LẶP các kịch bản quan trọng N lần, báo kết quả ĐA SỐ + độ dao động (mission §23).

Vì LLM không tất định, một lần chạy may mắn không chứng minh được gì. Script này chạy cùng bộ kịch bản
nhiều lần rồi báo: mỗi kịch bản đạt bao nhiêu / N lần, và những kịch bản KHÔNG ổn định (lúc đạt lúc trượt).

Chạy: python3 qa_repeat.py 3 A B D G K N O P R S T
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("LUCY_QA_OUT", "/root/lucy/.state/qa-phase21-repeated-summary.json")
GUARD = os.path.join(HERE, "qa_vault_guard.sh")


def main():
    reps = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    cats = sys.argv[2:] or ["A", "B", "D", "G", "K", "N", "O", "P", "R", "S", "T"]
    catarg = "--cat=" + ",".join(cats)
    runs = []
    for i in range(1, reps + 1):
        tmp = f"/root/lucy/.state/qa-rep-{i}.json"
        for p in (tmp, tmp + ".partial"):
            if os.path.exists(p):
                os.remove(p)
        print(f"\n=== LẦN {i}/{reps} ===", flush=True)
        subprocess.run(["bash", GUARD, "snapshot"], capture_output=True)
        env = {**os.environ, "LUCY_QA_LABEL": f"rep{i}", "LUCY_QA_OUT": tmp}
        subprocess.run([sys.executable, os.path.join(HERE, "qa_harness.py"), catarg],
                       cwd=HERE, env=env)
        subprocess.run(["bash", GUARD, "restore"], capture_output=True)
        try:
            runs.append(json.load(open(tmp, encoding="utf-8")))
        except Exception as e:
            print(f"  ! không đọc được kết quả lần {i}: {e}", flush=True)

    # tổng hợp
    tally = {}
    for r in runs:
        for sc in r["results"]:
            t = tally.setdefault(sc["id"], {"cat": sc["cat"], "desc": sc["desc"],
                                            "PASS": 0, "WARN": 0, "FAIL": 0, "n": 0})
            t[sc["status"]] += 1
            t["n"] += 1
    for sid, t in tally.items():
        t["healthy_rate"] = round(t["PASS"] / max(1, t["n"]), 2)
        t["ok_rate"] = round((t["PASS"] + t["WARN"]) / max(1, t["n"]), 2)   # đúng ngữ nghĩa, có thể chậm
        t["stable"] = (t["PASS"] == t["n"]) or (t["FAIL"] == t["n"])
        t["majority"] = max(("PASS", "WARN", "FAIL"), key=lambda k: t[k])

    n = len(runs)
    stable_pass = [s for s, t in tally.items() if t["PASS"] == t["n"] and t["n"] == n]
    stable_fail = [s for s, t in tally.items() if t["FAIL"] == t["n"] and t["n"] == n]
    flaky = [s for s, t in tally.items() if not t["stable"]]
    print("\n" + "=" * 62)
    print(f"CHẠY {n} LẦN · {len(tally)} kịch bản")
    print(f"  Ổn định ĐẠT   ({len(stable_pass)}): {', '.join(sorted(stable_pass)) or '—'}")
    print(f"  Ổn định TRƯỢT ({len(stable_fail)}): {', '.join(sorted(stable_fail)) or '—'}")
    print(f"  Dao động      ({len(flaky)}): {', '.join(sorted(flaky)) or '—'}")
    print("\nChi tiết kịch bản dao động / trượt:")
    for sid in sorted(set(flaky) | set(stable_fail)):
        t = tally[sid]
        print(f"  {sid} ({t['cat']}) P{t['PASS']}/W{t['WARN']}/F{t['FAIL']} — {t['desc'][:44]}")
    bycat = {}
    for sid, t in tally.items():
        c = bycat.setdefault(t["cat"], {"pass": 0, "total": 0})
        c["pass"] += t["PASS"]; c["total"] += t["n"]
    print("\nTỷ lệ khoẻ theo nhóm (gộp mọi lần chạy):")
    for c, v in sorted(bycat.items()):
        print(f"  {c}: {v['pass']}/{v['total']} ({100*v['pass']//max(1,v['total'])}%)")

    json.dump({"reps": n, "cats": cats, "tally": tally,
               "stable_pass": sorted(stable_pass), "stable_fail": sorted(stable_fail),
               "flaky": sorted(flaky), "bycat": bycat, "ts": time.time()},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n→ ghi {OUT}")


if __name__ == "__main__":
    main()
