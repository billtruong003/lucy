# Skills & MCP

Lucy's agents get extra abilities from two sources:

- **Agent Skills** are written procedures (`SKILL.md` files). The relevant ones are added to an agent's prompt when a card matches them. They give the agent know-how.
- **MCP servers** are tools the agent can call: web, git, memory, GitHub, Google, market data and more. They give the agent reach.

Skills apply to every card agent. MCP servers apply only to stages that run through the Claude Agent SDK (see [Agents](./agents.md)).

## Agent Skills

### Library layout

```
skills/
├── INDEX.md                         # the catalogue the loader reads
├── README.md
├── bundled/<category>/<name>/SKILL.md   # 75 core skills
├── optional/<category>/<name>/SKILL.md  # 103 opt-in skills
├── lucy/<name>/SKILL.md                 # 4 skills about running Lucy itself
└── _proposed/<slug>/SKILL.md            # drafts from skill-learn (never active)
```

| Group | What's in it | Examples |
|---|---|---|
| **bundled** | General-purpose skills, many adapted from Hermes Agent (MIT, attribution kept in frontmatter) | `github-pr-workflow`, `github-code-review`, `claude-design`, `excalidraw`, `himalaya`, `dogfood`, `kanban-orchestrator` |
| **optional** | Niche or project-specific skills: mlops, finance, blockchain, security, design, web-development… | `code-wiki`, `rest-graphql-debug`, `subagent-driven-development`, the design "taste" skills |
| **lucy** | Procedures for operating Lucy: restart services without touching the bridge, add a coordinator endpoint, run an auto-build phase, rehost after a build | `lucy-deploy-no-bridge`, `lucy-add-coordinator-endpoint`, `lucy-autobuild-phase`, `lucy-rehost` |

In `INDEX.md`, 🎯 marks a category that fits Lucy well and 📦 marks a niche category you can delete if disk space matters. Some skills were written for another agent runtime and refer to tools Lucy doesn't have. Treat those as reference procedures, not as scripts to run.

::: tip
`skills/ui-ux-pro-max/` and `skills/web-composition/` sit at the top level and have no line in `INDEX.md`, so the loader never picks them. Add an index line if you want them matched.
:::

### How skills are picked

The loader (`agent-machine/src/skill-loader.ts`) runs once for each stage of a card:

1. It reads every line of `INDEX.md` that has this exact shape:
   ```
   - **<name>** — <description>. · [`skills/<path>/SKILL.md`](skills/<path>/SKILL.md)
   ```
   The description must end with a period right before ` · [`. Lines in any other shape are ignored.
2. It tokenizes the card's **title + brief**: lowercase, Vietnamese accents removed, words shorter than 3 characters dropped, plus a few stopwords.
3. It scores every skill. Each card word that matches a word in the skill **name** (split on `-`) adds **+3**. A word that matches the **description** instead adds **+1**.
4. Skills scoring **≥ 3** qualify. The **top 2** are read in full and appended to the agent's system prompt under "SKILL ÁP DỤNG", capped at about 24,000 characters (around 6k tokens).

Nothing is loaded when no skill scores 3 or more. The agent then only sees its persona prompt. In practice a single word from the skill name in the brief is enough: a brief that mentions "excalidraw" loads the `excalidraw` skill.

The library location defaults to `<repo>/skills`. Set `LUCY_SKILLS=/path/to/skills` to use another folder. The hub's **Skills** tab (*Kỹ năng*) and `GET /skills` on the coordinator list the active and proposed skills.

A project can also carry its own **project skill**: free text set on the project (`skill` field). It is added to the prompt of every agent working on that project, whatever the card says.

### Adding your own skill

1. Create a folder and a `SKILL.md`:

   ```markdown
   ---
   name: release-checklist
   description: "Use when cutting a release: bump version, changelog, tag, verify build."
   version: 1.0.0
   author: <you>
   license: MIT
   metadata:
     lucy:
       tags: [release, changelog, tag, version]
       related_skills: [github-pr-workflow]
   ---

   # Release checklist

   ## When to use
   - Preparing a tagged release of a repo.

   ## Steps
   1. Run the test suite; stop if it fails.
   2. Bump the version in package.json …
   3. …

   ## Common pitfalls
   - Tagging before the changelog is committed.

   ## Verification checklist
   - [ ] `git tag` shows the new tag
   - [ ] CI is green on the tag
   ```

   Save it as `skills/lucy/release-checklist/SKILL.md`, or anywhere under `skills/`.

2. Add a line to `INDEX.md` in the exact format the loader expects:

   ```markdown
   - **release-checklist** — Cut a release: bump version, changelog, tag, verify build. · [`skills/lucy/release-checklist/SKILL.md`](skills/lucy/release-checklist/SKILL.md)
   ```

3. That's it. The index is read fresh for every stage, so no restart is needed.

Tips for good matching:

