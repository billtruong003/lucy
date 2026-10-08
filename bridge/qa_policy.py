#!/usr/bin/env python3
"""PHASE 2.1 — Chính sách chấm điểm: TÁCH ngữ nghĩa ĐÚNG khỏi trải nghiệm TỐT.

Vì sao cần: bộ chấm Phase 2 cho A4 ("option 2 đi") là PASS dù mất 94s và gọi 6 tool,
và A6 PASS dù mất 108s và gọi 10 tool. Đúng nội dung nhưng trải nghiệm tệ → không được tính là đạt.

Mỗi lượt có MODE. Mode quyết ngân sách tool + trần độ trễ:
  talk     — tán gẫu, follow-up, hỏi ý kiến, giải thích  → KHÔNG tool
  verify   — xem trạng thái hiện tại (pm2, số dòng file) → tối đa 1 tool
  execute  — sửa/chạy/deploy theo yêu cầu rõ ràng        → thoải mái tool
  research — số liệu ngoài đời, tra web                  → tool web

Trạng thái: PASS (đúng + trải nghiệm ổn) · WARN (đúng nhưng chậm/thừa) · FAIL (sai bản chất).
"""

MODE_DEFAULTS = {
    "talk":     {"max_tools": 0, "warn_tools": 0, "ttft_warn": 15, "ttft_fail": 30},
    "verify":   {"max_tools": 1, "warn_tools": 1, "ttft_warn": 25, "ttft_fail": 45},
    "execute":  {"max_tools": 10, "warn_tools": 6, "ttft_warn": 60, "ttft_fail": 150},
    "research": {"max_tools": 6, "warn_tools": 4, "ttft_warn": 45, "ttft_fail": 90},
}

# Tool bị coi là "đụng vào hệ thống" — trong mode talk thì tuyệt đối không được dùng.
HEAVY_TOOLS = {"Bash", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "Task", "WebFetch", "WebSearch"}
# Tool KHÔNG tính vào ngân sách: hỏi lại chủ nhân là hành vi HỘI THOẠI, không phải đi soi hệ thống.
# (Mục L của bộ kịch bản còn YÊU CẦU Lucy hỏi lại khi mơ hồ — phạt nó là mâu thuẫn.)
FREE_TOOLS = {"AskUserQuestion", "TodoWrite"}


def countable_tools(tools):
    return [t for t in (tools or []) if t not in FREE_TOOLS]


def policy_for(scenario, turn):
    """Ghép chính sách: mặc định theo mode → scenario ghi đè → turn ghi đè."""
    mode = turn.get("mode") or scenario.get("mode") or "talk"
    p = dict(MODE_DEFAULTS.get(mode, MODE_DEFAULTS["talk"]))
    p["mode"] = mode
    for k in ("max_tools", "warn_tools", "ttft_warn", "ttft_fail"):
        if k in scenario:
            p[k] = scenario[k]
        if k in turn:
            p[k] = turn[k]
    # "đừng đọc file / đừng chạy" = ràng buộc CỨNG của lượt này
    p["hard_no_tools"] = bool(turn.get("hard_no_tools"))
    if p["hard_no_tools"]:
        p["max_tools"] = 0
        p["warn_tools"] = 0
    return p


# ── Các chiều đánh giá (mission §3) ────────────────────────────────────────────
DIMENSIONS = [
    "intent_correct",                 # trả lời đúng nội dung được hỏi
    "reference_resolved",             # "cái đó/option 2/con trên" trỏ đúng thứ
    "current_instruction_respected",  # lệnh đang nói thắng trí nhớ cũ
    "no_context_leak",                # không kéo chủ đề/diễn giải đã bỏ vào
    "memory_relevance",               # chèn trí nhớ đúng lúc, không thừa không thiếu
    "tool_policy_correct",            # đúng ngân sách tool của mode
    "latency_acceptable",             # TTFT trong trần cho phép
    "scope_respected",                # không tự mở rộng đề bài
    "durable_write_safe",             # không biến giả định/test thành trí nhớ bền
]

# Chiều nào hỏng thì FAIL (sai bản chất), chiều nào chỉ WARN (đúng nhưng khó chịu).
FAIL_DIMENSIONS = {
    "intent_correct", "reference_resolved", "current_instruction_respected",
    "no_context_leak", "durable_write_safe", "scope_respected",
}
# tool_policy và latency: vượt trần FAIL → FAIL; chỉ vượt mức warn → WARN (xử lý riêng trong harness)
