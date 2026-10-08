# L.U.C.Y — Personal AI Agent OS

> Trợ lý cá nhân của Bill: **biết rõ m + mọi dự án, tự làm việc bằng nhiều agent, chạm cả tech-life
> (code/mail/lịch/file/web), tự giỏi lên, chạy cả khi m ngủ — lái từ điện thoại.**
> Chat qua Telegram (bridge → Claude Agent SDK), web cockpit always-on trên VPS.

> 📖 **Single source of truth → [docs/NORTH_STAR.md](docs/NORTH_STAR.md).** Đọc cái đó trước mọi thứ.

**Trạng thái (2026-10-08):** đang chạy hằng ngày trên VPS (Telegram + web cockpit). Đã dọn repo, gom cấu hình PM2 về một nguồn, siết bảo mật đăng nhập/Telegram và nâng model lên Claude 5.5. Cách vận hành hiện tại: **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

## Kiến trúc (gọn)
```
📱 Telegram ──► lucy-bridge (VPS) ──claude -p──► agent-machine (card-engine, multi-persona)
                     │                                  │ --add-dir
                 lucy-hub (web cockpit)            lucy-vault/  (bộ não: Context · Brain · Projects)
                     │                                  │
              Dashboard · Bộ não 🌌 · Board · Settings(lát API)   FTS5 recall + dream + galaxy
```
- **Não** = `claude -p` đi thẳng Anthropic (không proxy). **Lát rẻ** = `agent-machine/src/llm-lane.ts` (7 provider free) cho executor.
- **Nhớ** = `lucy-vault/` (git-tracked markdown, mở được bằng Obsidian).

## Docs
| Doc | Nội dung |
|---|---|
| [docs/OPERATIONS.md](docs/OPERATIONS.md) ⭐ | Process, cấu hình env, lệnh vận hành, bảo mật đang áp dụng — **đọc đầu tiên** |
| [docs/NORTH_STAR.md](docs/NORTH_STAR.md) | Viễn cảnh + lộ trình milestone |
| [docs/AGENT_MACHINE.md](docs/AGENT_MACHINE.md) | Kiến trúc multi-agent card-engine |
| [docs/MCP_ARCHITECTURE.md](docs/MCP_ARCHITECTURE.md) | Kiến trúc M2 (MCP) |
| [docs/M1_MEMORY_SPEC.md](docs/M1_MEMORY_SPEC.md) · [docs/NEURAL_GALAXY.md](docs/NEURAL_GALAXY.md) · [docs/MEMORY_PEAK.md](docs/MEMORY_PEAK.md) | Hệ trí nhớ M1 + tinh hà + peak |
| [docs/PROVIDER_MODELS.md](docs/PROVIDER_MODELS.md) · [docs/MODEL_COMPARISON.md](docs/MODEL_COMPARISON.md) · [docs/COST_MODEL.md](docs/COST_MODEL.md) | Lát API: model + benchmark + token |
| [docs/DEPLOY_HUB.md](docs/DEPLOY_HUB.md) · [docs/REMOTE_CONTROL.md](docs/REMOTE_CONTROL.md) | Deploy hub + remote |
| [docs/_outdated/](docs/_outdated/) | Plan/sprint/handoff cũ, nghiên cứu Hermes — giữ để tra lại |

## Folder
```
LUCY/
├── docs/          # tài liệu — NORTH_STAR.md là gốc
├── bridge/        # Telegram → claude -p (Python)
├── agent-machine/ # card-engine TS (recall/dream/signal/llm-lane/coordinator)
├── hub/           # web cockpit (server + web React)
├── lucy-vault/    # bộ não markdown (Context · Brain · Projects)
├── skills/        # custom Agent Skills (agentskills.io)
├── pxpipe/        # proxy nén token (worker/autopilot)
└── tools/         # script vận hành (vault-backup, env_drift, tavily, crypto…)
```

## Kỷ luật
🔐 Secret **chỉ nằm trong các file env trên VPS** (xem OPERATIONS.md), không paste chat, không `cat`, không ghi cứng trong code.
🔁 1 nguồn sự thật = GitHub: dev ở local → push → VPS `git pull` + `pm2 restart`. Không sửa thẳng 2 nơi.
🧠 Reindex galaxy/recall = `pm2 restart lucy-coordinator` (KHÔNG phải bridge/hub).