- Put the words people will actually write in a card into the **name** (each part of the name is worth 3 points) and the **description**.
- Keep each skill focused. Only two skills load per stage, and long skills are cut at the character cap.
- Since accents are removed, Vietnamese and English keywords both work.

### Skill-learn: proposed skills

When a card finishes as `done`, Lucy can ask a cheap model whether the work was a **reusable pattern**. If it was, a draft skill is written to `skills/_proposed/<slug>/SKILL.md` with `status: proposed`, the steps it found and the source card id.

- Off by default. Turn it on with `LUCY_SKILL_LEARN=1` on the coordinator.
- Proposals are **never** added to `INDEX.md`, so they are never loaded automatically.
- To adopt one, review it, move it into `skills/lucy/` (or another group), edit it, and add its line to `INDEX.md`.

```bash
cd ~/lucy/agent-machine
npm run skill-learn                         # overview: active count + proposed list
npm run skill-learn -- --card <cardId>      # draft a proposal from one card (dry run unless LUCY_SKILL_LEARN=1)
```

## MCP servers

MCP servers are mounted **per persona** for each stage that runs through the Claude Agent SDK. They are sorted by id so the prompt prefix stays stable for caching. Cheap-lane runs use their own built-in tools instead.

### Switching MCP on

Everything is **off by default**. Two kinds of flags control it:

| Flag | Meaning |
|---|---|
| `LUCY_MCP=1` | Master switch. While it is off, agents run with no MCP servers at all. |
| `LUCY_MCP_<ID>=on` / `off` | Per server, overriding its default. Without it, servers marked *live* are on and servers marked *scaffold* are off. |

A server is mounted only if **all** of these hold: the master switch is on, the server is enabled, the persona is in its scope, its required env keys are set, and it has not failed 3 times in a row in this process (circuit breaker).

Put the keys and flags where the **worker** process reads its environment. With the provided pm2 ecosystem that means `.env.llm` (keys) and `.env.runtime` (flags). Then restart the worker:

```bash
# .env.llm  (chmod 600, never commit)
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
pm2 restart ecosystem.config.cjs --only lucy-vps-worker --update-env   # re-reads the env files
```

The hub's **Connections** tab (*Kết nối*), backed by `GET /mcp` on the coordinator, shows each server's state: `master-off`, `needs-creds`, `disabled`, `tripped` or `live`, plus which keys are missing. It never shows the key values.

### Available servers

| id | What it gives agents | Default | Needs | Personas |
|---|---|---|---|---|
| `fs` | Read/write files in the card workspace (`@modelcontextprotocol/server-filesystem` via `npx`) | live | – | all |
| `web` | `web_fetch` (URL → text, blocks internal hosts) and `web_search` (DuckDuckGo, no key) | live | – | all |
| `git` | Read-only `git_status`, `git_diff`, `git_log`. No commit, no push. | live | – | code personas* |
| `memory` | `memory_recall` (vault search) and `memory_episodic` (past chat turns). See [Memory](./memory.md). | live | `LUCY_VAULT` | all |
| `google` | Read-only `gmail_search`, `gmail_read`, `calendar_upcoming`, `drive_search`, `youtube_my_channel`, `youtube_search` | live | `GOOGLE_REFRESH_TOKEN` + OAuth client file | all |
| `binance` | `binance_price`, `binance_klines` (public REST, no key, crypto only) | live | – | finance personas** |
| `coingecko` | CoinGecko hosted MCP (prices, market cap, history), no key | live | – | finance personas** |
| `github` | Repos, issues, PRs (`@modelcontextprotocol/server-github` via `npx`) | scaffold | `GITHUB_TOKEN` | code personas* |
| `twelvedata` | Stocks, forex, gold (XAU), indices. Not crypto. | scaffold | `TWELVEDATA_API_KEY` | finance personas** |
| `notion` | Pages and databases (`@notionhq/notion-mcp-server` via `npx`) | scaffold | `NOTION_TOKEN` | all |
| `registry` | Experimental: Lucy's lane tools (search, fetch, read/list/write/edit file) exposed over MCP | scaffold | – | all |

\* Code personas: `engineer`, `devops`, `reviewer`, `architect`, `tester`, `investigator`, `security`, `builder`, `grinder`, plus any persona of kind `executor`.
\*\* Finance personas: `finance`, `analyst`, `marketing`, `researcher`, plus any persona whose name matches finance/market/invest.

### Setting up each connector

**GitHub**

1. Create a fine-grained personal access token with read access to the repos Lucy should see (add `read:org` if needed).
2. Add `GITHUB_TOKEN=<token>` to `.env.llm`.
3. Set `LUCY_MCP=1` and `LUCY_MCP_GITHUB=on`, then restart the worker. Lucy passes the token to the server as `GITHUB_PERSONAL_ACCESS_TOKEN`.

**Google (Gmail, Calendar, Drive, YouTube; read-only)**

