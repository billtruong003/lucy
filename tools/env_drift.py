#!/usr/bin/env python3
"""env_drift.py — bắt lệch env giữa CODE ↔ ecosystem.config.cjs ↔ pm2 RUNTIME (P5).

3 loại drift, nguy hiểm nhất là (1):
  1. RUNTIME-ONLY: env đang set trong pm2 process nhưng KHÔNG có trong ecosystem
     → set tay qua `pm2 restart --update-env` / export — SẼ BAY HƠI khi reboot/resurrect sạch.
  2. VALUE-DRIFT: knob có trong ecosystem nhưng giá trị runtime khác giá trị eco đang khai
     (eco đã sửa mà chưa restart, hoặc set tay đè lên).
  3. CODE-ONLY: knob code đọc nhưng ecosystem không khai (chạy default ngầm — chỉ info).

Exit 1 nếu có loại (1) hoặc (2). Dùng: python3 tools/env_drift.py [--json]
"""
import json, os, re, subprocess, sys

ROOT = "/root/lucy"
ECO = os.path.join(ROOT, "ecosystem.config.cjs")
KNOB_RE = re.compile(r"\b((?:LUCY|AM|PXPIPE|JINA)_[A-Z0-9_]+)\b")
# Env hệ thống / pm2 tự thêm — bỏ qua
IGNORE = {"AM_COORD_URL"}  # dẫn xuất từ COORD trong eco, không phải knob
SECRET_RE = re.compile(r"(PASSWORD|TOKEN|SECRET|KEY|API)", re.I)


def mask(k, v):
    """Không in secret ra log/stdout — chỉ 4 ký tự đầu + độ dài."""
    return f"{v[:4]}…(len={len(v)})" if SECRET_RE.search(k) and v else v


def code_knobs():
    knobs = set()
    cmd = ["grep", "-rhoE", r"process\.env\.((LUCY|AM|PXPIPE|JINA)_[A-Z0-9_]+)",
           os.path.join(ROOT, "agent-machine", "src"), os.path.join(ROOT, "hub", "server"),
           "--include=*.ts"]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    knobs |= {m.split("process.env.")[1] for m in out.split() if "process.env." in m}
    out2 = subprocess.run(["grep", "-rhoE",
                           r"environ(\.get)?\(\s*['\"]((LUCY|AM|PXPIPE|JINA)_[A-Z0-9_]+)",
                           os.path.join(ROOT, "bridge")], capture_output=True, text=True).stdout
    knobs |= set(KNOB_RE.findall(out2) and [m for m in KNOB_RE.findall(out2)])
    return knobs - IGNORE


def eco_knobs():
    src = open(ECO, encoding="utf-8").read()
    # dòng comment không tính
    src = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))
    return set(KNOB_RE.findall(src)) - IGNORE


def eco_declared_values():
    """Giá trị default eco khai dạng process.env.X || 'val' → {X: val}."""
    src = open(ECO, encoding="utf-8").read()
    vals = {}
    for m in re.finditer(r"process\.env\.([A-Z0-9_]+)\s*\|\|\s*(?:\([^)]*\),\s*)?'([^']*)'", src):
        vals[m.group(1)] = m.group(2)
    return vals


def pm2_envs():
    out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=20).stdout
    procs = {}
    for p in json.loads(out):
        name = p.get("name", "")
        if not name.startswith("lucy"):
            continue
        env = p.get("pm2_env", {}).get("env", {})
        procs[name] = {k: str(v) for k, v in env.items() if KNOB_RE.fullmatch(k or "")}
    return procs


def main():
    as_json = "--json" in sys.argv
    ck, ek, ev = code_knobs(), eco_knobs(), eco_declared_values()
    report = {"runtime_only": {}, "value_drift": {}, "code_only": sorted(ck - ek)}

    for proc, env in pm2_envs().items():
        for k, v in sorted(env.items()):
            if k in IGNORE:
                continue
            if k not in ek:
                report["runtime_only"].setdefault(proc, []).append(f"{k}={mask(k, v)[:60]}")
            elif k in ev and ev[k] != "" and v != ev[k]:
                # eco khai default cụ thể mà runtime khác → có thể eco sửa chưa restart
                report["value_drift"].setdefault(proc, []).append(
                    f"{k}: runtime={mask(k, v)[:40]} ≠ eco-default={mask(k, ev[k])[:40]}")

    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        if report["runtime_only"]:
            print("🔴 RUNTIME-ONLY (set tay — BAY HƠI khi reboot, cần đưa vào ecosystem/.env):")
            for proc, ks in report["runtime_only"].items():
                for k in ks:
                    print(f"  {proc}: {k}")
        if report["value_drift"]:
            print("🟡 VALUE-DRIFT (eco ≠ runtime — sửa eco chưa restart, hoặc bị đè tay):")
            for proc, ks in report["value_drift"].items():
                for k in ks:
                    print(f"  {proc}: {k}")
        if report["code_only"]:
            print(f"ℹ️ CODE-ONLY ({len(report['code_only'])} knob chạy default ngầm, không khai trong eco):")
            print("  " + ", ".join(report["code_only"]))
        if not report["runtime_only"] and not report["value_drift"]:
            print("✅ Không drift nguy hiểm (runtime khớp ecosystem).")

    sys.exit(1 if (report["runtime_only"] or report["value_drift"]) else 0)


if __name__ == "__main__":
    main()
