#!/usr/bin/env python3
"""Quét + che secret cho evidence bundle TRƯỚC khi gửi ra ngoài.

Hai lớp:
  1. GIÁ TRỊ THẬT: đọc mọi file .env trên máy, lấy giá trị bí mật rồi tìm CHÍNH XÁC chuỗi đó
     trong file bundle (bắt được cả khi secret nằm trong log/JSON mà regex không đoán ra).
  2. MẪU: regex cho token/key phổ biến (Bearer, sk-, jina_, ghp_, xox, AKIA, KEY=..., chuỗi dài base64).

Chạy:  python3 bundle_scrub.py <thư_mục_ra> <file1> [file2 ...]
In báo cáo: file nào bị che, che bao nhiêu chỗ, loại gì. KHÔNG in giá trị secret.
"""
import os
import re
import sys
import shutil

ENV_FILES = [
    "/root/lucy/bridge/.env",
    "/root/lucy/agent-machine/.env",
    "/root/lucy/.env.llm",
    "/root/lucy/hub/server/.env",
    "/root/lucy/.env",
]
# Tên biến coi là BÍ MẬT (giá trị sẽ bị săn tìm nguyên văn trong bundle).
SECRET_KEYS = re.compile(
    r"(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|SESSION|AUTH|BEARER|PRIVATE)", re.I)
# Giá trị quá ngắn/quá phổ thông thì bỏ qua để không che nhầm chữ thường.
MIN_SECRET_LEN = 8
SAFE_VALUES = {"1", "0", "true", "false", "on", "off", "none", "null", "claude", "sonnet", "opus"}

PATTERNS = [
    (re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{8,}", re.I), "Bearer [REDACTED]"),
    (re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_\-]{16,}"), "[REDACTED-APIKEY]"),
    (re.compile(r"\bjina_[A-Za-z0-9]{16,}"), "[REDACTED-JINA]"),
    (re.compile(r"\b(?:ghp|gho|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}"), "[REDACTED-GITHUB]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), "[REDACTED-SLACK]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED-AWS]"),
    (re.compile(r"\bgsk_[A-Za-z0-9]{20,}"), "[REDACTED-GROQ]"),
    (re.compile(r"\bcsk-[A-Za-z0-9]{20,}"), "[REDACTED-CEREBRAS]"),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"), "[REDACTED-GOOGLE]"),
    (re.compile(r"\b\d{8,10}:AA[A-Za-z0-9_\-]{30,}"), "[REDACTED-TELEGRAM-BOT]"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}"), "[REDACTED-ANTHROPIC]"),
    # KEY=value / "token": "value"
    (re.compile(r"([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|ACCESS[_-]?KEY)[A-Za-z0-9_]*)"
                r"(\s*[=:]\s*)([\"']?)([^\s\"',}]{6,})", re.I), r"\1\2\3[REDACTED]"),
]


def load_real_secrets():
    """Đọc giá trị bí mật thật từ .env để săn nguyên văn. KHÔNG in ra."""
    vals = set()
    for p in ENV_FILES:
        try:
            for line in open(p, encoding="utf-8", errors="ignore"):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                if SECRET_KEYS.search(k) and len(v) >= MIN_SECRET_LEN and v.lower() not in SAFE_VALUES:
                    vals.add(v)
        except Exception:
            pass
    # thêm bot-token đang chạy trong process (nếu env có)
    for k, v in os.environ.items():
        if SECRET_KEYS.search(k) and isinstance(v, str) and len(v) >= MIN_SECRET_LEN and v.lower() not in SAFE_VALUES:
            vals.add(v)
    return sorted(vals, key=len, reverse=True)   # dài trước → tránh che một phần


def scrub_text(text, real_secrets):
    hits = {}
    for v in real_secrets:
        if v in text:
            n = text.count(v)
            text = text.replace(v, "[REDACTED-SECRET]")
            hits["giá-trị-thật-từ-.env"] = hits.get("giá-trị-thật-từ-.env", 0) + n
    for pat, repl in PATTERNS:
        text, n = pat.subn(repl, text)
        if n:
            label = repl if isinstance(repl, str) and repl.startswith("[") else "KEY=value"
            hits[label] = hits.get(label, 0) + n
    return text, hits


def main():
    outdir = sys.argv[1]
    files = sys.argv[2:]
    os.makedirs(outdir, exist_ok=True)
    real = load_real_secrets()
    print(f"🔑 nạp {len(real)} giá trị bí mật thật để đối chiếu (không in ra)\n")
    total = 0
    for f in files:
        if not os.path.exists(f):
            print(f"  ⚠️  thiếu file: {f}")
            continue
        name = os.path.basename(f)
        dst = os.path.join(outdir, name)
        try:
            raw = open(f, encoding="utf-8", errors="replace").read()
        except Exception as e:
            print(f"  ⚠️  không đọc được {name}: {e}")
            continue
        clean, hits = scrub_text(raw, real)
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(clean)
        n = sum(hits.values())
        total += n
        size = os.path.getsize(dst)
        status = f"đã che {n} chỗ ({', '.join(f'{k}×{v}' for k, v in hits.items())})" if n else "sạch"
        print(f"  {'🧹' if n else '✅'} {name:34} {size:>9,} B  — {status}")
    print(f"\nTổng số chỗ đã che: {total}")
    print(f"Bundle sạch nằm ở: {outdir}")


if __name__ == "__main__":
    main()
