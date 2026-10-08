# LUCY — Skills

Thư viện **skill domain** (procedure agent load khi cần) — KHÁC với **agent/persona** (`agent-machine/config/personas/`, ai làm việc). Agent = người làm; skill = bí kíp họ tra.

## Nguồn
170 skill migrate từ **Hermes Agent** (NousResearch, MIT) — `references/hermes-agent/{skills,optional-skills}`. Giữ nguyên frontmatter + attribution (MIT, author).

## Cấu trúc
```
skills/
├── bundled/<category>/<name>/SKILL.md   # 75 — core, "luôn sẵn" (tier mặc định Hermes)
├── optional/<category>/<name>/SKILL.md  # 95 — opt-in theo dự án
├── INDEX.md                              # bảng tra name+description (tự sinh)
└── README.md
```
`INDEX.md` tự sinh — cập nhật: tải lại `gen-skill-index.mjs` (đã xoá sau khi chạy) hoặc viết lại. 🎯 = core hợp Lucy · 📦 = niche (mlops/finance/apple/blockchain… — prune `rm -rf` được nếu chật).

## Format (agentskills.io) — chuẩn cho skill-loop M3
SKILL.md = frontmatter (`name` · `description` "Use when…" ≤1024 ký tự · `version`/`author`/`license` · `metadata.hermes.{tags,related_skills}`) → body `# Title → ## Overview → ## When to Use → <thân> → ## Common Pitfalls → ## Verification Checklist`. 8-15k ký tự/skill.

## Lucy dùng thế nào (kế hoạch M3)
**Progressive disclosure** (giữ token thấp): loader chỉ nạp `name+description` từ INDEX vào context; khi 1 card MATCH trigger → load full SKILL.md đúng cái đó vào prompt của agent. Não không phình vì có 170 skill — chỉ cái liên quan mới vào.

⚠️ **Cần adapt:** skill Hermes tham chiếu tool runtime của Hermes (`skill_manage`, `delegate_task`, `~/.hermes/...`). Khi M3 wire loader, map sang tool Lucy (`claude -p` + card-engine) — coi đây là **kho tri thức/quy trình**, không phải chạy thẳng.

## Skill đáng dùng ngay (software-development)
`plan` · `systematic-debugging` (4-phase root-cause) · `test-driven-development` (RED-GREEN-REFACTOR) · `requesting-code-review` · `simplify-code` · `subagent-driven-development` (2-stage review — đã áp vào pipeline `feature`) · `spike`.
