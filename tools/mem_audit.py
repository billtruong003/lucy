#!/usr/bin/env python3
"""mem_audit — quét & tổng hợp memory + vault + cron để biết chuyện gì đang diễn ra.

Usage:
  python3 tools/mem_audit.py                 # full digest
  python3 tools/mem_audit.py --section vault # vault | memory | db | cron
  python3 tools/mem_audit.py --since 14      # chỉ nhìn 14 ngày gần đây
  python3 tools/mem_audit.py --grep radiant  # lọc theo keyword (file path + nội dung note/turn)
  python3 tools/mem_audit.py --top 20        # số dòng mỗi bảng xếp hạng
Read-only: không sửa/xóa gì. DB mở mode=ro.
"""
import argparse, os, re, sqlite3, subprocess, sys, time
from datetime import datetime, timedelta
from pathlib import Path

VAULT = Path(os.environ.get("LUCY_VAULT", "/root/lucy/lucy-vault"))
MEMORY_MD = VAULT / "MEMORY.md"
DB = VAULT / ".index" / "memory.db"
LOG_DIR = Path("/root/lucy")
NOW = time.time()

def hsize(n):
    for u in ("B", "K", "M", "G"):
        if n < 1024: return f"{n:.0f}{u}"
        n /= 1024
    return f"{n:.1f}T"

def age_days(mtime): return (NOW - mtime) / 86400

def section(title): print(f"\n{'='*8} {title} {'='*8}")

# ---------- VAULT ----------
def scan_vault(since, grep, top):
    section("VAULT (files)")
    rows, total_sz = [], 0
    for p in VAULT.rglob("*"):
        if not p.is_file(): continue
        rel = p.relative_to(VAULT)
        parts = rel.parts
        if parts[0] in (".git", ".index", ".obsidian"): continue
        st = p.stat()
        if since and age_days(st.st_mtime) > since: continue
        if grep and grep.lower() not in str(rel).lower(): continue
        rows.append((str(rel), parts[0] if len(parts) > 1 else "(root)", st.st_size, st.st_mtime))
        total_sz += st.st_size

    by_folder = {}
    for rel, folder, sz, mt in rows:
        d = by_folder.setdefault(folder, [0, 0, 0, 0])  # count, size, newest, stale90
        d[0] += 1; d[1] += sz; d[2] = max(d[2], mt)
        if age_days(mt) > 90: d[3] += 1
    print(f"{len(rows)} files, {hsize(total_sz)} (đã loại .git/.index)")
    print(f"{'folder':<14}{'files':>7}{'size':>8}{'mới nhất':>12}{'>90d cũ':>9}")
    for f, (c, sz, mt, stale) in sorted(by_folder.items(), key=lambda x: -x[1][1]):
        print(f"{f:<14}{c:>7}{hsize(sz):>8}{datetime.fromtimestamp(mt).strftime('%Y-%m-%d'):>12}{stale:>9}")

    print(f"\n-- {top} file lớn nhất --")
    for rel, _, sz, mt in sorted(rows, key=lambda r: -r[2])[:top]:
        print(f"  {hsize(sz):>7}  {datetime.fromtimestamp(mt).strftime('%Y-%m-%d')}  {rel}")
    print(f"\n-- {top} file mới sửa gần nhất --")
    for rel, _, sz, mt in sorted(rows, key=lambda r: -r[3])[:top]:
        print(f"  {datetime.fromtimestamp(mt).strftime('%Y-%m-%d %H:%M')}  {hsize(sz):>7}  {rel}")

    # Daily session-card burn rate
    daily = [r for r in rows if r[1] == "Daily"]
    if daily:
        by_day = {}
        for rel, *_ in daily:
            m = re.match(r"Daily/(\d{4}-\d{2}-\d{2})", rel)
            if m: by_day[m.group(1)] = by_day.get(m.group(1), 0) + 1
        days = sorted(by_day)
        if days:
            avg = len(daily) / max(len(by_day), 1)
            print(f"\nDaily: {len(daily)} cards / {len(by_day)} ngày ({days[0]} → {days[-1]}), ~{avg:.1f} card/ngày")

# ---------- MEMORY.md ----------
def scan_memory_md(grep):
    section("MEMORY.md")
    if not MEMORY_MD.exists():
        print("KHÔNG TỒN TẠI"); return
    text = MEMORY_MD.read_text(errors="replace")
    lines = text.splitlines()
    st = MEMORY_MD.stat()
    print(f"{hsize(st.st_size)}, {len(lines)} dòng, sửa lần cuối {datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}")
    print("\n-- Section (## heading, số dòng) --")
    cur, count, out = None, 0, []
    for ln in lines:
        if ln.startswith("## "):
            if cur: out.append((cur, count))
            cur, count = ln[3:].strip(), 0
        elif cur: count += 1
    if cur: out.append((cur, count))
    for h, c in out:
        mark = " ←" if grep and grep.lower() in h.lower() else ""
        print(f"  {c:>5} dòng  {h}{mark}")
    dates = re.findall(r"\b(2\d{3}-\d{2}-\d{2})\b", text)
    if dates:
        print(f"\nDate stamp trong nội dung: {min(dates)} → {max(dates)} ({len(dates)} mốc)")

