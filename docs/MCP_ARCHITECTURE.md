# LUCY — MCP Architecture (bộ MCP mạnh + lớp quản tool)

> **Viết 2026-06-10.** Architect MCP **TRƯỚC** khi build M2 (NORTH_STAR). Bill muốn bộ MCP **mạnh,
> overkill** — không phải "vài mống". Research: source Hermes (`tools/mcp_tool.py`, `tool_search.py`,
> `delegate_tool.py`) + Hermes Atlas + Unity MCP + catalog MCP 2026. Neo: [NORTH_STAR.md](NORTH_STAR.md) M2.

---

## 0. Nguyên tắc — overkill OK, NHƯNG bắt buộc lớp quản

Nhồi 20+ server thẳng vào `claude -p` = **phình context + bể prompt-cache + chậm + đốt token**. "Bộ MCP
mạnh" ≠ nhồi nhiều — = **nhiều server SAU 1 lớp quản**. Hermes chứng minh đúng pattern (4 tầng + gateway);
Lucy xài lại được vì `claude -p` **đã có tool-search native** (cùng cơ chế Hermes tự viết).

---

## 1. Kiến trúc 3 tầng cho Lucy

```
        ┌─ claude -p (chạy trên WORKER) ──────────────────────────────────┐
        │  tool-search NATIVE: >10% ctx → gập tool non-core thành 3 bridge │
        │  (tool_search / tool_describe / tool_call), BM25 local           │
        └──────────┬───────────────────────────────┬──────────────────────┘
                   │ local stdio (theo worker)      │ 1 endpoint
                   ▼                                ▼
        ┌──────────────────────┐        ┌──────────────────────────────────┐
        │ LOCAL servers         │        │ GATEWAY (MetaMCP, VPS)           │
        │ • Unity MCP (Editor)  │        │  gom 20+ API server → 1 endpoint │
        │ • filesystem repo local│       │  • Namespace = per-task scope    │
        │ • desktop-commander    │       │  • include/exclude filter        │
        │   (shell/terminal)     │       │  • auth + circuit-breaker        │
        └──────────────────────┘        └──────────────────────────────────┘
```

**MCP đặt THEO worker** (nối topology coordinator/worker đã có):
- **Local-only** (phải ở máy chạy Unity/file): Unity MCP, filesystem repo local, desktop-commander/shell → `claude -p` mount **stdio trực tiếp**.
- **API server** (github/search/mail/notion…): sau **1 GATEWAY** → `claude -p` chỉ thấy 1 endpoint.

**Giữ prompt-cache (nối M1 cache-parity):** mỗi card pass `--mcp-config` **theo persona/task** (không nhồi
superset), thứ tự server/tool **sort cố định** → prefix byte-stable → cache không vỡ.

---

## 2. Lớp quản tool — mượn Hermes (4 tầng) + Claude native

| Tầng | Hermes làm (file) | Lucy dùng |
|---|---|---|
| 1. include/exclude khi load | `mcp_tool.py::_should_register` (3382) | filter ở **gateway** (server nào, tool nào) |
| 2. primitive gating | `_select_utility_schemas` (3285) | tắt `resources`/`prompts` stub thừa |
| 3. **progressive disclosure** | `tool_search.py` (BM25, >10% ctx → 3 bridge tool, ~50 core never-defer) | **`claude -p` tool-search NATIVE** — bật lên, khỏi tự viết |
| 4. task-scoped whitelist | `delegate_tool.py` `DELEGATE_BLOCKED_TOOLS` (45) | per-persona/per-card `--mcp-config` (coder≠researcher) |
| + GATEWAY | `mcp_serve.py` / managed gateway | **MetaMCP** (hoặc Docker MCP Gateway) |

> Hermes circuit-breaker: 3 strike → mở 60s (`mcp_tool.py` 1990-2034). Gateway/worker nên có để 1 server
> lỗi không đốt token retry.

---

## 3. GATEWAY — chọn cái nào

| Option | Mạnh | Khi nào |
|---|---|---|
| **MetaMCP** ⭐ (`metatool-ai/metamcp`) | gom nhiều server → 1 endpoint; **Namespaces** = map per-task scope; middleware filter; OIDC; SSE/HTTP/OpenAPI | **khuyến nghị** — namespaces khớp per-task + auth |
| Docker MCP Gateway (`docker/mcp-gateway`) | mỗi server 1 container (isolation) + catalog scoping (`mcp-find`) | nếu thích isolation Docker |
| mcpproxy-go | single binary nhẹ | VPS tối giản |

(Index theo dõi: `e2b-dev/awesome-mcp-gateways`.)

---

## 4. CATALOG overkill — theo domain tech-life của Bill

⭐ = ưu tiên cao · L = local-only · G = sau gateway

