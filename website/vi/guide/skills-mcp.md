# Skills & MCP

Agent của Lucy có thêm năng lực từ hai nguồn:

- **Agent Skills** là các quy trình viết sẵn (file `SKILL.md`). Skill liên quan được chèn vào prompt của agent khi card khớp với nó. Skill cho agent biết *cách làm*.
- **Server MCP** là các tool agent gọi được: web, git, trí nhớ, GitHub, Google, dữ liệu thị trường và nhiều thứ khác. MCP cho agent *với tới* hệ thống bên ngoài.

Skill áp dụng cho mọi agent chạy card. Server MCP chỉ áp dụng cho stage chạy qua Claude Agent SDK (xem [Agent](./agents.md)).

## Agent Skills

### Cấu trúc thư viện

```
skills/
├── INDEX.md                         # danh mục loader đọc
├── README.md
├── bundled/<danh-mục>/<tên>/SKILL.md   # 75 skill lõi
├── optional/<danh-mục>/<tên>/SKILL.md  # 103 skill tuỳ chọn
├── lucy/<tên>/SKILL.md                 # 4 skill về vận hành chính Lucy
└── _proposed/<slug>/SKILL.md           # bản nháp từ skill-learn (không bao giờ tự bật)
```

| Nhóm | Gồm gì | Ví dụ |
|---|---|---|
| **bundled** | Skill đa dụng, phần lớn chuyển thể từ Hermes Agent (giấy phép MIT, giữ ghi công trong frontmatter) | `github-pr-workflow`, `github-code-review`, `claude-design`, `excalidraw`, `himalaya`, `dogfood`, `kanban-orchestrator` |
| **optional** | Skill chuyên sâu hoặc theo dự án: mlops, tài chính, blockchain, bảo mật, thiết kế, web… | `code-wiki`, `rest-graphql-debug`, `subagent-driven-development`, bộ skill thiết kế "taste" |
| **lucy** | Quy trình vận hành Lucy: khởi động lại dịch vụ mà không đụng bridge, thêm endpoint coordinator, chạy một phase auto-build, rehost sau khi build | `lucy-deploy-no-bridge`, `lucy-add-coordinator-endpoint`, `lucy-autobuild-phase`, `lucy-rehost` |

Trong `INDEX.md`, 🎯 đánh dấu danh mục hợp với Lucy, 📦 đánh dấu danh mục ngách mà bạn xoá được khi cần chỗ trống. Một số skill viết cho runtime agent khác và nhắc tới tool Lucy không có. Hãy coi chúng là tài liệu quy trình để tham khảo, đừng chạy như script.

::: tip
`skills/ui-ux-pro-max/` và `skills/web-composition/` nằm ở cấp ngoài cùng và không có dòng nào trong `INDEX.md`, nên loader không bao giờ chọn chúng. Thêm dòng index nếu bạn muốn chúng được khớp.
:::

### Skill được chọn thế nào

Loader (`agent-machine/src/skill-loader.ts`) chạy một lần cho mỗi stage của card:

1. Nó đọc mọi dòng trong `INDEX.md` có đúng dạng sau:
   ```
   - **<tên>** — <mô tả>. · [`skills/<đường-dẫn>/SKILL.md`](skills/<đường-dẫn>/SKILL.md)
   ```
   Mô tả phải kết thúc bằng dấu chấm ngay trước ` · [`. Dòng có dạng khác bị bỏ qua.
2. Nó tách từ trong **tiêu đề + brief** của card: chữ thường, bỏ dấu tiếng Việt, bỏ từ ngắn hơn 3 ký tự và một ít stopword.
3. Nó chấm điểm từng skill. Mỗi từ của card trùng với một từ trong **tên** skill (tách theo `-`) được **+3**. Nếu không trùng tên mà trùng với **mô tả** thì được **+1**.
4. Skill đạt **≥ 3** điểm thì đủ điều kiện. **2 skill cao nhất** được đọc trọn và nối vào system prompt của agent dưới mục "SKILL ÁP DỤNG", tối đa khoảng 24.000 ký tự (cỡ 6k token).

Không skill nào đạt 3 điểm thì không nạp gì, và agent chỉ thấy prompt persona của nó. Thực tế chỉ cần brief có một từ trong tên skill là đủ: brief nhắc "excalidraw" sẽ nạp skill `excalidraw`.

Thư viện mặc định nằm ở `<repo>/skills`. Đặt `LUCY_SKILLS=/đường/dẫn/skills` để dùng thư mục khác. Tab **Kỹ năng** của hub và `GET /skills` trên coordinator liệt kê skill đang bật và skill đề xuất.