# ---------- memory.db ----------
def scan_db(since, grep, top):
    section("memory.db (index)")
    if not DB.exists():
        print("KHÔNG TỒN TẠI"); return
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row

    def count(t):
        try: return db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        except Exception: return "?"
    print(f"size {hsize(DB.stat().st_size)} (+wal {hsize((DB.parent/'memory.db-wal').stat().st_size) if (DB.parent/'memory.db-wal').exists() else 0})")
    print(f"note={count('note')}  turns={count('turns')}  obs_fts={count('obs_fts')}  relation={count('relation')}  vec_note_rowids={count('vec_note_rowids')}")

    # tìm cột thời gian có thật để không đoán mò
    def cols(t):
        try: return [r[1] for r in db.execute(f'PRAGMA table_info("{t}")')]
        except Exception: return []
    for t in ("note", "turns"):
        cs = cols(t)
        tcol = next((c for c in ("created_at", "mtime", "ts", "updated_at", "created") if c in cs), None)
        print(f"\n-- {t} (cols: {', '.join(cs)}) --")
        if not tcol:
            print("  (không thấy cột thời gian — bỏ qua phân bố theo ngày)"); continue
        try:
            rows = db.execute(f'SELECT {tcol} FROM "{t}"').fetchall()
            days = {}
            for (v,) in rows:
                if v is None: continue
                if isinstance(v, (int, float)):
                    sec = v / 1000 if v > 10**12 else v
                    d = datetime.fromtimestamp(sec).strftime("%Y-%m-%d")
                else:
                    d = str(v)[:10]
                days[d] = days.get(d, 0) + 1
            keys = sorted(days)
            if since:
                cutoff = (datetime.now() - timedelta(days=since)).strftime("%Y-%m-%d")
                keys = [k for k in keys if k >= cutoff]
            print(f"  range {keys[0] if keys else '?'} → {keys[-1] if keys else '?'}; {top} ngày nhiều bản ghi nhất:")
            for d in sorted(keys, key=lambda k: -days[k])[:top]:
                print(f"    {d}: {days[d]}")
        except Exception as e:
            print(f"  ERR: {e}")

    if grep:
        print(f"\n-- grep '{grep}' trong note/turns --")
        for t, c in (("note_fts", "note_fts"), ("turns_fts", "turns_fts")):
            try:
                n = db.execute(f'SELECT COUNT(*) FROM {t} WHERE {t} MATCH ?', (grep,)).fetchone()[0]
                print(f"  {t}: {n} hits")
            except Exception as e:
                print(f"  {t}: ERR {e}")
    db.close()

# ---------- CRON ----------
def scan_cron(top):
    section("CRON")
    try:
        tab = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        print("crontab không có"); return
    jobs = [l for l in tab.splitlines() if l.strip() and not l.startswith("#")]
    print(f"{len(jobs)} job:")
    for j in jobs:
        m = re.search(r">>\s*(\S+)", j)
        log = m.group(1) if m else None
        stat = ""
        if log:
            lp = Path(log if log.startswith("/") else f"/root/lucy-workspace/portfolio/{log}")
            if lp.exists():
                st = lp.stat()
                tail = subprocess.run(["tail", "-n", "50", str(lp)], capture_output=True, text=True).stdout
                errs = len(re.findall(r"(?i)\b(error|traceback|fail(ed|ure)?)\b", tail))
                stat = f"log {hsize(st.st_size)}, ghi {datetime.fromtimestamp(st.st_mtime):%m-%d %H:%M}" + (f", ⚠{errs} err@tail50" if errs else ", sạch")
            else:
                stat = "⚠ LOG KHÔNG TỒN TẠI"
        sched = " ".join(j.split()[:5])
        cmd = " ".join(j.split()[5:])
        cmd = (cmd[:70] + "…") if len(cmd) > 70 else cmd
        print(f"  [{sched}] {cmd}\n      → {stat}")
    # log mồ côi: *.log ở /root/lucy không được job nào trỏ tới
    reffed = set(re.findall(r">>\s*(\S+)", tab))
    orphans = [p for p in LOG_DIR.glob("*.log") if str(p) not in reffed]
    if orphans:
        print(f"\n-- {len(orphans)} log mồ côi (không cron job nào trỏ tới) --")
        for p in sorted(orphans, key=lambda p: -p.stat().st_size)[:top]:
            print(f"  {hsize(p.stat().st_size):>7}  ghi {datetime.fromtimestamp(p.stat().st_mtime):%m-%d %H:%M}  {p.name}")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--section", choices=["vault", "memory", "db", "cron"], help="chỉ chạy 1 mảng")
    ap.add_argument("--since", type=int, help="chỉ tính file/bản ghi N ngày gần đây")
    ap.add_argument("--grep", help="lọc theo keyword")
    ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    print(f"mem_audit @ {datetime.now():%Y-%m-%d %H:%M} | vault={VAULT}" + (f" | since={a.since}d" if a.since else "") + (f" | grep={a.grep}" if a.grep else ""))
    if a.section in (None, "vault"): scan_vault(a.since, a.grep, a.top)
    if a.section in (None, "memory"): scan_memory_md(a.grep)
    if a.section in (None, "db"): scan_db(a.since, a.grep, a.top)
    if a.section in (None, "cron"): scan_cron(a.top)

if __name__ == "__main__":
    main()
