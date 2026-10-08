# Agent & bộ máy card

Với việc lớn, Lucy dùng một bộ máy kiểu Kanban. Mỗi việc là một **card**. Card đi qua các **stage** (bước) của một **pipeline**, và ở mỗi stage có một **persona** chuyên trách làm việc. Bộ máy tự đẩy card đi tiếp, chỉ dừng lại hỏi bạn ở những gate bạn đã đặt, hoặc khi có việc cần quyết.

## Các thành phần

```
 ┌──────────── coordinator (luôn chạy, nhẹ) ──────────────┐        ┌──── worker ───────┐
 │ board · card · dự án · pipeline · persona              │ claim  │ Claude Agent SDK  │
 │ channel · ngân sách · token guard · API recall/brain   │◄───────│ hoặc lane LLM rẻ  │
 │ HTTP tại 127.0.0.1:8780 (có token bảo vệ)              │ result │ chạy một stage    │
 └────────────────────────────────────────────────────────┘───────►└───────────────────┘
          ▲                         ▲
          │ board "Dự án" trên hub  │ autopilot (tuỳ chọn): duyệt gate khi bạn vắng mặt
```

- **Coordinator** (`npm run coordinator`) giữ toàn bộ trạng thái và quyết định việc gì chạy tiếp. Bản thân nó không bao giờ chạy agent.
- **Worker** (`npm run worker`) hỏi coordinator xin việc, nhận một job, chạy một stage trong thư mục cô lập rồi gửi kết quả về. Worker đặt cùng máy chủ hay ở máy khác đều được.
- **Autopilot** (`npm run autopilot`) là tuỳ chọn. Nó quyết gate thay bạn, có những ngoại lệ cứng (xem [Autopilot](#autopilot)).

## Khái niệm chính

| Khái niệm | Là gì | Nằm ở đâu |
|---|---|---|
| **Dự án (Project)** | Nơi chứa card. Có thể kèm `repoUrl`/`branch` (agent làm việc trong bản clone thật), mô tả, đoạn `skill` của dự án được chèn vào prompt mọi agent, và các kênh chat (mặc định `general`) | dữ liệu coordinator |
| **Pipeline** | Danh sách stage có thứ tự. Mỗi stage có `personaId`, tuỳ chọn `gate: true` (người hoặc autopilot phải duyệt) và tuỳ chọn lệnh shell `verify` | `config/pipelines/*.json`, cộng pipeline tự tạo trên hub |
| **Persona** | Một vai agent: system prompt, `model` Claude (`sonnet`/`opus`), tuỳ chọn `laneModel` (model rẻ), `allowedTools`, `maxTurns`, `timeoutSec`, `kind` | `config/personas/*.json` |
| **Card** | Một đơn vị việc: tiêu đề, brief, pipeline, stage hiện tại, trạng thái, chi phí, lịch sử, báo cáo | dữ liệu coordinator |
| **Channel** | Luồng tin nhắn theo dự án, cộng một thread riêng cho mỗi card (`card-<id>`) nơi agent đăng trạng thái và báo cáo | dữ liệu coordinator |

**Trạng thái card:** `backlog` (chưa bắt đầu) · `queued` · `working` · `waiting_human` · `blocked` (chờ card khác) · `parked` (bị giới hạn tốc độ, tự chạy lại) · `done` · `failed`.

**Vì sao card ở `waiting_human`** (`waitKind`): `gate` (chờ duyệt stage) · `decision` (agent đặt câu hỏi) · `cost` (chạm trần chi phí của card) · `loop` (làm lại một stage quá nhiều lần) · `stuck` (bước triage đã đẩy lên cho người) · `size-gate` (việc quá lớn cho executor).

Mỗi stage phải kết thúc bằng một **outcome** JSON. `decision` là một trong các giá trị:

| Decision | Kết quả |
|---|---|
| `advance` | Sang stage kế. Nếu stage này có `gate: true` → `waiting_human/gate`. |
| `done` | Card xong |
| `rework` | Chạy lại stage này (tính vào giới hạn lặp) |
| `needs_decision` | Đặt câu hỏi → `waiting_human/decision` |
| `delegate` | Tạo card con cho persona khác. Card cha chờ tới khi card con xong. |
| `fail` | Card thất bại |

Nếu agent làm xong mà quên JSON, một lượt gọi ngắn để "cứu" sẽ suy ra outcome từ báo cáo của nó.

## Vòng đời một card

```
            tạo (hub / API / sprint)
                       │
     để sau? ───có───► backlog ──"Chạy"──┐
                       │                 │
     blockedBy? ─có──► blocked ─dep xong─┤
                       ▼                 │
                    queued ◄─────────────┘◄──────────────────────────┐
                       │ tick: còn lane, ngân sách ổn,                │
                       │ qua giới hạn lặp / size gate                 │
                       ▼                                              │
                    working ── worker chạy stage (SDK hoặc lane)      │
                       │                                              │
        ┌──────────────┼──────────────┬──────────────┬─────────────┐  │
        ▼              ▼              ▼              ▼             ▼  │
     advance         rework     needs_decision    delegate       fail │
        │              │              │              │             │  │
  lệnh verify? ─lỗi──► └──────────────┼──────────────┼─────────────┼──┘
        │ qua                         ▼              ▼             ▼
  gate? ─có──► waiting_human ──duyệt───► stage kế / done        failed
        │       (gate/decision/cost/loop)  trả lại+góp ý ──► queued (làm lại)
        không                              trả lời ────────► queued
        ▼
  stage kế ─► queued … stage cuối ─► done
                                       │
                                       └─► note phiên trong Daily/, bài học → Brain/
```

Những lần chuyển trạng thái tự động khác:

- Card `working` không báo về trong `AM_LEASE_MS` (20 phút) được đưa lại hàng đợi, phòng khi worker đã chết.
- Lượt chạy bị giới hạn tốc độ sẽ "đỗ" card lại và đưa vào hàng khi hết thời gian chờ.
- Khi khởi động lại, card còn kẹt ở `working` được đưa lại hàng đợi.

## Persona

Lấy từ `agent-machine/config/personas/`. Tên hiển thị là nhân vật kiểu anime, chỉ để cho vui. *Lane model* là model rẻ được dùng khi có sẵn. Persona không có lane model thì luôn chạy Claude.

| id | Tên | Loại | Model Claude | Lane model | Tool | Làm gì |
|---|---|---|---|---|---|---|
| `orchestrator` | Okabe · Orchestrator | orchestrator | opus | – | Read, Bash | Chia mục tiêu lớn thành việc con và giao cho đúng persona. Không tự code. Cũng là người viết sprint. |
| `architect` | Kurisu · Architect | specialist | opus | – | Read, Write, Bash | Khảo sát repo và vạch cách làm đơn giản nhất mà đúng cho việc lớn |
| `builder` | Tanjiro · Builder | executor | sonnet | `ds-v4-flash-free` | Read, Write, Edit, Bash | Hiện thực task trong workspace (code full-stack) |
| `engineer` | Zenitsu · Engineer | executor | sonnet | `devstral-med` | Read, Edit, Bash | Việc con nhỏ, gọn: một bug, một tính năng hoặc refactor nhỏ |
| `grinder` | Vương Lâm · Grinder | executor | sonnet | `ds-v4-flash-free` | Read, Edit, Bash | Việc cơ học khối lượng lớn: codemod, dựng khung, sửa lặp lại |
| `data` | Daru · Data | executor | sonnet | `ds-v4-flash-free` | Read, Write, Bash | Script dữ liệu, đọc log/metric, scrape hoặc gọi API, tổng hợp số liệu |
| `writer` | Tamayo · Writer | executor | sonnet | `ds-v4-flash-free` | Read, Write, Edit | Tài liệu, README, spec, nội dung khoá học |
| `designer` | Mitsuri · Designer | specialist | sonnet | – | Read, Write, Edit, Bash | UI/UX: bố cục, component, responsive |
| `tester` | Shinobu · Tester | specialist | sonnet | – | Read, Write, Bash | Viết và chạy test, tái hiện bug |
| `reviewer-spec` | Giyu · Spec-Review | specialist | sonnet | – | Read, Bash | Kiểm tra đúng yêu cầu: kết quả có làm đúng cái được nhờ không? |
| `reviewer` | Rengoku · Reviewer | specialist | opus | – | Read, Bash | Review chất lượng khắt khe. Thường là stage gate. |
| `investigator` | Conan · Investigator | specialist | sonnet | – | Read, Bash | Tìm nguyên nhân gốc và khảo sát codebase. Báo cáo, không sửa. |
| `security` | Gyomei · Security | specialist | opus | – | Read, Bash | Rà bảo mật: tìm và chấm mức rủi ro, không tự "sửa cho xong" |
| `devops` | Tengen · DevOps | specialist | sonnet | – | Read, Bash | Build, deploy, release (pm2, nginx, CI, env, healthcheck) |
| `researcher` | Shiro · Researcher | specialist | sonnet | `or-nemotron-super` | Read, Bash | Nghiên cứu sâu và tổng hợp có nguồn (chuyên gia tư vấn) |
| `finance` | Eru · Finance | specialist | sonnet | `or-nemotron-super` | Read, Bash | Góc tài chính, thị trường: xu hướng, rủi ro, vùng vào/ra (chuyên gia tư vấn) |
| `marketing` | Mina · Marketing | specialist | sonnet | `or-nemotron-super` | Read, Bash | Định vị, kênh, phễu, go-to-market (chuyên gia tư vấn) |
| `prompt-architect` | Vivy · Prompt Architect | specialist | sonnet | `ds-chat` | không (1 turn) | Biến ý tưởng thô thành một prompt hoàn chỉnh để chạy ở model khác. Không tự thực thi. |

Bạn thêm hoặc sửa persona trong tab **Experts** của hub (`GET/POST/DELETE /personas` trên coordinator), hoặc thả một file JSON vào `config/personas/`. Persona cần tối thiểu `id` (`a-z0-9-_`), `name` và `systemPrompt`.

## Pipeline

Lấy từ `agent-machine/config/pipelines/`. Dấu ⛔ đánh dấu gate.

| id | Tên | Các stage |
|---|---|---|
| `feature` | Feature (repo) | architect (lên kế hoạch) → builder (code) → tester (test) → reviewer-spec (kiểm yêu cầu) → reviewer ⛔ |
| `ui` | UI / UX (frontend) | designer → builder → reviewer ⛔ |
| `research` | Research / Root-cause | investigator → architect ⛔ (vạch hướng từ kết quả) |
| `eng` | Engineer subtask | engineer (một stage) |
| `blog` | Blog site | builder → reviewer ⛔ |
| `course` | Portal course | writer (soạn) → reviewer ⛔ → writer (xuất bản) |
| `secure-ship` | Secure → Ship | security ⛔ → devops ⛔ |

Bạn tạo pipeline riêng bằng trình soạn flow trên hub hoặc qua `POST /pipeline`. Pipeline này được lưu vào `custom-pipelines.json` trong thư mục dữ liệu của coordinator và đè lên pipeline cấu hình trùng id. Mỗi stage có thể kèm lệnh `verify`, ví dụ `npm test`. Khi agent báo `advance` hoặc `done`, lệnh chạy trong workspace của card, giới hạn 120 giây. Nếu thoát với mã khác 0, stage bị trả về làm lại, kèm log.

## Tạo việc

### Từ hub

Mở tab **Dự án**: mỗi dự án có board Kanban, chat với Lucy và các kênh. Tạo dự án, có thể kèm URL repo git và nhánh. Rồi thêm card với:

- tiêu đề và brief (brief nên nói rõ thế nào là "xong")
- pipeline, và nếu muốn thì chọn persona khác cho stage đầu
- model: mặc định, `sonnet`, `opus`, hoặc lane model rẻ của persona
- chất lượng `thorough` (nhiều lượt hơn, trần cao hơn) hoặc mặc định `fast`
- "để sau": card nằm ở `backlog` tới khi bạn bấm Chạy
- phụ thuộc (`blockedBy`): card chỉ bắt đầu sau khi các card đó xong

Duyệt, trả lại (kèm góp ý) hoặc trả lời card đang chờ ngay trong ngăn chi tiết của card.

### Qua API

Coordinator lắng nghe ở `127.0.0.1:8780`. Mọi route trừ `/health` đều cần header `x-worker-token`. Hub chuyển tiếp các lệnh y hệt dưới `/api/am/*` cho người đã đăng nhập.

```bash
TOKEN=<AM_TOKEN>
# tạo dự án làm việc trên repo thật
curl -s -X POST 127.0.0.1:8780/project -H "x-worker-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"My App","repoUrl":"https://github.com/<you>/<repo>.git","branch":"main"}'

# thêm card
curl -s -X POST 127.0.0.1:8780/card -H "x-worker-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Thêm endpoint /healthz","brief":"Xong = GET /healthz trả 200 + JSON; có test.","pipelineId":"feature","projectId":"<projectId>"}'

# xử lý card đang chờ
curl -s -X POST 127.0.0.1:8780/approve -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>"}'
curl -s -X POST 127.0.0.1:8780/reject  -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>","feedback":"Thiếu test cho trường hợp 500"}'
curl -s -X POST 127.0.0.1:8780/answer  -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>","text":"Dùng phương án B"}'
```

Trường tuỳ chọn của `/card`: `personaId`, `model` (`sonnet`/`opus`/`laneModel`), `quality` (`thorough`), `deferred` (bool), `blockedBy` (mảng id card). `model: "laneModel"` bị từ chối với persona không có lane model.

### Sprint: để orchestrator tự viết card

```bash
cd ~/lucy/agent-machine
AM_TOKEN=<AM_TOKEN> npm run sprint -- sprint <projectId> "Làm dark mode cho trang cài đặt"
```

Orchestrator (Claude opus, một lượt) chia mục tiêu thành 3–7 card độc lập, chọn pipeline cho từng card trong số pipeline đang có, tránh trùng tiêu đề đã có trên board, rồi đưa chúng vào hàng đợi.

### Từ Telegram

`/fan`, `/auto` và `/orch` trên Telegram **không** tạo card. Chúng chạy phiên Claude trực tiếp từ bridge và trả lời ngay trong chat:

| Lệnh | Tác dụng |
|---|---|
| `/fan` + mỗi dòng một task (≥ 2) | Chạy mỗi dòng thành một phiên Claude riêng, song song (tối đa 4 cùng lúc), trả lời theo từng lane |
| `/auto <mục tiêu>` | Lặp một phiên Claude tới khi nó báo `STATUS: DONE` (tối đa 8 vòng) |
| `/orch <mục tiêu>` | Lập 2–5 việc con độc lập, chạy song song, rồi viết một báo cáo tổng hợp |

Các lệnh này dùng sonnet. Mở đầu mục tiêu bằng chữ `opus` để dùng opus. Khi bạn cần stage, gate duyệt, theo dõi chi phí và workspace là repo thật thì dùng board.

## Worker và runner

```bash
# trên máy chủ (nhẹ), hoặc trên máy mạnh hơn trỏ về coordinator
AM_COORD_URL=http://127.0.0.1:8780 AM_TOKEN=<AM_TOKEN> \
AM_RUNNER=claude AM_WORKER_CONCURRENCY=2 npm run worker
```

| `AM_RUNNER` | Hành vi |
|---|---|
| `mock` (mặc định) | Không gọi model nào. Stage nào cũng tự advance. Chỉ dùng để thử đường truyền. |
| `claude` | **Kết hợp.** Persona có `laneModel` và có key của nhà cung cấp đó → lane rẻ. Còn lại → Claude Agent SDK. |
| `lane` | Chỉ dùng lane rẻ |

- **Đường Claude Agent SDK.** Stage chạy ngay trong tiến trình bằng `query()`, dùng `model`, `allowedTools`, `maxTurns` (mặc định 12) và `timeoutSec` (mặc định 300) của persona. Vault được thêm làm thư mục phụ, server MCP được gắn theo persona, và khi làm lại agent tiếp tục phiên cũ của stage đó thay vì đọc lại toàn bộ dự án. Máy worker cần có thông tin đăng nhập Claude.
- **Lane rẻ.** Các nhà cung cấp tương thích OpenAI (key trong `~/lucy/.env.llm`) chạy một vòng gọi tool với read/write/edit/bash, giới hạn theo `allowedTools` của persona và bó trong workspace. Xem [Model](./models.md).

System prompt của mỗi lượt chạy ghép từ: luật chung → hợp đồng outcome → prompt persona → danh sách tool → [skill](./skills-mcp.md) khớp với card → `Brain/active.md` (preference đã học) → bài học riêng của persona (`Brain/agents/<id>.md`).

`AM_WORKER_CONCURRENCY` là số stage một worker chạy cùng lúc. `AM_MAX_LANES` của coordinator (mặc định 3) giới hạn tổng số card đang `working` trên mọi worker.

### Workspace và log nằm ở đâu

| Cái gì | Đường dẫn |
|---|---|
| Trạng thái coordinator | `AM_DATA` (mặc định `agent-machine/.data/`): `cards.json`, `projects.json`, `channels.jsonl`, `ledger.jsonl` (chi tiêu), `custom-pipelines.json`, `token-day.json` |
| Workspace nháp (dự án không có repo) | `<thư mục chạy worker>/.worker/<cardId>/`. Mọi stage của một card dùng chung. |
| Workspace repo | `<thư mục chạy worker>/.worker/repos/<projectId>/`. Clone một lần, mỗi lượt chạy thì `git pull --ff-only`, và các card cùng dự án chạy lần lượt. `node_modules` còn thiếu được symlink từ repo nguồn trên máy hoặc cài mới. |
| Log từng lượt (bật nếu muốn) | Thư mục trong `AM_TURNS_LOG` |
| Telemetry tool và chặn lệnh nguy hiểm (bật nếu muốn) | `LUCY_HOOKS=1`. Log ghi vào `LUCY_HOOKS_LOG` (hoặc `AM_TURNS_LOG`). Chặn các lệnh như `git push`, `rm -rf /`, `curl … \| sh`. |

::: warning
Agent không bao giờ push. Thay đổi nằm trong bản clone ở `.worker/repos/`. Bạn tự xem diff rồi push, hoặc dùng một stage `devops` có gate do bạn duyệt.
:::

## Autopilot {#autopilot}

Autopilot là một tiến trình riêng, đứng ra xử lý các điểm dừng thay bạn. Nó được thiết kế cho những lượt chạy qua đêm.

```bash
AM_TOKEN=<AM_TOKEN> AM_AUTOPILOT_MAX=15 npm run autopilot
```

Cứ mỗi `AM_AUTOPILOT_POLL_MS` (6 giây), nó đọc board và xử lý card ở `waiting_human`:

| waitKind | Autopilot làm gì |
|---|---|
| `gate` | Một "director" (Claude, `AM_DIRECTOR_MODEL`, mặc định `opus`) đọc báo cáo và diff, có cả bức tranh toàn sprint, rồi quyết: **duyệt**, **trả lại** kèm góp ý cụ thể, hoặc **đẩy lên** cho bạn. Hai lần không đọc được quyết định thì nó đẩy lên cho bạn (không bao giờ trả lại một việc nó không đọc được). |
| `decision` | Trả lời câu hỏi của agent, hoặc đẩy lên cho bạn |
| `cost` | Card tốn từ `AM_CARD_HARD_USD` ($8) trở lên luôn được đẩy lên. Dưới mức đó, director chọn giữa cấp thêm ngân sách và đẩy lên. |

**Nó không bao giờ duyệt:**

- gate mà persona của stage là `devops` hoặc `security`
- bất kỳ card nào thuộc pipeline `secure-ship`
- card đang chờ vì `loop`, `stuck` hoặc `size-gate`

Những việc đó để lại cho bạn. Mọi hành động đều được đăng lên kênh `general` của dự án, mở đầu bằng 🌙 kèm trạng thái token hiện tại. Autopilot dừng sau `AM_AUTOPILOT_MAX` quyết định (mặc định 100); khởi động lại để đếm lại từ đầu. Tắt bằng `pm2 stop lucy-autopilot`.

## Ngân sách và token guard

Hai giới hạn độc lập giữ chi tiêu của bạn.

**Ngân sách đô-la** (coordinator, dựa trên báo cáo chi phí từ SDK/lane):

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `AM_WINDOW_MS` / `AM_CAP_USD` | 5 giờ / $20 | Chi tiêu trong cửa sổ trượt chạm trần → engine **ngừng phát việc** |
| `AM_SOFT_USD` | $14 | Đăng cảnh báo lên kênh `coordination` |
| `AM_WEEKLY_CAP_USD` | $120 | Trần theo tuần → ngừng |
| `AM_PER_CARD_USD` | $2 | Card chạm mức này → `waiting_human/cost` (×3 với card `thorough`) |
| `AM_MAX_STAGE_VISITS` | 3 | Vào một stage quá số lần này → `waiting_human/loop` kèm triage tự động (tách việc con / nâng lên opus / đẩy lên cho bạn). `thorough`: ×2 + 2. |
| `AM_MAX_LANES` | 3 | Số card chạy cùng lúc |
| `AM_LEASE_MS` | 20 phút | Đưa lại hàng đợi card có worker im lặng |

Persona executor trên card gốc còn có **size gate**. Nếu tiêu đề cộng brief dài quá 1500 ký tự, card chờ bạn chia nhỏ, hoặc duyệt cho chạy luôn.

Một số giới hạn đổi được khi coordinator đang chạy: `POST /config` với `maxLanes`, `perCardMaxUsd`, `maxDepth`, `maxStageVisits`, `tokenSoft`, `tokenHard`.

**Token guard** (token mỗi ngày, đếm từ sổ chi tiêu; mốc ngày theo UTC+7):

| Biến | Mặc định | Tác dụng |
|---|---|---|
| `AM_DAY_TOKEN_SOFT` | 800.000.000 | Persona executor bị chuyển xuống lane model rẻ nhất đang có. Reviewer và architect giữ nguyên model, và card đã chỉ định model rõ ràng cũng không bị đụng. |
| `AM_DAY_TOKEN_HARD` | 1.500.000.000 | Card mới được tạo ở trạng thái `waiting_human` và autopilot ngừng hành động |

Lưu lượng chat từ Telegram và hub cũng được báo vào cùng sổ (`POST /spend`), nên một bộ đếm bao trọn mọi thứ. Xem bằng `GET /token-guard`, đặt lại ngày bằng `POST /token-guard/reset`.

## Theo dõi tiến độ

- **Hub → Dự án:** các cột board theo trạng thái. Ngăn chi tiết card hiện báo cáo đầy đủ của từng stage, file đã đổi và diffstat, chi phí, lịch sử. Thread của card hiện tin trạng thái trực tiếp.
- **Hub → Dashboard:** chi phí theo nguồn và model, trạng thái nhà cung cấp.
- **API:** `GET /state` (card, dự án, 200 tin kênh gần nhất, giới hạn, token guard), `GET /health`, `GET /metrics`, `GET /token-guard`.
- **Log:** `pm2 logs lucy-coordinator`, `pm2 logs lucy-vps-worker`, `pm2 logs lucy-autopilot`.
- **Thống kê lỗi:** `npm run stats:errors` tóm tắt các lượt chạy lỗi hoặc bị trả về từ log từng lượt.
- **File:** `git -C .worker/repos/<projectId> diff` để xem chính xác cái gì đã đổi.