Mỗi dự án còn có thể mang **skill dự án** riêng: một đoạn văn bản đặt trên dự án (trường `skill`). Đoạn này được chèn vào prompt của mọi agent làm việc trong dự án đó, bất kể card viết gì.

### Thêm skill của riêng bạn

1. Tạo thư mục và file `SKILL.md`:

   ```markdown
   ---
   name: release-checklist
   description: "Use when cutting a release: bump version, changelog, tag, verify build."
   version: 1.0.0
   author: <bạn>
   license: MIT
   metadata:
     lucy:
       tags: [release, changelog, tag, version]
       related_skills: [github-pr-workflow]
   ---

   # Checklist phát hành

   ## Khi nào dùng
   - Chuẩn bị một bản phát hành có tag cho repo.

   ## Các bước
   1. Chạy bộ test; lỗi thì dừng.
   2. Tăng version trong package.json …
   3. …

   ## Lỗi hay gặp
   - Gắn tag trước khi commit changelog.

   ## Checklist kiểm tra
   - [ ] `git tag` có tag mới
   - [ ] CI xanh trên tag
   ```

   Lưu thành `skills/lucy/release-checklist/SKILL.md`, hoặc chỗ nào trong `skills/` cũng được.

2. Thêm một dòng vào `INDEX.md`, đúng định dạng loader cần:

   ```markdown
   - **release-checklist** — Phát hành bản mới: tăng version, changelog, tag, kiểm tra build. · [`skills/lucy/release-checklist/SKILL.md`](skills/lucy/release-checklist/SKILL.md)
   ```

3. Vậy là xong. Index được đọc lại ở mỗi stage nên không cần khởi động lại gì.

Mẹo để khớp tốt:

- Đưa những từ người ta thực sự hay viết trong card vào **tên** (mỗi phần của tên đáng 3 điểm) và vào **mô tả**.
- Giữ mỗi skill tập trung vào một việc. Mỗi stage chỉ nạp hai skill, và skill dài sẽ bị cắt ở giới hạn ký tự.
- Vì dấu đã bị bỏ, từ khoá tiếng Việt hay tiếng Anh đều khớp được.

### Skill-learn: skill đề xuất

Khi một card kết thúc ở `done`, Lucy có thể hỏi một model rẻ xem việc vừa làm có phải là **mẫu dùng lại được** không. Nếu có, một skill nháp được ghi vào `skills/_proposed/<slug>/SKILL.md` với `status: proposed`, các bước nó rút ra và id card nguồn.

- Mặc định tắt. Bật bằng `LUCY_SKILL_LEARN=1` trên coordinator.
- Bản đề xuất **không bao giờ** được thêm vào `INDEX.md`, nên không bao giờ tự được nạp.
- Muốn dùng thì xem lại, chuyển vào `skills/lucy/` (hoặc nhóm khác), chỉnh sửa và thêm dòng vào `INDEX.md`.

```bash
cd ~/lucy/agent-machine
npm run skill-learn                         # tổng quan: số skill đang bật + danh sách đề xuất
npm run skill-learn -- --card <cardId>      # soạn đề xuất từ một card (chạy thử trừ khi LUCY_SKILL_LEARN=1)
```

## Server MCP

Server MCP được gắn **theo persona** cho mỗi stage chạy qua Claude Agent SDK. Chúng được sắp theo id để phần đầu prompt ổn định, giữ được cache. Lượt chạy lane rẻ dùng bộ tool có sẵn của riêng nó.

### Bật MCP

Mọi thứ **mặc định tắt**. Có hai loại cờ điều khiển:

| Cờ | Ý nghĩa |
|---|---|
| `LUCY_MCP=1` | Công tắc tổng. Khi tắt, agent chạy không có server MCP nào. |
| `LUCY_MCP_<ID>=on` / `off` | Theo từng server, đè lên mặc định. Nếu không đặt, server *live* thì bật, server *scaffold* thì tắt. |

Một server chỉ được gắn khi **đủ tất cả** điều kiện: công tắc tổng bật, server được bật, persona nằm trong phạm vi của nó, đủ biến môi trường bắt buộc, và nó chưa lỗi 3 lần liên tiếp trong tiến trình này (circuit breaker).

Đặt key và cờ ở nơi tiến trình **worker** đọc môi trường. Với ecosystem pm2 đi kèm, đó là `.env.llm` (key) và `.env.runtime` (cờ). Sau đó khởi động lại worker:

```bash
# .env.llm  (chmod 600, không bao giờ commit)
GITHUB_TOKEN=<github-pat>
TWELVEDATA_API_KEY=<twelvedata-key>
GOOGLE_REFRESH_TOKEN=<google-refresh-token>
NOTION_TOKEN=<notion-integration-secret>

# .env.runtime
LUCY_MCP=1
LUCY_MCP_GITHUB=on
LUCY_MCP_TWELVEDATA=on
```

