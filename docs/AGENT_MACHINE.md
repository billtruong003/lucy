# Lucy — Agent Machine (kiến trúc CHỐT)

> **Chốt 2026-06-07.** Bộ máy multi-agent tự chạy kiểu **Kanban**: card công việc trôi qua pipeline,
> mỗi stage một **persona agent** chạy `claude -p`, tự đẩy tiếp; **chỉ dừng hỏi người ở quyết định quan trọng**;
> agent giao tiếp trong **channels** đọc/điều khiển được trong dashboard. Hybrid: **lib lo phần khô, ta sở hữu phần hồn**.
> Neo: [lucy-roadmap step 2] · topology [REMOTE_CONTROL.md](REMOTE_CONTROL.md) · vision [VISION_2026.md](_outdated/VISION_2026.md).
> Lib chốt từ deep-research 2026-06-07 (27 nguồn, verify adversarial).

---

## 0. Một câu
VPS = **anchor always-on** (coordinator + board + channels + queue, NHẸ, KHÔNG chạy agent). Máy local mạnh = **worker** quay ra pull card → chạy `claude -p` trong workspace cô lập → đẩy kết quả + message kênh về. Bạn đọc/duyệt từ mọi nơi.

## 1. Topology (anchor + worker)
```
VPS 2GB (always-on, NHẸ) = COORDINATOR/COCKPIT        MÁY LOCAL (mạnh) = WORKER
 hub UI · board · channels · queue · gates · ledger    chạy claude -p (cap lane) · repos · claude.exe
 Postgres (pg-boss + DBOS)                              dial OUT → pull card → làm → stream về
 KHÔNG spawn claude -p  ◄────── pull / result ─────────
```
**Nguyên tắc: VPS chạy worker GIỚI HẠN (cap ~2 lane `claude -p`)** — cho cron/research + chat + **fallback khi local tắt** (đủ nhẹ, không OOM). **Máy local = worker NẶNG (cap cao)** cho bulk dev, on-demand. Cả hai đều quay vào coordinator: local tắt → VPS gánh (chậm hơn, capped); local bật → hút bulk. (WoL bật-từ-xa = remote phase sau.)

## 2. Mô hình lõi — config-là-DATA (Open/Closed)
Engine generic & đóng; mọi tuỳ biến là **data** (thêm persona/pipeline = thêm data, không sửa code). Lucy tự ghi config từ prompt + ảnh.
```
Persona  { id, name, avatar, systemPrompt, model, allowedTools, timeout, tags }
Pipeline { id, name, stages:[{ id, name, personaId, gate? }] }     ← per-project, không cố định
Project  { id, name, pipelineId }
Card     { id, title, brief, pipelineId, stageIndex, status, workspace, history, parentId, blockedBy, cost }
Channel  message { ts, channel, author, kind, text, cardId }
Outcome  { decision: advance|done|needs_decision|delegate|fail, summary, question?, delegateTo? }
```
Storage = file/DB editable: `config/personas/`, `config/pipelines/`, `assets/avatars/`.

## 3. Stack CHỐT (hybrid: adopt lib khô / build phần hồn)
| Lớp | Chốt | Adopt/Build | Lý do (verified) |
|---|---|---|---|
| DB xương sống | **Postgres** | adopt | pg-boss + DBOS đều dùng PG → 1 dep, bỏ Redis. ~50–150MB tuned → fit 2GB |
| Job queue (worker pull) | **pg-boss** | adopt | exactly-once · cron · retry+backoff · dead-letter · enqueue trong transaction |
| Durable exec + HITL pause/resume | **DBOS Transact (TS)** | adopt | library (không server như Temporal) · checkpoint PG → **auto-resume sau crash** · HITL `recv()`/pause/resume |
| Orchestration (Kanban/DAG/persona/channels/cockpit) | **in-house** | build | Không framework nào center subprocess `claude -p`; Mastra gap không auto-resume; VoltAgent in-process |
| FS defense | **CC sandbox (Linux) + git worktree + restricted user + allowlist** | adopt+build | CC sandbox (bubblewrap, khoá CWD) KHÔNG chạy Windows + có bypass → defense-in-depth |
| Cost guardrail (cửa 5h/tuần) | **in-house kiểu ccusage** | build | `ccusage` parse "blocks" 5h; ta parse JSON `claude -p` + track window → auto-pause |
| Channels | **in-house thin** (msg-as-data + ws) | build | Không lib đáng adopt; phức tạp thật = routing/hold (việc engine) |

