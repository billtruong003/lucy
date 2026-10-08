#!/usr/bin/env python3
"""run_bench.py — benchmark recall API của coordinator (baseline, CHỈ ĐỌC).

Mỗi câu trong recall_bench.jsonl:
  - POST /recall {"q":..., "limit":8}   ← limit cao nhất POST cho phép (coordinator cap ≤ 8)
  - GET  /recall?q=...&limit=24         ← đường phụ để chấm hit@24 (GET không cap limit)
Chấm: hit@5 / hit@8 (POST), hit@24 + MRR (GET top-24), snippet_contains_answer (POST),
latency p50/p95 (POST), fail_rate (rỗng/lỗi/timeout 10s). Tách metrics theo zone.

Auth: header x-worker-token. Token lấy từ env AM_TOKEN, không có thì tự đào pm2 jlist
(env của process lucy-coordinator). KHÔNG hardcode token vào file này.

Dùng: python3 run_bench.py [--dry] [--bench FILE] [--out DIR]
"""
import argparse, json, os, statistics as st, subprocess, sys, time, urllib.parse, urllib.request
from datetime import date

COORD_URL = os.environ.get("AM_COORD_URL", "http://127.0.0.1:8780")
TIMEOUT = 10  # giây — quá = tính fail
BENCH_DIR = os.path.dirname(os.path.abspath(__file__))


def get_token():
    tok = os.environ.get("AM_TOKEN", "").strip()
    if tok:
        return tok
    try:
        out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=15).stdout
        for p in json.loads(out):
            if p.get("name") == "lucy-coordinator":
                return p["pm2_env"]["env"].get("AM_TOKEN", "")
    except Exception as e:
        print(f"[warn] không lấy được AM_TOKEN từ pm2: {e}", file=sys.stderr)
    return ""


def http_json(method, url, token, body=None):
    """Trả (data|None, latency_ms, err|None)."""
    headers = {"content-type": "application/json"}
    if token:
        headers["x-worker-token"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            payload = json.loads(r.read().decode())
        return payload, (time.monotonic() - t0) * 1000, None
    except Exception as e:
        return None, (time.monotonic() - t0) * 1000, str(e)


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def agg(rows):
    """Gộp metrics từ list kết quả per-question."""
    n = len(rows)
    if not n:
        return {}
    lat = [r["latency_ms_post"] for r in rows if r["latency_ms_post"] is not None]
    scored = [r for r in rows if not r["fail"]]
    ns = len(scored) or 1
    return {
        "n": n,
        "fail_rate": round(sum(1 for r in rows if r["fail"]) / n, 4),
        "hit@5": round(sum(r["hit5"] for r in scored) / ns, 4),
        "hit@8_post": round(sum(r["hit8"] for r in scored) / ns, 4),
        "hit@24": round(sum(r["hit24"] for r in scored) / ns, 4),
        "mrr@24": round(sum(r["rr"] for r in scored) / ns, 4),
        "snippet_contains_answer": round(sum(r["snippet_ok"] for r in scored) / ns, 4),
        "latency_ms_post": {"p50": round(pct(lat, 50), 1) if lat else None,
                            "p95": round(pct(lat, 95), 1) if lat else None},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="chỉ in câu hỏi, không gọi mạng")
    ap.add_argument("--bench", default=os.path.join(BENCH_DIR, "recall_bench.jsonl"))
    ap.add_argument("--out", default=os.path.join(BENCH_DIR, "results"))
    args = ap.parse_args()

    qs = [json.loads(l) for l in open(args.bench, encoding="utf-8") if l.strip()]
    if args.dry:
        for r in qs:
            print(f"{r['id']} [{r['zone']}] {r['q']}  → {r['expect_path']} :: {r['expect_substr']!r}")
        print(f"-- dry: {len(qs)} câu, không gọi mạng --")
        return

    token = get_token()
    if not token:
        print("[warn] chạy KHÔNG token — coordinator có auth sẽ trả 401", file=sys.stderr)

    results = []
    for r in qs:
        post, lat_ms, err = http_json("POST", f"{COORD_URL}/recall", token,
                                      {"q": r["q"], "limit": 8})
        post_hits = (post or {}).get("hits") or []
        fail = bool(err) or post is None or (post or {}).get("error") or not post_hits
        # GET limit=24 cho hit@24/MRR (POST bị cap 8)
        qenc = urllib.parse.quote(r["q"])
        get_, _, gerr = http_json("GET", f"{COORD_URL}/recall?q={qenc}&limit=24", token)
        get_hits = (get_ or {}).get("hits") or []

        post_paths = [h.get("file_path") for h in post_hits]
        get_paths = [h.get("file_path") for h in get_hits]
        rank = get_paths.index(r["expect_path"]) + 1 if r["expect_path"] in get_paths else 0
        row = {
            "id": r["id"], "zone": r["zone"], "q": r["q"],
            "expect_path": r["expect_path"],
            "fail": bool(fail), "error": err or (post or {}).get("error"),
            "error_get": gerr,
            "hit5": int(r["expect_path"] in post_paths[:5]),
            "hit8": int(r["expect_path"] in post_paths[:8]),
            "hit24": int(r["expect_path"] in get_paths[:24]),
            "rr": round(1.0 / rank, 4) if rank else 0.0,
            "rank_in_get24": rank or None,
            "snippet_ok": int(any(r["expect_substr"] in (h.get("snippet") or "") for h in post_hits)),
            "latency_ms_post": round(lat_ms, 1),
            "n_hits_post": len(post_hits), "n_hits_get24": len(get_hits),
            "top3_post": post_paths[:3],
        }
        results.append(row)
        print(f"{r['id']} [{r['zone']}] fail={row['fail']} hit5={row['hit5']} "
              f"hit24={row['hit24']} rank24={row['rank_in_get24']} "
              f"snip={row['snippet_ok']} {row['latency_ms_post']}ms")

    out = {
        "date": date.today().isoformat(),
        "coord_url": COORD_URL,
        "bench_file": args.bench,
        "note": "POST /recall cap limit=8 (đường hội thoại thật); hit@24+MRR chấm qua GET /recall?limit=24",
        "overall": agg(results),
        "by_zone": {z: agg([r for r in results if r["zone"] == z])
                    for z in sorted({r["zone"] for r in results})},
        "per_question": results,
    }
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, f"{date.today().isoformat()}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n== overall: {json.dumps(out['overall'], ensure_ascii=False)}")
    for z, m in out["by_zone"].items():
        print(f"== {z}: {json.dumps(m, ensure_ascii=False)}")
    print(f"→ ghi {out_path}")


if __name__ == "__main__":
    main()
