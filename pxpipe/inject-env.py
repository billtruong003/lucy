#!/usr/bin/env python3
"""Gắn ANTHROPIC_BASE_URL=pxpipe vào 1 process pm2 đang chạy, tái dựng env sống từ /proc
(null-safe, không word-splitting) rồi pm2 restart --update-env. Dùng bởi on.sh khi phát hiện
process bị rớt env pxpipe (thường sau 1 lần restart tay/độc lập không qua on.sh)."""
import json, subprocess, sys

PXURL = "http://127.0.0.1:47821"

def main():
    if len(sys.argv) != 2:
        print("usage: inject-env.py <pm2-process-name>"); sys.exit(1)
    name = sys.argv[1]
    jlist = json.loads(subprocess.check_output(["pm2", "jlist"]))
    pids = [p["pid"] for p in jlist if p["name"] == name and p["pm2_env"]["status"] == "online"]
    if not pids:
        print(f"BỎ QUA {name}: không chạy"); sys.exit(1)

    env = {}
    with open(f"/proc/{pids[0]}/environ", "rb") as f:
        for kv in f.read().split(b"\0"):
            if b"=" in kv:
                k, v = kv.split(b"=", 1)
                env[k.decode()] = v.decode()

    env["ANTHROPIC_BASE_URL"] = PXURL
    subprocess.run(["pm2", "restart", name, "--update-env"], env=env, check=True,
                    stdout=subprocess.DEVNULL)
    print(f"vá xong {name} (pid cũ {pids[0]})")

if __name__ == "__main__":
    main()