Refs: [pg-boss](https://github.com/timgit/pg-boss) · [Graphile Worker](https://worker.graphile.org) (alt throughput) · [DBOS Transact TS](https://github.com/dbos-inc/dbos-transact-ts) · [CC sandbox](https://www.anthropic.com/engineering/claude-code-sandboxing) · [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) · [ccusage](https://github.com/ryoppippi/ccusage).

## 4. Engine loop (pseudocode)
```
tick():
  if budget.over_window(): pause(); return                  # guardrail token
  for card in actionable(status∈{queued,working}, not blocked, lanes_free):
    stage   = pipeline(card).stages[card.stageIndex]
    persona = personas[stage.personaId]
    ws      = isolatedWorkspace(card)                        # git worktree = blast radius
    res     = runner.run(card, stage, persona, ws)          # claude -p (local worker)
    ledger.add(res.cost); channel.post(card.thread, 'status', res.outcome.summary)
    switch res.outcome.decision:
      advance:       if stage.gate: block_for_human(card)    # gate = chỉ chỗ quan trọng
                     else card.stageIndex++ (or done if last)
      needs_decision:block_for_human(card, question)         # agent tự raise gate
      delegate:      child = createCard(delegateTo); card.blockedBy += child.id   # DAG hold
      done:          card.status = done
      fail:          card.status = failed
  resolve_unblocks()                                         # child done → parent resume
```
Human approve (dashboard/Telegram) → unblock card → tick tiếp. Gate/blocked card **nhả lane**.

## 5. Guardrails (5 — bắt buộc)
1. **Durability** — board/card/queue trên Postgres (pg-boss + DBOS checkpoint) → restart resume, không mất card.
2. **Token budget cửa 5h/tuần** — parse cost/usage JSON `claude -p` → ledger theo window → **auto-PAUSE** cả máy khi chạm ngưỡng cứng; ping mềm ở 80%; per-card max-token; **loop circuit-breaker** (card nảy N lần → halt).
3. **Agent↔engine protocol** — persona BẮT BUỘC kết thúc bằng JSON outcome (schema chặt); cap số vòng reject-back; tiêu chí gate rõ.
4. **FS defense** — agent chạy trong **git worktree riêng** (xoá sạch chỉ chết workspace) + CC sandbox (Linux) + restricted user + **protected-paths allowlist** (hard-deny) + gate cho irreversible (push/rm/deploy).
5. **Config validation/version** — config Lucy tự ghi phải validate schema + version (rollback được).

## 6. Build phases + walking-skeleton
| Lát | Việc |
|---|---|
| **SKELETON** ⭐ | 1 project · 2 stage · 1 persona · 1 card · runner → outcome → advance · 1 gate · channel · budget guard · workspace cô lập — **end-to-end, mock runner trước (không đốt token)** |
| M2.1 Substrate | Coordinator + worker dial-out + **pg-boss** queue + cap lane + **DBOS** lifecycle + ledger |
| M2.2 Config layer | Persona registry (prompt+avatar) + Pipeline model + tab Personas/Pipeline |
| M2.3 Engine | Auto-process DAG (delegate/block/resume) đầy đủ |
| M2.4 Channels | Bus đầy đủ (server + agent tự post) + thread/card + tab Channels |
| M2.5 Gates+HITL | Decision gate + ping Telegram + reply feed ngược |
| M2.6 Meta-author | Lucy tạo persona/pipeline từ prompt+ảnh |
| M2.7 Observability | BrainViz: agent live = node + tiến độ/ngày |

**Skeleton-first**: validate lõi engine↔agent↔gate↔budget với **MockRunner** (free) → rồi swap **ClaudeRunner** thật + cắm pg-boss/DBOS/Postgres.

## 7. Open questions (verify lúc build)
- Field JSON cost chính xác của `claude -p` (research gap) — đo thực tế lúc làm ClaudeRunner.
- FS-defense Windows cụ thể (CC sandbox không chạy Win) — worktree + restricted user + ACL + allowlist.
- DBOS vs chỉ pg-boss + state-table (DBOS cho auto-resume free nhưng thêm coupling) — quyết ở M2.1.

## 8. Deploy coordinator lên VPS (prompt cho Claude Code TRÊN VPS)

Coordinator chạy trên VPS (nhẹ, **không** spawn claude). Worker chạy trên máy local (dial ra). Paste block:

````
Bạn là Claude Code trên VPS Ubuntu của tôi. Deploy "Lucy Agent-Machine COORDINATOR" — server điều phối
multi-agent (Node/TS, repo ở ~/lucy, thư mục agent-machine/). Coordinator NHẸ: giữ board/queue/channels,
TUYỆT ĐỐI KHÔNG chạy `claude -p` (agent chạy ở máy local của tôi qua worker). Always-on sau pm2 (+ nginx TLS).

LUẬT SECRET: KHÔNG hỏi tôi token qua chat; KHÔNG echo/cat secret. Tôi tự nano.

Các bước:
1. `cd ~/lucy && git pull`. `cd ~/lucy/agent-machine && npm install`.
2. Tạo `~/lucy/agent-machine/.env` (tôi tự nano đặt AM_TOKEN=<chuỗi ngẫu nhiên mạnh, `openssl rand -hex 24`>):
     AM_PORT=8780
     AM_DATA=/root/.agent-machine
     AM_CAP_USD=20            # cap cửa 5h (auto-pause)
     AM_WEEKLY_CAP_USD=120    # cap tuần
     AM_PER_CARD_USD=5
   (tsx tự đọc env từ shell; dùng `set -a; . .env; set +a` hoặc nạp qua pm2 ecosystem.)
3. Chạy thử nền: `set -a; . .env; set +a; npx tsx src/coordinator-main.ts &` rồi
   `curl -s 127.0.0.1:8780/health` phải ra JSON `{ok:true}`. Tắt thử nghiệm.
4. pm2 always-on: tạo ecosystem hoặc
   `AM_TOKEN=$AM_TOKEN AM_PORT=8780 AM_DATA=/root/.agent-machine pm2 start "npx tsx src/coordinator-main.ts" --name lucy-coordinator --cwd ~/lucy/agent-machine`
   rồi `pm2 save && pm2 startup`.
5. Nginx TLS (để worker local nối an toàn): proxy `https://<domain-hoặc-subdomain>` → `127.0.0.1:8780`
   (read/send timeout 1200s). `nginx -t && systemctl reload nginx`; `certbot --nginx -d <domain>`.
   (Hoặc tạm: mở firewall 8780 — chỉ khi tin mạng; token là lớp auth duy nhất, nên dùng TLS.)
6. **VPS worker cap 2** (cron/chat/fallback khi local tắt) — claude CLI phải đã login trên VPS:
   `AM_COORD_URL=http://127.0.0.1:8780 AM_TOKEN=$AM_TOKEN AM_RUNNER=claude AM_WORKER_CONCURRENCY=2 pm2 start "npx tsx src/worker-main.ts" --name lucy-vps-worker --cwd ~/lucy/agent-machine && pm2 save`
7. Nginx TLS cho coordinator (để worker LOCAL nối từ xa) như bước 5. Báo tôi URL + `GET /health` ok. KHÔNG commit .env.

Sau đó MÁY LOCAL của tôi chạy worker NẶNG (bulk dev):
  AM_COORD_URL=https://<domain> AM_TOKEN=<token> AM_RUNNER=claude AM_WORKER_CONCURRENCY=4 npm run worker
(local tắt → VPS worker cap 2 vẫn gánh cron + fallback.)
````

## 9. Trạng thái (cập nhật 2026-06-08)
- ✅ Engine queue (dispatch/claim/submit) + 6 guardrail · config-là-data · coordinator↔worker dial-out + concurrency cap (VPS cap 2 fallback) · FS blast-radius.
- ✅ **Durable single-node**: atomic snapshot (tmp+rename) + **crash recovery** (card 'working' mồ côi → queued lại khi restart). Đủ cho 1 VPS — giống store file WAL+snapshot của radiant-bot. Postgres+pg-boss+DBOS = để dành khi **multi-node/scale** (chưa cần, tránh over-engineer trên box 2GB).
- ✅ Hub UI: Board (Kanban + drawer chi tiết + duyệt) + Channels (hội thoại agent) + project scoping; font Space Grotesk.
- ⏳ Tiếp: **deploy VPS** (coordinator + vps-worker cap 2) · ClaudeRunner → git worktree + Claude deny-hook (enforce FS đầy đủ, cần claude thật để test).
