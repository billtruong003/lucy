#!/usr/bin/env python3
"""trend.py — theo dõi bench recall theo thời gian (P5).

Dùng:
  python3 trend.py            # đọc bench/out/*.json mới nhất, append vào trend.jsonl, so với lần trước
  python3 trend.py --run      # chạy run_bench.py trước rồi mới chấm trend

Alert khi: metric "tốt" (hit*/mrr/snippet*) TỤT quá 15% tương đối,
hoặc metric "xấu" (fail*/latency*) TĂNG quá 15%. Exit 1 nếu có alert
(để cron_guard log rc≠0 → dễ soi).

Trend ghi bench/trend.jsonl — mỗi dòng 1 lần chạy, giữ nguyên overall + by_zone.
"""
import argparse, glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
TREND = os.path.join(HERE, "trend.jsonl")
REL_THRESHOLD = 0.15  # 15% tương đối

GOOD_PREFIX = ("hit", "mrr", "snippet")   # cao = tốt
BAD_PREFIX = ("fail", "latency", "p50", "p95")  # cao = xấu


def latest_out():
    files = sorted(glob.glob(os.path.join(OUT_DIR, "*.json")))
    if not files:
        sys.exit(f"[trend] không có kết quả bench trong {OUT_DIR} — chạy run_bench.py trước (hoặc --run)")
    with open(files[-1], encoding="utf-8") as f:
        return json.load(f), files[-1]


def load_prev():
    if not os.path.exists(TREND):
        return None
    lines = [l for l in open(TREND, encoding="utf-8") if l.strip()]
    return json.loads(lines[-1]) if lines else None


def numeric(d):
    return {k: v for k, v in (d or {}).items() if isinstance(v, (int, float))}


def compare(prev, cur):
    """Trả list alert string."""
    alerts, p, c = [], numeric(prev), numeric(cur)
    for k in sorted(set(p) & set(c)):
        old, new = p[k], c[k]
        if old == 0 and new == 0:
            continue
        base = abs(old) if old else max(abs(new), 1e-9)
        delta = (new - old) / base
        kl = k.lower()
        if kl.startswith(GOOD_PREFIX) and delta < -REL_THRESHOLD:
            alerts.append(f"TỤT {k}: {old} → {new} ({delta:+.0%})")
        elif kl.startswith(BAD_PREFIX) and delta > REL_THRESHOLD:
            alerts.append(f"TĂNG {k}: {old} → {new} ({delta:+.0%})")
    return alerts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="chạy run_bench.py trước")
    args = ap.parse_args()

    if args.run:
        rc = subprocess.run([sys.executable, os.path.join(HERE, "run_bench.py"),
                             "--out", OUT_DIR]).returncode
        if rc != 0:
            sys.exit(f"[trend] run_bench.py rc={rc} — không chấm trend trên kết quả lỗi")

    out, path = latest_out()
    prev = load_prev()
    entry = {"date": out.get("date"), "src": os.path.basename(path),
             "overall": out.get("overall"), "by_zone": out.get("by_zone")}

    alerts = []
    if prev:
        alerts += compare(prev.get("overall"), entry["overall"])
        for z, m in (entry.get("by_zone") or {}).items():
            alerts += [f"[zone {z}] {a}" for a in compare((prev.get("by_zone") or {}).get(z), m)]
        entry["prev_date"] = prev.get("date")
    entry["alerts"] = alerts

    with open(TREND, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"[trend] {entry['date']} ← so với {prev.get('date') if prev else '(chưa có mốc — lần đầu)'}")
    print(f"[trend] overall: {json.dumps(entry['overall'], ensure_ascii=False)}")
    if alerts:
        print("⚠️ [trend] ALERT:")
        for a in alerts:
            print("  -", a)
        sys.exit(1)
    print("[trend] OK — không tụt quá ngưỡng 15%")


if __name__ == "__main__":
    main()
