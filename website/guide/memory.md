# Memory

Lucy's long-term memory is a folder of plain Markdown files, the **vault**. Lucy reads it before answering, writes new facts into it, and tidies it up every night. You can open the same folder in Obsidian or any editor and change it by hand.

Two rules explain most of how it behaves:

- **The files are the source of truth.** The search index lives in `.index/memory.db` inside the vault. It is only a cache: you can delete it and it gets rebuilt from the files.
- **Some folders belong to the machine.** Agents and you write to `Context/`, `Projects/`, `Daily/` and `Brain/inbox/`. Only the nightly *dream* writes `Brain/preferences/` and `Brain/active.md`.

The vault location comes from `LUCY_VAULT`, usually `~/lucy/lucy-vault`. If `LUCY_VAULT` is unset or points to a missing folder, memory features switch off quietly. The coordinator's brain routes then return `configured: false`.

## Vault layout

| Folder | What goes there | Who writes | Indexed for recall |
|---|---|---|---|
| `Context/` | Durable facts about you and your environment. `Context/USER.md` is the main profile. | You, Lucy | yes |
| `Projects/` | One note per project: goals, decisions, links | You, Lucy | yes |
| `Knowledge/` | Long-lived reference knowledge, grouped by topic | You, Lucy | yes |
| `Reference/` | Reference material you want searchable | You | yes |
| `Reports/` | Long reports Lucy writes to a file instead of pasting into chat | Lucy | yes |
| `Skills/` | Personal how-to notes. These are not the [Agent Skills](./skills-mcp.md) library. | You, Lucy | yes |
| `Daily/` | Session notes: one per finished card, with Goal/Done/Pending/Files | Engine | yes |
| `Brain/inbox/` | Raw *signals*, meaning observed patterns waiting for the dream | Lucy, engine | no |
| `Brain/inbox/processed/` | Signals the dream has handled | Dream | no |
| `Brain/preferences/` | Learned rules (`pref-<topic>.md`) with status and confidence | Dream only | no |
| `Brain/active.md` | Digest of confirmed preferences, injected into agent prompts | Dream only | no |
| `Brain/log/` | `<date>.jsonl` evidence events and `<date>.md` dream logs | Dream, hub | no |
| `Brain/agents/` | Per-persona "craft memory": lessons each agent persona has learned | Engine, dream | no |
| `Brain/claude-memory/` | Claude Code's built-in auto-memory, redirected into the vault (one fact per file plus a `MEMORY.md` index) | Claude Code | yes |
| `Brain/episodes/` | Cross-session memory (`sessions-<chat>.jsonl`) | Coordinator | `.md` files only |
| `Brain/proposals/` | Nightly consolidation reports (`consolidate-<date>.md`) | Dream | yes |
| `Brain/decisions/`, `Brain/entities/` | Optional curated notes | You | yes |
| `.index/` | SQLite index (`memory.db`), rebuildable | Recall | – |
| `.snapshots/` | Automatic backups taken before dream or consolidation changes anything (last 30 kept) | Dream | – |
| `.trash/` | Notes moved out by the junk cleaner | Hub | – |
| `_brain.yaml` | Optional dream thresholds (see below) | You | – |

The indexed folders are set by default in `recall.ts`. To replace the whole list, set `LUCY_INDEX_DIRS`:

```bash
LUCY_INDEX_DIRS="Context,Projects,Knowledge,Daily,Brain/claude-memory"
```

### Note format

Any Markdown file works. A few conventions give Lucy more structure to work with:

```markdown
---
title: Home lab
tags: [infra, homelab]
valid_from: 2026-01-10
---
# Home lab

- [hardware] Mini PC with 32 GB RAM #infra
- [network] Services sit behind a reverse proxy (internal only)
- runs_on [[Proxmox]]
- related_to "Backup plan" [[backup-plan]]
```