1. In Google Cloud, create a project, enable the Gmail, Calendar, Drive and YouTube Data APIs, and create an OAuth client of type *Desktop*.
2. Download the client JSON to `~/lucy/.gcp-oauth.json`, or set `GCP_OAUTH_FILE=/path/to/client.json`. Both the `installed` and `web` shapes are accepted.
3. Get a **refresh token** for your account with read-only scopes, using any OAuth tool you like. Lucy does not include a helper for this step. Put it in `.env.llm` as `GOOGLE_REFRESH_TOKEN=<token>`.
4. Set `LUCY_MCP=1`. `google` is on by default once credentials exist, and `LUCY_MCP_GOOGLE=off` disables it. Lucy refreshes the access token itself.

**Twelve Data**

1. Create a free account at twelvedata.com and copy the API key.
2. Add `TWELVEDATA_API_KEY=<key>` to `.env.llm`, then set `LUCY_MCP=1` and `LUCY_MCP_TWELVEDATA=on`.
3. Optional: change the endpoint with `TWELVEDATA_MCP_URL` (default `https://mcp.twelvedata.com/mcp`).

**Notion**

1. Create an internal integration and copy its secret.
2. Share the pages or databases Lucy may read with that integration.
3. Add `NOTION_TOKEN=<secret>` to `.env.llm`, then set `LUCY_MCP=1` and `LUCY_MCP_NOTION=on`.

**Binance and CoinGecko** need no keys. They are active once `LUCY_MCP=1`. Turn them off with `LUCY_MCP_BINANCE=off` / `LUCY_MCP_COINGECKO=off`, or point them elsewhere with `BINANCE_REST_URL` / `COINGECKO_MCP_URL`.

**Registry** (experimental): `LUCY_MCP=1` and `LUCY_MCP_REGISTRY=on`. Its tools overlap with `web` and `fs` on purpose. Leave it off unless you are testing it.

### Adding a new MCP server

Servers are declared in `MCP_REGISTRY` in `agent-machine/src/mcp-registry.ts`. Add an entry, then restart the worker:

```ts
{
  id: 'weather',                       // tools appear as mcp__weather__*
  title: 'Weather API',
  scopes: ['web'],                     // one of: fs, web, git, memory, github, google, notion
  status: 'scaffold',                  // 'scaffold' = off until LUCY_MCP_WEATHER=on
  envKeys: ['WEATHER_API_KEY'],        // missing → not mounted, shown as needs-creds
  scopeLabel: 'all personas',
  doc: 'Set WEATHER_API_KEY in .env.llm, then LUCY_MCP=1 + LUCY_MCP_WEATHER=on.',
  // allow: (p) => p.id === 'researcher', // optional persona filter
  build: () => {
    const key = process.env.WEATHER_API_KEY
    if (!key) return null
    // stdio:  { type: 'stdio', command: 'npx', args: ['-y', '<package>'], env: { ... } }
    // remote: { type: 'http', url: 'https://…', headers: { authorization: `Bearer ${key}` } }  or  { type: 'sse', url }
    return { type: 'http', url: 'https://<mcp-endpoint>', headers: { authorization: `Bearer ${key}` } }
  },
},
```

- `id` becomes the env flag (`LUCY_MCP_WEATHER`) and the tool prefix. Lucy adds `mcp__<id>` to the persona's allowed tools automatically.
- `build()` gets `{ workspace, repoRoot, vault }` for servers that need paths, and returns `null` when it cannot run.
- For small tools you can also build an in-process server with `createSdkMcpServer` + `tool()` from the Agent SDK, the same way `web`, `git` and `binance` are built.
- Run `npm run smoke:mcp` and `npm run typecheck` in `agent-machine/` before restarting.

## Security notes

::: warning Review before you enable
A skill is text that goes straight into an agent's system prompt. An MCP server is code that runs with the worker's permissions and sees whatever the agent sends it. Agents run with Claude's permission prompts bypassed, starting in their workspace.
:::

- **Read every third-party `SKILL.md`** before adding it to `INDEX.md`. Watch for instructions to fetch and run remote scripts, send data to unknown URLs, read `.env` files, or turn off safeguards.
- **Pin and audit MCP packages.** Servers started with `npx -y <package>` download the latest version at launch. For anything that gets a token, prefer a version you have reviewed (`<package>@<version>`).
- **Least privilege.** Use read-only or fine-grained tokens. Use `allow` to restrict a server to the personas that need it. Keep `LUCY_MCP` off on machines that don't need it.
- **Secrets stay in env files** (`.env.llm`, mode 600, git-ignored). Never paste keys into chat, and never put them in skills or vault notes.
- **Skill-learn drafts are untrusted** until you review them. They are generated by a model from card output.
- Consider `LUCY_HOOKS=1` on workers. It adds a pre-tool guard that blocks dangerous shell commands (`git push`, `rm -rf /`, `curl … | sh`, …) and logs each tool call. See [Security](./security.md).