```bash
pm2 restart ecosystem.config.cjs --only lucy-vps-worker --update-env   # đọc lại các file env
```

Tab **Kết nối** của hub, lấy dữ liệu từ `GET /mcp` trên coordinator, hiện trạng thái từng server: `master-off`, `needs-creds`, `disabled`, `tripped` hoặc `live`, cùng các key còn thiếu. Nó không bao giờ hiện giá trị key.

### Các server có sẵn

| id | Cho agent cái gì | Mặc định | Cần | Persona |
|---|---|---|---|---|
| `fs` | Đọc/ghi file trong workspace của card (`@modelcontextprotocol/server-filesystem` qua `npx`) | live | – | tất cả |
| `web` | `web_fetch` (URL → text, chặn host nội bộ) và `web_search` (DuckDuckGo, không cần key) | live | – | tất cả |
| `git` | `git_status`, `git_diff`, `git_log` chỉ đọc. Không commit, không push. | live | – | persona code* |
| `memory` | `memory_recall` (tìm trong vault) và `memory_episodic` (lượt chat cũ). Xem [Trí nhớ](./memory.md). | live | `LUCY_VAULT` | tất cả |
| `google` | Chỉ đọc: `gmail_search`, `gmail_read`, `calendar_upcoming`, `drive_search`, `youtube_my_channel`, `youtube_search` | live | `GOOGLE_REFRESH_TOKEN` + file OAuth client | tất cả |
| `binance` | `binance_price`, `binance_klines` (REST công khai, không key, chỉ crypto) | live | – | persona tài chính** |
| `coingecko` | MCP do CoinGecko host (giá, vốn hoá, lịch sử), không key | live | – | persona tài chính** |
| `github` | Repo, issue, PR (`@modelcontextprotocol/server-github` qua `npx`) | scaffold | `GITHUB_TOKEN` | persona code* |
| `twelvedata` | Cổ phiếu, forex, vàng (XAU), chỉ số. Không có crypto. | scaffold | `TWELVEDATA_API_KEY` | persona tài chính** |
| `notion` | Trang và database (`@notionhq/notion-mcp-server` qua `npx`) | scaffold | `NOTION_TOKEN` | tất cả |
| `registry` | Thử nghiệm: đưa tool lane của Lucy (tìm, tải trang, đọc/liệt kê/ghi/sửa file) ra qua MCP | scaffold | – | tất cả |

\* Persona code: `engineer`, `devops`, `reviewer`, `architect`, `tester`, `investigator`, `security`, `builder`, `grinder`, cộng mọi persona loại `executor`.
\*\* Persona tài chính: `finance`, `analyst`, `marketing`, `researcher`, cộng mọi persona có tên khớp finance/market/invest.

### Cài từng kết nối

**GitHub**

1. Tạo một personal access token loại fine-grained, có quyền đọc các repo Lucy cần thấy (thêm `read:org` nếu cần).
2. Thêm `GITHUB_TOKEN=<token>` vào `.env.llm`.
3. Đặt `LUCY_MCP=1` và `LUCY_MCP_GITHUB=on`, rồi khởi động lại worker. Lucy truyền token cho server dưới tên `GITHUB_PERSONAL_ACCESS_TOKEN`.

**Google (Gmail, Calendar, Drive, YouTube; chỉ đọc)**

1. Trong Google Cloud, tạo project, bật các API Gmail, Calendar, Drive và YouTube Data, rồi tạo OAuth client loại *Desktop*.
2. Tải file JSON của client về `~/lucy/.gcp-oauth.json`, hoặc đặt `GCP_OAUTH_FILE=/đường/dẫn/client.json`. Dạng `installed` hay `web` đều được.
3. Lấy **refresh token** cho tài khoản của bạn với scope chỉ đọc, bằng công cụ OAuth nào bạn quen. Lucy không kèm công cụ cho bước này. Đặt vào `.env.llm`: `GOOGLE_REFRESH_TOKEN=<token>`.
4. Đặt `LUCY_MCP=1`. Khi đã có thông tin đăng nhập, `google` tự bật; `LUCY_MCP_GOOGLE=off` để tắt. Lucy tự làm mới access token.

**Twelve Data**

1. Tạo tài khoản miễn phí trên twelvedata.com và chép API key.
2. Thêm `TWELVEDATA_API_KEY=<key>` vào `.env.llm`, rồi đặt `LUCY_MCP=1` và `LUCY_MCP_TWELVEDATA=on`.
3. Tuỳ chọn: đổi endpoint bằng `TWELVEDATA_MCP_URL` (mặc định `https://mcp.twelvedata.com/mcp`).

**Notion**

