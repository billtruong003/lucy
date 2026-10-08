#!/usr/bin/env bash
# baseline_pxpipe.sh — baseline nén pipeline pxpipe từ tail 200 dòng events.jsonl.
# CHỈ ĐỌC /root/.pxpipe/events.jsonl, in JSON ra stdout. Không sửa gì, không restart gì.
set -euo pipefail
EVENTS="${1:-/root/.pxpipe/events.jsonl}"
N="${2:-200}"
tail -n "$N" "$EVENTS" | python3 -c '
import json, sys, statistics as st

def pct(xs, p):
    if not xs: return None
    xs = sorted(xs); k = (len(xs) - 1) * p / 100.0
    f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)

def summ(xs, r=2):
    xs = [x for x in xs if x is not None]
    if not xs: return {"n": 0}
    return {"n": len(xs), "mean": round(st.mean(xs), r),
            "p50": round(pct(xs, 50), r), "p95": round(pct(xs, 95), r)}

rows, bad = [], 0
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: rows.append(json.loads(line))
    except Exception: bad += 1

orig  = [r.get("orig_chars") for r in rows if r.get("orig_chars")]
comp  = [r.get("compressed_chars") for r in rows if r.get("compressed_chars") is not None]
ratios, neg = [], []   # neg = "nén âm": compressed > orig (ratio > 1)
for r in rows:
    o, c = r.get("orig_chars"), r.get("compressed_chars")
    if o and c is not None:
        rt = c / o
        ratios.append(rt)
        if rt > 1:
            neg.append({"ts": r.get("ts"), "orig_chars": o, "compressed_chars": c, "ratio": round(rt, 3)})

out = {
    "source": {"n_lines": len(rows), "n_unparseable": bad},
    "orig_chars": summ(orig, 0),
    "compressed_chars": summ(comp, 0),
    "ratio_compressed_over_orig": summ(ratios, 4),
    "negative_compression": {   # ratio > 1 = "nén" phình to hơn gốc
        "count": len(neg), "share": round(len(neg) / len(ratios), 4) if ratios else None,
        "lines": neg[:20]},
    "image_count": summ([r.get("image_count") for r in rows if r.get("image_count") is not None]),
    "image_pixels_mpx": summ([r["image_pixels"] / 1e6 for r in rows if r.get("image_pixels") is not None], 3),
    "image_bytes": summ([r.get("image_bytes") for r in rows if r.get("image_bytes") is not None], 0),
    # field thật trong events.jsonl là first_byte_ms (KHÔNG phải first_byte)
    "first_byte_ms": summ([r.get("first_byte_ms") for r in rows if r.get("first_byte_ms") is not None], 0),
}
print(json.dumps(out, ensure_ascii=False, indent=2))
'
