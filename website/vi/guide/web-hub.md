# Web hub

Web hub là buồng lái của Lucy trên trình duyệt. Đây là một ứng dụng React do process `lucy-hub` phục vụ (Express, cổng mặc định `8800`), dùng được trên cả máy tính lẫn điện thoại. Hub dùng chung vault trí nhớ và persona với bridge Telegram, nên hai cửa vào cùng nói chuyện với một "bộ não".

::: info Ngôn ngữ giao diện
Nhãn sidebar và phần lớn chữ trên giao diện là tiếng Việt. Trang này ghi đúng nhãn thật của từng tab rồi mới mô tả.
:::

## Hub cần những gì

| Thành phần | Dùng cho | Cách đặt |
|---|---|---|
| `LUCY_HUB_PASSWORD` | Đăng nhập. Không đặt mật khẩu thì mọi lượt đăng nhập đều bị từ chối | `.env.runtime` |
| `claude` CLI đã đăng nhập | Chat, lịch, Tasks, nút dọn máy VPS | `CLAUDE_BIN` nếu `claude` không nằm trong `PATH` |
| Coordinator (`AM_COORD_URL`) | Dashboard, Bộ não, Tinh hà, Experts, bảng việc Dự án, Kết nối, Kỹ năng, bộ chọn model, recall trí nhớ trong chat | `.env.runtime`, ví dụ `http://127.0.0.1:8780` |
| `LUCY_HUB_HOST=127.0.0.1` | Giữ hub kín sau nginx | `.env.runtime`. Nếu bỏ trống, code mặc định là `0.0.0.0` |
| Cờ tính năng tuỳ chọn | Prompt Architect, chat với persona, MCP, tự học skill | Xem bảng [Tổng quan các tab](#tong-quan-cac-tab) |

Khi chưa cấu hình coordinator hoặc coordinator đang tắt, các tab phụ thuộc nó sẽ hiện "Agent-Machine chưa cấu hình (AM_COORD_URL)" hoặc "offline". Chat vẫn chạy bằng Claude Sonnet, nhưng không có recall trí nhớ.

## Đăng nhập

1. Mở địa chỉ hub, ví dụ `https://hub.example.com`.
2. Nhập mật khẩu trong `LUCY_HUB_PASSWORD`, bấm **ĐĂNG NHẬP**.
3. Nếu đã bật xác thực 2 lớp, form sẽ hỏi tiếp mã 6 số trong app Authenticator. Bấm **XÁC NHẬN**.

Cách phiên đăng nhập hoạt động:

- Đăng nhập thành công, hub đặt cookie `httpOnly` (`lucy_token`, `SameSite=Lax`, có `Secure` khi chạy HTTPS), hiệu lực **7 ngày**.
- Phiên được giữ trong bộ nhớ, nên restart `lucy-hub` là mọi người bị đăng xuất.
- Một IP sai 5 lần (sai mật khẩu hoặc sai mã 2FA) trong 15 phút sẽ bị chặn tới hết khung thời gian đó. Server trả HTTP 429 và ghi log `login bị chặn tạm`.

### Bật 2FA {#bat-2fa}

1. Vào **Settings**, tìm thẻ **XÁC THỰC 2 LỚP (2FA)**.
2. Bấm **Bật 2FA**. Mã QR và chuỗi secret hiện ra.
3. Quét QR bằng app TOTP bất kỳ (Google Authenticator, Aegis, 1Password…). Mục mới có tên nhà phát hành "Lucy Hub".
4. Gõ mã 6 số đang hiện, bấm **Xác nhận & bật**.

Muốn tắt 2FA, nhập mã hiện tại vào cùng thẻ đó rồi bấm **Tắt 2FA**. Secret TOTP lưu ở `$LUCY_STATE/twofa.json` (mặc định `~/.lucy-hub/`). Nếu mất app Authenticator, dừng hub, xoá file này rồi chạy lại hub. 2FA sẽ tắt.

Các lớp bảo vệ đăng nhập khác có trong trang [Bảo mật](./security).

## Bố cục

- **Sidebar.** Tab được gom thành bốn nhóm: *Tổng quan*, *Trí tuệ*, *Việc*, *Hệ thống*. Bên dưới là danh sách dự án trên bảng việc ("Dự án"). Nút **+** tạo dự án mới, 🗑 ném dự án vào thùng rác.
- **Command palette.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> để nhảy tới bất kỳ tab hay dự án nào. Gõ không dấu vẫn tìm được.
- **Cột HUD.** Trên màn hình rộng, cột bên phải hiện bối cảnh của tab đang mở, các lane đang chạy và luồng hoạt động thật từ bảng việc. Màn hình nhỏ thì mở bằng nút 📡.
- **Điện thoại.** Thanh dưới cùng có lối tắt tới Dashboard, Chat, Bộ não và Dự án. Nút **Menu** mở sidebar đầy đủ.

## Tổng quan các tab {#tong-quan-cac-tab}

Theo đúng thứ tự trên sidebar. "Coordinator" nghĩa là tab cần `AM_COORD_URL`.

| Nhóm | Nhãn sidebar | Là gì | Cần | Trạng thái |
|---|---|---|---|---|
| Tổng quan | Reactor | Trang chủ hero với số liệu thật | Coordinator; bật trong Settings | Thử nghiệm, mặc định tắt |
| Tổng quan | Dashboard | Chi phí, provider, phân tích agent | Coordinator | Lõi |
| Trí tuệ | Chat | Trò chuyện với Lucy | `claude` CLI (coordinator không bắt buộc) | Lõi |
| Trí tuệ | Bộ não | Trí nhớ: recall, preference đã học, dream | Coordinator | Lõi |
| Trí tuệ | Tinh hà | Đồ thị trí nhớ, VPS, code, file | Coordinator cho chế độ HUD/3D | Lõi, vài chế độ tuỳ chọn |
| Trí tuệ | Experts | Persona chuyên gia | Coordinator; `LUCY_PERSONA_CHAT=1` để chat/tự chọn | Lõi |
| Trí tuệ | Prompt Architect | Biến ngữ cảnh thô thành prompt có cấu trúc | `LUCY_PROMPT_ARCHITECT=1` ở hub, key provider cho lane | Tuỳ chọn, ẩn khi tắt |
| Việc | Dự án | Không gian dự án: Kanban, Lucy dự án, kênh | Coordinator, worker | Lõi |
| Việc | Mã nguồn | Trình duyệt mã nguồn chỉ-đọc | `LUCY_PROJECTS_ROOT` | Lõi |
| Việc | Tasks | Job của hub, đang chạy và đã xong | — | Lõi |
| Việc | Auto-Task | Xem chỉ-đọc các lượt auto-task/auto-build bên ngoài | Script không có trong repo này | Cũ, thường trống |
| Việc | Schedule | Prompt chạy theo lịch mỗi ngày | `claude` CLI; biến Telegram để đẩy kết quả | Lõi |
| Hệ thống | Kết nối | Trạng thái MCP server | Coordinator; `LUCY_MCP=1` ở worker | Chỉ đọc |
| Hệ thống | Kỹ năng | Thư viện skill và skill đề xuất | Coordinator; `LUCY_SKILL_LEARN=1` để tự học | Chỉ đọc |
| Hệ thống | Draw | Canvas vẽ tay | — (chỉ trình duyệt) | Phụ |
| Hệ thống | Aki | Đẩy báo cáo lên Discord qua bot đi kèm | `RADIANT_BOT_API_URL`, `RADIANT_BOT_AGENT_SECRET` | Tuỳ chọn |
| Hệ thống | VPS | Trạng thái máy và nút dọn máy bằng agent | Linux, `pm2` | Lõi |
| Hệ thống | Logs | Nhật ký sự kiện của hub | — | Lõi |
| Hệ thống | Settings | Hiệu ứng, 2FA, provider, danh mục model | Coordinator cho phần provider | Lõi |
| Hệ thống | Design | Trang mẫu design-system | — | Trang cho dev |

## Reactor

Trang chủ tuỳ chọn, có hero "lò phản ứng" và các vòng đo chạy theo số liệu thật (token, lane, card, chi phí). Để bật, vào **Settings → HIỆU ỨNG & TRỢ NĂNG**, gạt **Trang chủ Reactor ⚛️ (thử nghiệm)**, rồi tải lại trang. Cài đặt này lưu trong trình duyệt (`localStorage`, khoá `lucy.reactorHome`). Khi bật, Reactor thành tab đầu tiên và là trang mở mặc định.

## Dashboard

Tab mở mặc định. Có ba tab con, tự làm mới sau mỗi 10–30 giây.

- **Overview.** Token theo ngày và tháng, chi phí hôm nay và tháng này (USD, lấy từ sổ chi tiêu của coordinator, gộp mọi nguồn), biểu đồ token/chi phí, trạng thái model và provider, chi phí theo model và theo agent, các nguồn đốt token, và card đang chạy.
- **Agent Insights.** Báo cáo của agent trên bảng việc, thống kê lỗi từ turn-log (theo loại, agent, model), thanh fail/rework/ask/done cho từng agent và "motive timeline".
- **Cho Lucy.** Card đang chờ bạn, runway token (tốc độ đốt mỗi giờ so với ngưỡng mềm của token guard), nhật ký trực đêm của autopilot, và những gì Lucy học được hôm nay (signal mới đang chờ dream).

Cần coordinator. Không có thì các ô hiện số 0.

## Chat

Cuộc trò chuyện chính với Lucy. Câu trả lời hiện dần theo thời gian thực.

### Hội thoại

- Nút **☰** mở danh sách hội thoại. Mỗi mục có thể đổi tên (✎) hoặc xoá (🗑).
- **＋ mới** / **✨ mới** mở hội thoại mới. Tiêu đề lấy từ tin nhắn đầu tiên.
- Hội thoại lưu trên server ở `$LUCY_STATE/chats/<id>.json`, giữ 400 tin gần nhất. Màn hình hiện 200 tin cuối.
- Đóng tab giữa chừng thì server vẫn lưu đủ câu trả lời. Quay lại tab là lịch sử tự đồng bộ.
- Mỗi hội thoại giữ một phiên Claude riêng nên ngữ cảnh được nối giữa các lượt. Nếu nối lại phiên cũ thất bại, hub thử lại một lần bằng phiên mới.

### Chọn model

Nút cạnh biểu tượng 🎤 mở bộ chọn model, gồm ba phần:

| Phần | Cách chạy |
|---|---|
| **Claude · có tool + vault** | Chạy Claude qua Agent SDK, đủ công cụ, kèm persona và vault. Danh sách (Opus, Sonnet, Fable, Haiku) lấy từ coordinator. **Trong hub, chỉ `claude:opus` chạy Opus. Các mục Claude khác hiện đều chạy Sonnet.** |
| **Auto — router tự chọn** | Router của coordinator chọn model. Nếu hội thoại đã có phiên Claude, hoặc câu hỏi cần tool, thì giữ Claude Sonnet. Không có coordinator thì dùng Sonnet. |
| **Lane · chat thuần** | Model bên thứ ba rẻ hơn, chạy qua coordinator (key trong `.env.llm`). Lane hỗ trợ tool sẽ chạy vòng agentic (tìm/đọc web, đọc file, bash); lane còn lại chỉ chat. Lane không giữ trạng thái, nên hub gửi kèm persona và lịch sử gần đây đã nén (ngân sách khoảng 5.000 token). |

Hội thoại mới bắt đầu với Claude Sonnet. Danh mục model xem ở trang [Model](./models).

### Trong lúc Lucy trả lời

- **Suy nghĩ** (💭 Suy nghĩ) và từng **lệnh gọi tool** (🔧, kèm tham số và kết quả) hiện thành khối gập/mở được.
- Dưới mỗi câu trả lời của Claude có badge: tỉ lệ dùng prompt cache, lượng context đã dùng trên 1M, và số token sinh ra.
- **Recall trí nhớ.** Trước mỗi lượt Claude, hub hỏi coordinator các note liên quan trong vault rồi chèn tối đa 5 đoạn ngắn (kèm tên file và tuổi) vào đầu prompt. Tắt bằng `LUCY_RECALL_PREFETCH=0`. Mỗi lượt cũng được ghi vào trí nhớ episodic sau khi đã che secret (`LUCY_EPISODIC=0` để tắt).
- Claude trong chat hub có thêm tool `consult_expert` để hỏi ý kiến một persona chuyên gia.

### Hàng đợi, dừng và giọng nói

- Nhấn Enter khi Lucy đang bận thì tin được **xếp hàng** ("⏳ N tin chờ") và chạy lần lượt. Shift+Enter để xuống dòng.
- **■ Dừng** huỷ luồng stream trên trình duyệt và xoá hàng đợi. Lượt chạy trên server không bị huỷ: nó chạy xong và câu trả lời đầy đủ vẫn được lưu vào hội thoại.
- **🎤** nhập bằng giọng nói qua Web Speech API của trình duyệt (Chrome, cố định tiếng Việt).
- Ô soạn tin của hub **không có nút đính kèm**. Muốn gửi ảnh hay tài liệu, dùng [Telegram](./telegram).

Mọi lượt chat cũng hiện trong tab **Tasks**.

## Bộ não

Cửa sổ nhìn vào trí nhớ dài hạn của Lucy (xem [Bộ nhớ](./memory)). Cần coordinator.

- **Ô recall** (thanh trên cùng) tìm toàn văn trong vault, hiện kết quả có đoạn trích tô sáng và các note liên quan. Bấm vào kết quả để đọc note.
- **↻ Reindex** dựng lại chỉ mục tìm kiếm.
- **🗑 Quét rác** tìm note rỗng, note chỉ có frontmatter, file trùng y hệt và file sync-conflict. Bạn xác nhận thì chúng được **chuyển** vào `<vault>/.trash/<thời-điểm>/`, không bị xoá hẳn.
- **🌙 Dream** chạy "dream" preference ngay lập tức (cùng bước gộp mà cron ban đêm làm, xem [Tự động hoá](./automations)).
- **Đã học** liệt kê preference đã học với thanh độ tin cậy và trạng thái (unconfirmed, confirmed, stale, rebutted, expired). 👍 đánh dấu Lucy đã áp dụng đúng, 👎 là sai/vi phạm, 📌 ghim để không bao giờ bị tự động loại bỏ.
- **Inbox · chờ dream** là các signal thô chờ lần dream tới. **Vault** là danh sách file.
- **Mở Tinh hà** chuyển sang chế độ thiên hà.

## Tinh hà

Các góc nhìn trực quan về những gì Lucy biết và đang chạy. Đổi chế độ bằng các nút ở góc trên bên phải:

| Chế độ | Hiển thị | Nguồn dữ liệu |
|---|---|---|
| ✦ HUD (mặc định) | Chòm sao: lõi Lucy ở giữa, các node trí nhớ xếp theo vùng. Rê chuột để xem fact | Coordinator `/brain/graph` |
| 🌌 3D | Thiên hà 3D của đồ thị trí nhớ. Bấm node để recall hoặc đọc | Coordinator |
| 🌳 Cây | Cây tri thức kiểu thư mục với bốn nguồn (bên dưới) | Server hub |
| ⚡ Live | Job đang chạy trong hub và các tích hợp đã khai báo, dạng đồ thị sống | Hub `/api/telemetry` + `LUCY_INTEGRATIONS_FILE` (mặc định `<projects root>/integrations.json`) |

Các nguồn trong chế độ Cây:

- **🧠 Tri thức.** Các thư mục vault `Brain`, `Projects`, `Context`, `Reference`, `Skills`, `Reports` (tuỳ chọn thêm `Daily`). `[[wiki-link]]` được vẽ thành cạnh chéo. Giới hạn khoảng 900 node.
- **🖥️ VPS.** Service PM2 và cổng của chúng, site và route nginx, các dòng cron, CPU/RAM/swap/disk, process và thư mục chiếm nhiều nhất, cổng đang mở, service systemd, container Docker.
- **🧬 Code.** Đồ thị code dựng từ index GitNexus. Cần CLI `gitnexus`, và các repo phải nằm đúng đường dẫn ghi cứng trong server (`/root/lucy/agent-machine`, `/root/lucy/bridge`, `/root/lucy/hub`). Cài theo bố cục khác thì chế độ này trống. Lần dựng đầu mất khoảng một phút.
- **🗂️ Files.** Cây thư mục của `/root/lucy` và `/var/www`, sâu 4 tầng (đường dẫn cố định).

## Experts

Quản lý các persona chuyên gia mà Lucy và bảng việc có thể hỏi ý kiến (xem [Agent & bảng việc](./agents)). Cần coordinator.

- **+ Expert mới** tạo persona. Các trường: `id`, tên hiển thị, system prompt, loại (*specialist*, *orchestrator* hoặc *executor*), tầng Claude (`sonnet`/`opus`), `laneModel` tuỳ chọn (model rẻ hơn), realm, tag, tool được phép (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch), `maxTurns` và `timeoutSec`.
- **🔮 Lucy tự chọn chuyên gia.** Mô tả việc cần làm, Lucy chọn chuyên gia hợp nhất, kèm độ tin cậy và lý do.
- **💬 Nhắn tin** mở cuộc trò chuyện nhiều lượt với chuyên gia đó.

Tự chọn chuyên gia và chat với chuyên gia cần `LUCY_PERSONA_CHAT=1` trong môi trường của coordinator. Nếu chưa bật, coordinator sẽ báo tính năng đang tắt.

## Prompt Architect

Chỉ hiện khi process hub có `LUCY_PROMPT_ARCHITECT=1` (cũng nhận `true`/`on`).

Dán ngữ cảnh thô vào. Architect sẽ hỏi lại cho rõ, hoặc trả về một prompt chia mục kèm nút **📋 Copy prompt**. Tuỳ chọn:

- **Target model:** tự động, Claude, GPT, Gemini, hoặc DeepSeek/model nhỏ. Văn phong prompt được chỉnh cho hợp họ model đó.
- **⇄ 2 biến thể** dựng hai phiên bản để so sánh cạnh nhau.
- **⬆️ Escalate bằng Claude** nhờ Claude dựng lại khi bản nháp của model rẻ chưa đạt, kèm so sánh bản cũ và bản mới.

Prompt Architect chạy trên một model lane rẻ (cần key provider trong `.env.llm`). Nó không bao giờ thực thi gì: phần lõi gọi model mà không có tool. Lịch sử phiên lưu trong một database phụ trong vault, đã che secret.

## Dự án

Khu làm việc của [bảng việc agent](./agents). Cần coordinator và một worker đang chạy.

**Tạo dự án:** tên, URL repo (tuỳ chọn, agent sẽ clone và sửa repo đó), mô tả/mục tiêu (tuỳ chọn), và SKILL dự án (tuỳ chọn, dán một file `SKILL.md` mà mọi agent trong dự án sẽ tuân theo).

Bên trong một dự án có các tab con:

| Tab con | Chức năng |
|---|---|
| 📋 Kanban | Card theo trạng thái: ĐỂ SAU, xếp hàng, đang chạy, CHỜ BẠN DUYỆT, hold, rate-limit, xong, lỗi. Với card đang chờ, bạn có thể duyệt, trả lại kèm góp ý, hoặc trả lời câu hỏi. Có planner (mô tả mục tiêu, Lucy soạn sẵn các card), đồ thị phụ thuộc và ô chỉnh số lane (mức chạy song song) |
| ✨ Lucy | Cuộc trò chuyện dài theo từng dự án. Khi ý tưởng đủ rõ, Lucy đề xuất card kèm nút **Tạo**. Nó chạy tách khỏi chat chính: mỗi lượt nhận transcript của dự án, lịch sử lưu theo dự án |
| 💬 Channels | Kênh dự án kiểu Discord, nơi agent và autopilot đăng bài |
| 🧩 Flow | Trình sửa pipeline. Mỗi bước là một persona, 🔒 đánh dấu gate cần bạn duyệt |
| 🗺 Mindmap · 🎨 Draw · 📝 Notes | Công cụ nháp theo dự án, chỉ lưu trong `localStorage` của trình duyệt này |

Dự án đã ném vào thùng rác có thể khôi phục hoặc xoá vĩnh viễn.

## Mã nguồn

Trình duyệt file chỉ-đọc, gốc là `LUCY_PROJECTS_ROOT` (mặc định bằng `LUCY_WORKDIR`). File/thư mục bắt đầu bằng dấu chấm và `node_modules` bị ẩn khỏi danh sách, file nhị phân không hiển thị, file văn bản trên 500 KB bị bỏ qua. Đường dẫn ra ngoài thư mục gốc bị từ chối.

## Tasks

Mọi job của hub: lượt chat, lượt chạy theo lịch, tin nhắn Lucy dự án, job dọn máy VPS. Có hai cột: đang chạy (⏳) và xong (✓). Bấm vào card để xem toàn bộ kết quả; kết quả tự cập nhật khi job còn chạy. **Chạy lại** gửi lại đúng prompt đó với cùng tầng model. Lưu ý: lượt chạy lại sẽ vào hội thoại chat chính.

Job chỉ nằm trong bộ nhớ (hiện 30 job gần nhất) và mất khi hub restart.

## Auto-Task

Màn hình chỉ-đọc của một bộ chạy task bên ngoài. Nó đọc dự án trong `~/lucy/tasks/projects/<slug>/` (`project.md`, `state.json`, `queue/`, `doing/`, `done/`, `failed/`, `research/`, `sprints/`), và các ô trạng thái **Auto-Build**, **Auto-Build Free**, **Auto-Task** từ file log trong `LUCY_REPO` (mặc định `~/lucy`).

::: warning Tính năng cũ
Các script sinh ra dữ liệu này (`auto-task.py`, `auto-build*.py`) không nằm trong repo này, nên cài mới thì tab này trống. Muốn chạy việc nền, hãy dùng [bảng việc agent](./agents) và [autopilot](./automations#autopilot-cho-agent).
:::

## Schedule

Các prompt Lucy tự chạy mỗi ngày, cùng danh sách crontab của server (chỉ xem). Chi tiết đầy đủ ở [Tự động hoá](./automations#prompt-theo-lich-trong-hub).

## Kết nối

Danh sách chỉ-đọc các MCP server mà agent trên bảng việc dùng được, kèm trạng thái: **live**, **chờ creds**, **tắt (flag)**, **master tắt**, hoặc **lỗi (breaker)** (bị ngắt sau nhiều lỗi). Ở đây không bật/tắt được gì. MCP được điều khiển bằng biến môi trường của worker:

```bash
# trong file env của worker, sau đó restart worker
LUCY_MCP=1              # công tắc tổng
LUCY_MCP_<ID>=on        # bật từng server
pm2 restart lucy-vps-worker
```

Xem [Skill & MCP](./skills-mcp).

## Kỹ năng

Thư viện skill chỉ-đọc, có ô tìm kiếm: skill nội bộ của Lucy, thư viện chung, và các skill **đề xuất** do Lucy tự viết (trong `skills/_proposed/`). Chip trạng thái cho biết chế độ tự học đang bật (`LUCY_SKILL_LEARN=1`) hay chỉ chạy thử (dry-run). Skill đề xuất **không được nạp** cho tới khi bạn duyệt: chuyển nó vào thư viện và thêm một dòng vào `INDEX.md`.

## Draw

Canvas vẽ tay, có bảng màu, cỡ cọ, tẩy và nút xoá. Hình vẽ chỉ lưu trong `localStorage` của trình duyệt này.

## Aki

Cầu nối tuỳ chọn tới một bot Discord đi kèm. Tab hiện "chưa cấu hình" cho tới khi hub có đủ hai biến:

```ini
RADIANT_BOT_API_URL=https://bot.example.com
RADIANT_BOT_AGENT_SECRET=<shared-secret>
```

Khi đã nối, bạn có thể đẩy báo cáo vào một kênh (theo tên hoặc ID), tạo kênh text hoặc thread, kèm tin nhắn mở đầu tuỳ chọn. Request được ký HMAC-SHA256 (header `x-lucy-signature`). Bản thân bot là một dự án riêng, phải cung cấp hai endpoint `/api/agent/post` và `/api/agent/channel`.

## VPS

Trang trạng thái server, làm mới mỗi 5 giây: CPU load so với số core, RAM, swap, disk `/`, uptime, và danh sách process PM2 (trạng thái, CPU, bộ nhớ, số lần restart, cổng đang nghe, và URL public tìm được trong `/etc/nginx/sites-enabled`).

**Các nút dọn máy** mỗi nút khởi động một job Claude Sonnet với prompt cố định. Mỗi lúc chỉ chạy một job dọn; kết quả hiện ngay trong khung và trong Tasks.

| Nút | Việc được phép trong prompt |
|---|---|
| Dọn log pm2 + journal | `pm2 flush`, `journalctl --vacuum-size=100M`, liệt kê (không xoá) file `.log` trên 50 MB |
| Dọn cache (apt/npm/pip) | `apt-get clean`, `npm cache clean --force`, `pip cache purge` |
| Dọn /tmp cũ | Xoá mục trong `/tmp` không được truy cập quá 7 ngày |
| Phân tích disk (không xoá) | Báo cáo `df`/`du` kèm đề xuất, không xoá gì |

::: warning
Danh sách lệnh được phép và các quy tắc "không đụng vault, mã nguồn, database, `/etc`, `.env`" chỉ là **chỉ dẫn trong prompt**, không phải sandbox. Claude chạy các job này với `bypassPermissions`. Đọc thêm [Bảo mật](./security).
:::

## Logs

Nhật ký sự kiện riêng của hub: đăng nhập, job, lịch, chat, Aki, dọn máy VPS, Prompt Architect, dựng đồ thị. Hiện 200 sự kiện gần nhất, làm mới mỗi 3 giây, lọc được theo loại hoặc tạm dừng. Sự kiện được giữ trong bộ nhớ (800 dòng) và ghi thêm vào `$LUCY_STATE/log.jsonl`. Log của process thì xem bằng `pm2 logs` (xem [Vận hành & xử lý sự cố](./operations)).

## Settings

| Thẻ | Chức năng |
|---|---|
| HIỆU ỨNG & TRỢ NĂNG | **Giảm hiệu ứng** (tắt animation, nền đặc, bỏ blur) và công tắc trang chủ **Reactor**. Cả hai lưu theo trình duyệt. Cài đặt reduced-motion của hệ điều hành luôn được tôn trọng |
| XÁC THỰC 2 LỚP (2FA) | Bật hoặc tắt TOTP (xem [phần trên](#bat-2fa)) |
| NGUỒN API | Provider LLM nào đã có key (lấy từ coordinator) |
| MODEL CATALOG | Model theo vai trò: Executor, Reasoning, Fast, Content |
| EXECUTOR MẶC ĐỊNH | Chọn model executor mặc định. Chỉ lưu trong `localStorage` của trình duyệt này; hiện chưa có phần nào khác của hub đọc giá trị này |

## Design

Trang mẫu của design-system, hiển thị token và component giao diện (màu, card, nút, chip, trạng thái trống và lỗi). Dùng cho phát triển và kiểm tra giao diện, không có backend.