| Domain | Server | Làm gì | Vị trí |
|---|---|---|---|
| **Core** | Filesystem ⭐ · Fetch ⭐ · Memory(graph) · **Basic Memory** ⭐(→ lucy-vault, nối M1) · Time · Sequential-thinking | file r/w · url→md · memory · vault · thời gian · reasoning | L/G |
| **Dev** | **GitHub** ⭐(`github/github-mcp-server`) · Git · **Desktop-Commander** ⭐(shell/terminal/process/ripgrep) · Docker · Postgres(read-only)/SQLite · Sentry | repo/PR/issue · git · shell · container · DB · lỗi | G + L(shell) |
| **Unity/Game** | **CoplayDev/unity-mcp** ⭐ · Blender MCP · Tripo/Meshy | điều khiển Unity Editor · tạo asset 3D · text→3D | **L** |
| **Web/Browser** | **Playwright MCP** ⭐(microsoft) · Firecrawl · agent-browser-mcp(CDP) | điều khiển trình duyệt thật · crawl/extract md | G/L |
| **Search** | Brave(chung) · Tavily(research) · Exa(semantic) | tìm web nhiều kiểu | G |
| **Comms** | **Discord MCP** ⭐(radiant-bot) · Telegram · Slack | đọc/post kênh | G |
| **Personal** | **Google Workspace** ⭐(Gmail/Calendar/Drive) · Notion | mail/lịch/file/notes | G |
| **Creative** | Figma · image-gen (MeiGen-AI-Design / Nanobanana) | design · gen ảnh | G |
| **Specialized** | hermes-council(second-opinion) · kindly-web-search | verify quyết định · search self-host | G |

→ ~25 server. **Overkill nhưng có tổ chức** — tool-search + per-task scope khiến mỗi card chỉ "thấy" tool cần.

---

## 5. Unity / Game (riêng — m làm game Unity)

**Pick: [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)** (~10.5k★, MIT, Unity 2021.3→6, **không có approval gate** → hợp tự động).
**43 tool / 9 nhóm:** `manage_gameobject` (tạo/sửa GO+component) · `manage_script` (viết/sửa C#) · `manage_scene`/prefab · `manage_asset` · `manage_editor` (play mode) · `read_console` (lỗi → vòng tự fix) · `run_tests` · `manage_menu_item` + camera/Cinemachine · physics · profiler.
**Kiến trúc:** Unity Editor package (C#) + Python MCP server (`uv`). `claude -p` → stdio → Python → Unity package → Editor. **Unity phải MỞ.**
**Wiring (local):** Unity *Package Manager → git URL* `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#main` → *Window → MCP for Unity → Configure All Detected Clients* (tự ghi config), hoặc `.mcp.json` stdio `uv --directory <UnityMcpServer/src> run server.py`.
**Bổ trợ:** [Blender MCP](https://github.com/ahujasid/blender-mcp) (~22k★, asset + Poly Haven/Rodin/Sketchfab) · Tripo/Meshy (text→3D).
**Gotcha:** sau `manage_script`/play-mode → domain reload → connection rớt transient → agent retry; không space trong path.

---

## 6. Security (Lucy chạm toàn tech-life → bắt buộc)
- **Gateway isolation + circuit-breaker** (Hermes 3-strike/60s).
- **Prompt-injection scan** MCP tool description (Hermes `_scan_mcp_description` 367) — MCP description là vector inject.
- **Per-tool approval cho nguy hiểm** (shell write · fs delete · git push · grant) → dùng HITL gate đã có ở engine.
- **Clawshell** scrub secret/PII ở biên output.
- **Safe env whitelist** (Hermes `_build_safe_env` 296) — secret không leak vào MCP subprocess.

---

## 7. Build order cho M2

```
1. GATEWAY: MetaMCP trên VPS → mount 1 endpoint vào claude -p (per-persona --mcp-config).
2. CORE: filesystem + fetch + basic-memory(→vault) + time + sequential.
3. DEV: github + git + desktop-commander(shell) + docker + postgres/sqlite.
4. UNITY (local): CoplayDev unity-mcp + Blender.
5. WEB: Playwright + Firecrawl + search (Brave/Tavily/Exa).
6. COMMS: Discord(radiant-bot) + Telegram.
7. PERSONAL: Google Workspace (mail/lịch/drive) + Notion.
8. Bật claude -p tool-search + per-persona scope + sorted tool order (giữ cache).
```
**Khuyến nghị thứ tự thật:** gateway + core + dev + Unity trước (đúng tech-life chính của m: code + game),
rồi web/comms/personal sau.

## Sources
Hermes source: `hermes-agent/tools/{mcp_tool,tool_search,delegate_tool}.py`. ·
Gateways: [MetaMCP](https://github.com/metatool-ai/metamcp) · [Docker MCP Gateway](https://github.com/docker/mcp-gateway) · [awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways) ·
Unity: [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) · [Blender MCP](https://github.com/ahujasid/blender-mcp) ·
Catalog: [Playwright MCP](https://github.com/microsoft/playwright-mcp) · [github-mcp-server](https://github.com/github/github-mcp-server) · [Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp) · [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) · [Best MCP servers 2026](https://www.developersdigest.tech/best/mcp-servers).