- `- [category] text #tag (context)` is an **observation**. Each one is indexed as its own row, so a category is searchable.
- `- relation [[Target]]` is a **relation**. Recall follows these wikilinks one step in both directions to suggest related notes.
- `valid_to:` in frontmatter marks a fact as no longer true (see [Bitemporal facts](#valid-to)).
- Title comes from `title:`, else the first `# heading`, else the file name.

## How recall works

Lucy searches the vault in two places:

1. **Before each chat turn.** The Telegram bridge and the web hub call the coordinator's `POST /recall` and add a short "related memory" block to the prompt.
2. **During agent work.** Agents can call the `memory_recall` tool when the `memory` MCP server is mounted (see [Skills & MCP](./skills-mcp.md)). They can also read the vault directly, because it is added as an extra directory.

```
query
  │
  ├─► FTS5 (unicode61, accents removed) ─ strict AND
  │      └─ no hits & ≥2 words → relaxed OR (stopwords dropped)
  │           └─ still none & ≥3 chars → trigram substring match
  │
  ├─► vector KNN (sqlite-vec, Jina embeddings)        [if LUCY_VECTOR on]
  │      └─ hits farther than LUCY_VECTOR_MAX_DIST (0.9) are dropped
  │
  ├─► merge with Reciprocal Rank Fusion (k=60)
  ├─► Jina reranker on the top pool                   [if LUCY_RERANK on]
  └─► + related notes via [[wikilinks]]  + past chat turns (episodic)
```

Details worth knowing:

- **Vietnamese and accents.** Accents are removed both when indexing and when searching, so `hoa` matches `hòa`. Trigram search catches partial words and codes: `adiant` finds `radiant`.
- **Expired facts are hidden.** Notes with `valid_to` set are left out of results unless you ask for them (`GET /recall?includeInvalid=1`).
- **Ranking.** Every hit increments a `recall_count` on the note. Ties are broken by recall count, then by most recent change.
- **Index freshness.** The coordinator re-indexes changed files at most every 30 seconds while serving recall. Only files whose checksum changed are re-parsed. Embeddings are added gradually, up to 24 per request.
- **Secrets are scrubbed.** Before any text is sent to Jina, and before chat turns are stored, things that look like keys or tokens become `[REDACTED]`.

### Vector search and reranking

Vector search turns on automatically when `JINA_API_KEY` is set. It is read from the environment, or from `~/lucy/.env.llm` (override the path with `LLM_ENV_FILE`).

| Variable | Default | Meaning |
|---|---|---|
| `JINA_API_KEY` | – | Turns on embeddings and the reranker |
| `LUCY_VECTOR` | on if key present | `0`/`off` = keyword search (FTS5) only |
| `JINA_EMBED_MODEL` | `jina-embeddings-v5-omni-nano` | Embedding model |
| `JINA_EMBED_DIM` | `768` | Vector size. **Changing it requires `npm run reindex`.** |
| `LUCY_VECTOR_MAX_DIST` | `0.9` | Cosine distance cut-off for vector hits |
| `LUCY_RERANK` | off | `1` = rerank merged results with Jina |
| `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | Reranker model |
| `LUCY_EMBED_THROTTLE_MS` | `1200` | Pause between embedding batches (rate-limit friendly) |

If Jina fails (including repeated HTTP 429s after backoff), vector search switches off for that process and recall falls back to FTS5. The chat keeps working.

### The recall gate and minimum score

Inserting memory into every message would add noise, so the chat paths filter it first:

- **Gate (Telegram bridge).** Commands, short acknowledgements ("ok", "yes") and very short messages skip recall. With `LUCY_RECALL_GATE2=1` (the default), messages that correct Lucy or only point back at the conversation ("that one", "option 2") also skip it. Messages that ask about the past ("last time", "did we decide") always run recall.
- **Minimum score.** Hits scored by the reranker must reach `LUCY_RECALL_MIN_SCORE` (default `0.35`). Hits without a reranker score (plain FTS or fused rank) must share at least one meaningful word with the question.

| Variable | Default | Meaning |
|---|---|---|
| `LUCY_RECALL_PREFETCH` | `1` | `0` turns off recall before each chat turn |
| `LUCY_RECALL_GATE2` | `1` | Correction/follow-up gate (bridge only) |
| `LUCY_RECALL_MIN_SCORE` | `0.35` | Rerank score threshold; `0` disables it |
| `LUCY_RECALL_MAX` | `8` bridge / `5` hub | Hits requested from the coordinator |
| `LUCY_RECALL_HITS` | `5` | Hits kept in the prompt block |
| `LUCY_RECALL_BUDGET` | `800` | Character budget of the block |
| `LUCY_RECALL_SNIPPET` | `200` | Characters per hit |
| `LUCY_RECALL_TIMEOUT` | `4` | Seconds before giving up on recall |
| `LUCY_RECALL_PROVENANCE` | `1` | Tag each hit with its file and age |
| `LUCY_RECALL_FAILLOUD` | `1` | Log recall failures instead of hiding them |

::: tip
`LUCY_RECALL_MIN_SCORE` only affects reranker scores. If you want score-based filtering, also set `LUCY_RERANK=1`.
:::

### Conversation history (episodic memory)

Chat turns from Telegram and the hub are stored in the `turns` table of `memory.db`, with secrets scrubbed. They show up in recall as "💬 (date)" hits when you ask about earlier conversations.

| Variable | Default | Meaning |
|---|---|---|
| `LUCY_EPISODIC` | on | `0` stops storing and searching turns |
| `LUCY_EPISODIC_RETENTION_DAYS` | `90` | Older turns are pruned (checked at most once an hour) |
| `LUCY_SESSION_SUMMARY` | off | `1` appends a summary to `Brain/episodes/sessions-<chat>.jsonl` when a chat session closes |

## Signals, evidence and the nightly dream

Lucy learns preferences in three steps.

**1. Signals.** A signal is a small file in `Brain/inbox/` that records one observation:

```markdown
---
kind: brain-signal
id: sig-2026-03-02-lucy-short-replies
created_at: 2026-03-02T10:00:00Z
topic: lucy/short-replies
signal: positive          # positive = do this, negative = avoid this
agent: lucy
principle: "Keep chat replies short; put long output in a file"
evidenced_by: [card-abc]
---
## Raw
Why this was noticed…
```

Signals come from three places. Lucy writes them when she notices a repeated pattern. The engine writes a negative signal when a card is sent back for rework or rejected at a gate. When a card finishes, a cheap one-turn model run can also write a distilled lesson, positive or negative (turn this off with `LUCY_DISTILL=0`).

**2. Dream.** `npm run dream` processes the inbox. It is deterministic and uses no LLM:

| Step | Rule (defaults) |
|---|---|
| Group | Signals are grouped by `topic` within a 14-day window. Older signals that never reached the threshold move to `inbox/processed/`. |
| Weight | Signals from you (human feedback) and from `bootstrap` count ×2. Machine signals count ×1. |
| Graduate | The dominant side reaches **2** → a new preference `pref-<topic>.md` with status `unconfirmed`. Signals on the losing side are cancelled. |
| Contradiction | Both sides present and neither reaches the threshold → logged as an open question, signals stay in the inbox. |
| Redundant | Same sign as an existing preference → counted as `applied` evidence, no duplicate created. |
| Rebuttal | Opposite sign reaches the threshold → `violated` evidence, preference becomes `rebutted` (unless pinned). |
| Confirm | `unconfirmed` → `confirmed` at the first `applied` evidence. |
| Confidence | Wilson 95% lower bound of applied vs. violated, × freshness (fades to 0 over 90 days). Bands: high ≥ 0.75, medium ≥ 0.40, else low. |
| Expire | `unconfirmed` with no evidence for 14 days → `expired`. `confirmed` with no evidence for 90 days → `stale`. |
| Prune | Retired preferences (expired/stale/rebutted) are deleted 30 days after their last update. Duplicate files for one topic are merged. |

Before writing anything, the dream copies `Brain/` to `.snapshots/dream-<time>/`. It then writes files atomically, appends a log to `Brain/log/<date>.md` and regenerates `Brain/active.md`. A run with nothing to do writes nothing.

`Brain/active.md` lists the confirmed preferences, plus the last three retired ones. It is added to the system prompt of every card agent, so the agents follow what Lucy has learned.

**3. Evidence.** Evidence lines are written to `Brain/log/<date>.jsonl`:

```json
{"ts":1767225600000,"prefId":"pref-lucy-short-replies","kind":"applied","src":"manual"}
```

The dream writes `auto` evidence. In the hub's **Brain** tab (*Bộ não*), 👍/👎 on a preference writes `manual` evidence and runs the dream immediately. Only one manual vote per preference, kind and day is counted.

### Tuning thresholds

Put a `_brain.yaml` at the vault root to override the defaults:

```yaml
candidate_threshold: 2
unconfirmed_window_days: 14
contradiction_window_days: 14
stale_evidence_days: 90
retire_grace_days: 30
confidence:
  high_min: 0.75
  medium_min: 0.4
```

### Fact consolidation and bitemporal facts (`valid_to`) {#valid-to}

A second, optional pass cleans up `Brain/claude-memory/` (one fact per file). It needs vector search, because it compares facts by embedding similarity.

- Pairs with cosine similarity ≥ `0.86` (`LUCY_CONSOLIDATE_SIM`) go to a cheap model, which answers `NOOP`, `DELETE` (pure duplicate), `UPDATE` (merge into the kept fact) or `SUPERSEDE` (the facts contradict each other).
- **SUPERSEDE never deletes.** It writes `valid_to: <now>` into the older fact's frontmatter. Recall then hides the fact, but the file and its history stay.
- Facts of type `user` or `feedback` count double. An older fact with higher trust is never invalidated automatically.
- Clusters (similarity ≥ `0.78`, total trust ≥ 5) can produce suggested "insights". These appear only in the report.
- Any model error or unclear answer becomes `NOOP`.
- Each run writes `Brain/proposals/consolidate-<date>.md`. It is a **dry run** unless `LUCY_CONSOLIDATE_APPLY=1`. Applied runs snapshot `claude-memory/` to `.snapshots/` first.

`npm run dream` runs consolidation only when `LUCY_CONSOLIDATE=1` and vector search is on. You can also retire a fact by hand: add `valid_to: 2026-03-01` to its frontmatter, and recall stops returning it after the next reindex.

### Running the dream nightly

`bridge/cron_dream.sh` runs the full nightly sequence: dream (consolidation on and applied), an incremental reindex, then a one-line "learning heartbeat" (turns today, notes, embedding backlog). If `TELEGRAM_BOT_TOKEN` and `LUCY_ALLOWED_USER_ID` are set, it also sends a Telegram summary. It stays silent when nothing changed and no heartbeat line was produced.

```bash
# crontab -e   (02:00 every night)
0 2 * * * /path/to/lucy/bridge/cron_dream.sh >> /path/to/lucy-workspace/dream-cron.log 2>&1
```

The same run also condenses each persona's lessons in `Brain/agents/`. Once a persona has collected 16 or more raw lessons, they are merged into at most 8 rules, and old raw lessons are archived.

## Pinning

A pinned preference is exempt from rebuttal, expiry, staleness, pruning and de-duplication. Pin a preference in any of three ways:

- The 📌 button on a preference in the hub's Brain tab.
- The API (through the hub, or directly on the coordinator):
  ```bash
  curl -s -X POST http://127.0.0.1:8780/brain/pin \
    -H "x-worker-token: <AM_TOKEN>" -H 'content-type: application/json' \
    -d '{"prefId":"pref-lucy-short-replies","pinned":true}'
  ```
- Setting `pinned: true` in the preference's frontmatter. This is the one edit to `Brain/preferences/` that is safe by hand.

## Junk cleanup

In the hub's Brain tab you can scan the vault for junk and move it out:

- sync-conflict copies (`sync-conflict`, `conflicted copy`, `*.orig.md`)
- empty files, or files with only frontmatter
- exact duplicates (same content hash; the first copy is kept)

Cleaning **moves** the selected files to `.trash/<timestamp>/` inside the vault. Nothing is deleted. The scan skips `.git`, `.obsidian`, `.trash`, `node_modules` and other dot-folders, and returns at most 400 items per run. The endpoints are `GET /api/memory/junk` and `POST /api/memory/clean` on the hub.

## Editing notes by hand / Obsidian

Open the vault folder as an Obsidian vault. Wikilinks, tags and frontmatter all work as usual.

- **Safe to edit:** everything under `Context/`, `Projects/`, `Knowledge/`, `Reference/`, `Reports/`, `Skills/`, `Daily/`, plus your own signals in `Brain/inbox/`.
- **Do not edit:** `Brain/active.md` and `Brain/preferences/*.md` (apart from `pinned:`). The next dream overwrites them. To change a rule, write signals, vote 👍/👎, or pin it.
- **Teach Lucy a fact:** append an observation line to `Context/USER.md`, for example `- [work] Prefers TypeScript for new services #dev`.
- **Teach Lucy a rule:** drop a signal file into `Brain/inbox/`. Two matching signals, or one from you, graduate at the next dream.

Your edits reach recall at the next incremental reindex: within about 30 seconds while the coordinator is serving recall, or at the nightly run.

## Reindexing

```bash
cd ~/lucy/agent-machine
LUCY_VAULT=~/lucy/lucy-vault npm run reindex
```

This drops the index, rebuilds it from the files, and embeds every note when vector search is on. Run it after changing `JINA_EMBED_DIM` or `LUCY_INDEX_DIRS`, after a large import, or if search looks wrong. Deleting `.index/memory.db` is also safe: it is recreated on the next start. Note that stored conversation turns live in that file too, so deleting it loses them.

## Backing up the vault as its own git repo

Keep the vault in its own **private** repository, separate from the Lucy code:

```bash
cd ~/lucy/lucy-vault
git init -b main
cat > .gitignore <<'EOF'
.index/
.snapshots/
.trash/
*.tmp
EOF
git add -A && git commit -m "vault: initial import"
git remote add origin <your-private-repo-url>
git push -u origin main
```

Then commit on a schedule, for example after the nightly dream:

```bash
# crontab: 03:00, after cron_dream.sh
0 3 * * * cd /path/to/lucy-vault && git add -A && (git diff --cached --quiet || git commit -qm "vault $(date +\%F)") && git push -q
```

`tools/vault-backup.sh` in the repo is a reference script that does this through `rsync` into a separate checkout. It refuses to run if the vault looks empty (fewer than 1000 files) and defaults to `DRY=1`. Its paths and repository name are hard-coded, so edit them before you use it.

::: warning
The vault contains personal data and full conversation history (`memory.db`). Keep the backup repository private, and never commit `.env*` files into it.
:::

## Command reference

Run these from `agent-machine/` with `LUCY_VAULT` pointing at your vault. If unset, they default to `../lucy-vault`.

| Command | What it does |
|---|---|
| `npm run reindex` | Full rebuild of the index, plus embeddings if vector search is on |
| `npm run recall -- "query"` | Incremental reindex, then search (hybrid when vector search is on) |
| `npm run recall -- --recent 7d` | Notes changed in the last 7 days (`h`/`d`/`w`/`m`) |
| `npm run recall -- --embed` | Only embed notes that are missing vectors |
| `npm run recall -- stats` | One-line learning heartbeat |
| `npm run dream` | Process signals into preferences, rebuild `active.md`, condense agent lessons; consolidation if `LUCY_CONSOLIDATE=1` |
| `npm run consolidate` | Fact consolidation of `Brain/claude-memory` (dry run; add `LUCY_CONSOLIDATE_APPLY=1` to write) |
| `npm run bootstrap` | One-off: extract behaviour rules from `Brain/claude-memory` into signals (uses the `claude` CLI), then dream |
| `npm run smoke:memory-all` | Memory test suite (no network) |

The coordinator exposes the same operations over HTTP for the hub: `POST /brain/reindex`, `POST /brain/dream`, `POST /brain/evidence`, `POST /brain/pin`, `GET /brain/state`, `GET /recall?q=…`. All routes except `/health` need the `x-worker-token` header.
