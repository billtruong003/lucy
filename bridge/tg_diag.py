#!/usr/bin/env python3
"""Chẩn đoán đường Telegram AN TOÀN — đọc FILE TRẠNG THÁI bridge tự ghi.

KHÔNG gọi getUpdates. Đây là cách thay thế cho việc poll song song — thứ đã cướp 3 lệnh thật
của chủ nhân ngày 2026-08-17.

Chạy: python3 tg_diag.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tg_guard  # noqa: E402

STATUS = os.path.expanduser(os.environ.get("LUCY_STATUS_FILE", "~/.lucy-bridge-status.json"))
OFFSET = os.path.expanduser("~/.lucy-bridge-offset.json")


def age(ts):
    if not ts:
        return "chưa từng"
    d = int(time.time() - ts)
    if d < 90:
        return f"{d}s trước"
    if d < 5400:
        return f"{d // 60} phút trước"
    if d < 172800:
        return f"{d // 3600} giờ trước"
    return f"{d // 86400} ngày trước"


def main():
    pid = tg_guard.bridge_pid()
    print(f"lucy-bridge: {'online pid ' + str(pid) if pid else '❌ KHÔNG chạy'}")
    if not os.path.exists(STATUS):
        print(f"⚠️  chưa có file trạng thái {STATUS} — bridge chưa hoàn tất vòng poll nào từ lúc nâng cấp.")
        print("    (file chỉ được ghi sau mỗi vòng getUpdates, tức tối đa ~50s sau khi khởi động)")
    else:
        d = json.load(open(STATUS, encoding="utf-8"))
        stale = time.time() - (d.get("written_at") or 0)
        print(f"file trạng thái: ghi {age(d.get('written_at'))}" + ("  ⚠️ CŨ" if stale > 180 else ""))
        print(f"pid trong file: {d.get('pid')} · engine: {d.get('engine')}")
        print()
        print("── ĐƯỜNG NHẬN ──")
        print(f"  poll thành công : {d.get('poll_ok_total')} lần · lần cuối {age(d.get('last_poll_ok_at'))}")
        print(f"  poll lỗi        : {d.get('poll_error_total')} lần"
              + (f" · gần nhất: {d.get('last_poll_error')}" if d.get("last_poll_error") else ""))
        print(f"  update nhận     : {d.get('updates_received_total')} · id cuối {d.get('last_update_id')}"
              f" · {age(d.get('last_update_at'))}")
        print(f"  update bỏ qua   : {d.get('updates_ignored_total')}"
              + (f" · lý do cuối: {d.get('last_ignore_reason')}" if d.get("last_ignore_reason") else ""))
        print()
        print("── ĐƯỜNG LỆNH ──")
        print(f"  lệnh nhận       : {d.get('commands_received_total')}"
              f" · lệnh cuối: {d.get('last_command') or '—'} ({age(d.get('last_command_at'))})")
        print(f"  lệnh chạy xong  : {d.get('commands_executed_total')}"
              f" · hỏng: {d.get('commands_failed_total')}")
        print(f"  kết quả cuối    : {d.get('last_command_result') or '—'}")
        tr = d.get("trace") or []
        if tr:
            print()
            print("── TRACE gần nhất (chỉ metadata) ──")
            for t in tr[-8:]:
                bits = [f"{k}={v}" for k, v in t.items() if k != "at"]
                print(f"  {age(t.get('at')):>14} · " + " ".join(bits))

    print()
    try:
        off = json.load(open(OFFSET))["offset"]
        mt = os.path.getmtime(OFFSET)
        print(f"offset đã xác nhận: {off} · file ghi lần cuối {age(mt)}")
        print("  (offset CHỈ được ghi khi có update thật đi qua — đứng im = không có tin mới,")
        print("   KHÔNG phải dấu hiệu hỏng. Xem 'poll thành công' ở trên để biết đường nhận sống hay chết.)")
    except Exception as e:
        print("offset: không đọc được:", e)

    print()
    print("⛔ Nhắc: TUYỆT ĐỐI không chạy getUpdates song song khi bridge đang online.")


if __name__ == "__main__":
    main()
