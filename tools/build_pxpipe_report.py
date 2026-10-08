#!/usr/bin/env python3
"""P1.3 — Sinh trang HTML xem payload pxpipe dump (PXPIPE_DUMP_DIR).

Input : thư mục dump (default /root/.pxpipe/payloads) chứa các file
        <stamp>_reqNNN_<model>_pNN.png / _source.txt / _meta.json
Output: <dumpdir>/report/<stem>.html cho từng request + report/index.html tổng.
Chỉ đọc dump dir, chỉ ghi vào dump dir/report. Idempotent, chạy lại chỉ build stem mới.
"""
import html
import json
import re
import sys
from pathlib import Path

DUMP = Path(sys.argv[1] if len(sys.argv) > 1 else "/root/.pxpipe/payloads")
OUT = DUMP / "report"
SUFFIX = re.compile(r"_(p\d+\.png|source\.txt|meta\.json)$")

CSS = """body{font-family:system-ui,sans-serif;margin:16px;background:#111;color:#ddd}
table{border-collapse:collapse}td,th{border:1px solid #444;padding:4px 8px;font-size:13px}
th{background:#222}tr.warn td{background:#3a1414}a{color:#7ab8ff}img{max-width:100%;border:1px solid #333;margin:4px 0}
pre{white-space:pre-wrap;background:#1a1a1a;padding:8px;font-size:12px;max-height:600px;overflow:auto}
.flag{color:#ff6b6b;font-weight:bold}"""


def esc(s):
    return html.escape(str(s))


def collect():
    groups = {}
    for f in DUMP.iterdir():
        if not f.is_file():
            continue
        m = SUFFIX.search(f.name)
        if not m:
            continue
        stem = f.name[: m.start()]
        g = groups.setdefault(stem, {"pngs": [], "source": None, "meta": None})
        kind = m.group(1)
        if kind.endswith(".png"):
            g["pngs"].append(f.name)
        elif kind == "source.txt":
            g["source"] = f.name
        else:
            g["meta"] = f.name
    for g in groups.values():
        g["pngs"].sort()
    return groups


def build_one(stem, g):
    meta = {}
    if g["meta"]:
        try:
            meta = json.loads((DUMP / g["meta"]).read_text())
        except Exception:
            pass
    oc, cc = meta.get("origChars"), meta.get("compressedChars")
    ratio = (cc / oc) if (oc and cc) else None
    rows = "".join(
        f"<tr><th>{esc(k)}</th><td>{esc(json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)}</td></tr>"
        for k, v in meta.items() if k != "usage"
    )
    if meta.get("usage"):
        rows += f"<tr><th>usage</th><td>{esc(json.dumps(meta['usage']))}</td></tr>"
    flag = f"<p class=flag>⚠️ NÉN ÂM: ratio {ratio:.3f} (compressed &gt; orig)</p>" if ratio and ratio > 1 else ""
    imgs = "".join(f"<h3>{esc(p)}</h3><img src='../{esc(p)}' loading=lazy>" for p in g["pngs"])
    src = ""
    if g["source"]:
        try:
            src = f"<h2>Text render vào ảnh (imageSourceText)</h2><pre>{esc((DUMP / g['source']).read_text(errors='replace'))}</pre>"
        except Exception as e:
            src = f"<p>lỗi đọc source: {esc(e)}</p>"
    (OUT / f"{stem}.html").write_text(
        f"<!doctype html><meta charset=utf-8><style>{CSS}</style><title>{esc(stem)}</title>"
        f"<p><a href=index.html>← index</a></p><h1>{esc(stem)}</h1>{flag}"
        f"<table>{rows}</table>{src}<h2>Ảnh model nhìn thấy ({len(g['pngs'])})</h2>{imgs}"
    )
    return {"stem": stem, "ratio": ratio, "origChars": oc, "compressedChars": cc,
            "imageCount": meta.get("imageCount") or len(g["pngs"]),
            "model": meta.get("model"), "pngs": len(g["pngs"])}


def main():
    if not DUMP.is_dir():
        sys.exit(f"dump dir không tồn tại: {DUMP} (Bill chưa bật PXPIPE_DUMP_DIR?)")
    OUT.mkdir(exist_ok=True)
    groups = collect()
    summaries = []
    for stem, g in sorted(groups.items(), reverse=True):
        if not (OUT / f"{stem}.html").exists() or True:  # meta rẻ, build lại luôn cho chắc
            summaries.append(build_one(stem, g))
    trs = ""
    for s in summaries:
        ratio_txt = "{:.3f}".format(s["ratio"]) if s["ratio"] else ""
        cls = "warn" if s["ratio"] and s["ratio"] > 1 else ""
        trs += (
            f"<tr class='{cls}'>"
            f"<td><a href='{esc(s['stem'])}.html'>{esc(s['stem'])}</a></td><td>{esc(s['model'] or '')}</td>"
            f"<td>{esc(s['origChars'] or '')}</td><td>{esc(s['compressedChars'] or '')}</td>"
            f"<td>{ratio_txt}</td><td>{s['imageCount']}</td></tr>"
        )
    (OUT / "index.html").write_text(
        f"<!doctype html><meta charset=utf-8><style>{CSS}</style><title>pxpipe payloads</title>"
        f"<h1>pxpipe payload dump — {len(summaries)} request</h1>"
        f"<p>Đỏ = nén âm (compressed &gt; orig). Retention 48h.</p>"
        f"<table><tr><th>request</th><th>model</th><th>orig</th><th>compressed</th><th>ratio</th><th>img</th></tr>{trs}</table>"
    )
    print(f"OK: {len(summaries)} request → {OUT}/index.html")


if __name__ == "__main__":
    main()
