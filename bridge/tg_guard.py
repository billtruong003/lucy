#!/usr/bin/env python3
"""CHẶN VẬN HÀNH: cấm mọi tiến trình phụ gọi getUpdates khi lucy-bridge đang chạy.

Vì sao có file này: ngày 2026-08-17, lệnh chẩn đoán gọi thẳng `getUpdates` đã **cướp 3 update
thật của chủ nhân** (`/new`, `/model`, `/model`) khỏi bridge — Telegram chỉ cho MỘT consumer,
ai gọi sau thì giành mất, và 3 lệnh đó không bao giờ được thực thi.

Luật từ nay:
  • KHÔNG script/lệnh nào được gọi getUpdates trực tiếp khi bridge online.
  • Muốn xem đường nhận có sống không → đọc FILE TRẠNG THÁI bridge tự ghi (tg_diag.py), không poll.
  • Thật sự cần poll để chẩn đoán → phải dừng bridge trước; hàm dưới đây bắt buộc điều đó.
"""
import json
import os
import subprocess


def bridge_pid():
    """PID của lucy-bridge nếu đang online, ngược lại None."""
    try:
        out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=20).stdout
        for p in json.loads(out):
            if p.get("name") == "lucy-bridge" and p.get("pm2_env", {}).get("status") == "online":
                return p.get("pid")
    except Exception:
        pass
    return None


def is_the_bridge():
    """True nếu CHÍNH tiến trình này là bridge (được phép poll)."""
    return bridge_pid() == os.getpid()


def assert_sole_consumer(what="getUpdates"):
    """Ném lỗi nếu gọi khi bridge đang online — chặn cướp update của chủ nhân."""
    pid = bridge_pid()
    if pid and pid != os.getpid():
        raise RuntimeError(
            f"⛔ TỪ CHỐI {what}: lucy-bridge (pid {pid}) đang online và PHẢI là consumer duy nhất.\n"
            f"   Gọi getUpdates song song sẽ CƯỚP update của chủ nhân (đã xảy ra 2026-08-17, mất 3 lệnh).\n"
            f"   • Muốn xem sức khoẻ đường nhận: python3 tg_diag.py   (đọc file trạng thái, KHÔNG poll)\n"
            f"   • Thật sự cần poll: pm2 stop lucy-bridge  trước đã."
        )
    return True


if __name__ == "__main__":
    pid = bridge_pid()
    print(f"lucy-bridge: {'online pid ' + str(pid) if pid else 'không chạy'}")
    try:
        assert_sole_consumer()
        print("→ được phép poll (bridge không chạy)")
    except RuntimeError as e:
        print(e)