1. Tạo một internal integration và chép secret của nó.
2. Chia sẻ các trang hoặc database Lucy được đọc cho integration đó.
3. Thêm `NOTION_TOKEN=<secret>` vào `.env.llm`, rồi đặt `LUCY_MCP=1` và `LUCY_MCP_NOTION=on`.

**Binance và CoinGecko** không cần key. Chúng chạy ngay khi `LUCY_MCP=1`. Tắt bằng `LUCY_MCP_BINANCE=off` / `LUCY_MCP_COINGECKO=off`, hoặc trỏ sang chỗ khác bằng `BINANCE_REST_URL` / `COINGECKO_MCP_URL`.

**Registry** (thử nghiệm): `LUCY_MCP=1` và `LUCY_MCP_REGISTRY=on`. Tool của nó cố ý trùng với `web` và `fs`. Cứ để tắt, trừ khi bạn đang thử nó.

### Thêm server MCP mới

Server được khai báo trong `MCP_REGISTRY` ở `agent-machine/src/mcp-registry.ts`. Thêm một mục rồi khởi động lại worker:

```ts
{
  id: 'weather',                       // tool hiện ra dạng mcp__weather__*
  title: 'Weather API',
  scopes: ['web'],                     // một trong: fs, web, git, memory, github, google, notion
  status: 'scaffold',                  // 'scaffold' = tắt tới khi LUCY_MCP_WEATHER=on
  envKeys: ['WEATHER_API_KEY'],        // thiếu → không gắn, hiện là needs-creds
  scopeLabel: 'mọi persona',
  doc: 'Đặt WEATHER_API_KEY trong .env.llm, rồi LUCY_MCP=1 + LUCY_MCP_WEATHER=on.',
  // allow: (p) => p.id === 'researcher', // lọc persona (tuỳ chọn)
  build: () => {
    const key = process.env.WEATHER_API_KEY
    if (!key) return null
    // stdio:  { type: 'stdio', command: 'npx', args: ['-y', '<package>'], env: { ... } }
    // remote: { type: 'http', url: 'https://…', headers: { authorization: `Bearer ${key}` } }  hoặc  { type: 'sse', url }
    return { type: 'http', url: 'https://<mcp-endpoint>', headers: { authorization: `Bearer ${key}` } }
  },
},
```

- `id` trở thành tên cờ (`LUCY_MCP_WEATHER`) và tiền tố tool. Lucy tự thêm `mcp__<id>` vào danh sách tool được phép của persona.
- `build()` nhận `{ workspace, repoRoot, vault }` cho server cần đường dẫn, và trả `null` khi không chạy được.
- Với tool nhỏ, bạn cũng dựng được server chạy trong tiến trình bằng `createSdkMcpServer` + `tool()` của Agent SDK, giống cách `web`, `git` và `binance` được dựng.
- Chạy `npm run smoke:mcp` và `npm run typecheck` trong `agent-machine/` trước khi khởi động lại.

## Lưu ý bảo mật

::: warning Xem kỹ trước khi bật
Skill là văn bản đi thẳng vào system prompt của agent. Server MCP là code chạy với quyền của worker và thấy mọi thứ agent gửi cho nó. Agent chạy với chế độ bỏ qua hỏi quyền của Claude, bắt đầu từ workspace của nó.
:::

- **Đọc kỹ mọi `SKILL.md` của bên thứ ba** trước khi thêm vào `INDEX.md`. Cảnh giác với chỉ dẫn tải và chạy script từ xa, gửi dữ liệu tới URL lạ, đọc file `.env`, hay tắt các lớp bảo vệ.
- **Ghim phiên bản và kiểm tra gói MCP.** Server khởi động bằng `npx -y <package>` sẽ tải bản mới nhất mỗi lần chạy. Với server nào được cấp token, nên dùng phiên bản bạn đã xem qua (`<package>@<version>`).
- **Quyền tối thiểu.** Dùng token chỉ đọc hoặc fine-grained. Dùng `allow` để giới hạn server cho đúng persona cần. Máy nào không cần thì để `LUCY_MCP` tắt.
- **Secret chỉ nằm trong file env** (`.env.llm`, quyền 600, bị git bỏ qua). Không dán key vào chat, không đưa key vào skill hay note trong vault.
- **Bản nháp từ skill-learn là chưa đáng tin** tới khi bạn xem lại. Chúng do model sinh ra từ kết quả của card.
- Cân nhắc bật `LUCY_HOOKS=1` trên worker. Nó thêm một lớp chặn trước khi gọi tool, chặn lệnh shell nguy hiểm (`git push`, `rm -rf /`, `curl … | sh`, …) và ghi log từng lần gọi tool. Xem [Bảo mật](./security.md).
