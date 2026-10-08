#!/usr/bin/env python3
"""PHASE 2.1 P0 — TRUY NGUỒN "NGỮ CẢNH MA".

Triệu chứng: Lucy trả lời như thể trong context có ẢNH chứa chữ giống system prompt
("SESSION CONFIGURATION PAGES", "system-reminder"…) dù tin nhắn vào KHÔNG hề có ảnh.

Ba chế độ clean-room (mission §6):
  A — client mới, KHÔNG resume, KHÔNG recall, CHỈ persona  → nếu ma xuất hiện: phía Claude Code/hệ thống
  B — client mới, persona + recall bình thường             → nếu chỉ ở B: do khối trí nhớ chèn vào
  C — đường production đầy đủ (qua handle())               → nếu chỉ ở C: do bridge/seed/mạch gần

Mỗi chế độ ghi lại METADATA (không in nội dung nhạy cảm): session id, kích thước system append,
danh mục context từ SDK, tool đã gọi, khối trí nhớ.
"""
import asyncio
import hashlib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "qa:token")
import lucy_bridge as lb  # noqa: E402

OUT = os.environ.get("LUCY_QA_OUT", "/root/lucy/.state/qa-phantom.json")

# Dấu hiệu "ma" — nếu câu trả lời nhắc tới những thứ này mà đầu vào không có thì là ngữ cảnh lạ.
PHANTOM = re.compile(
    r"(system.?reminder|SESSION CONFIGURATION|tấm ảnh|bức ảnh|hình ảnh.*prompt|ảnh.*system|"
    r"screenshot|ascii|<antml|</?system>|prompt injection|chèn lệnh)", re.I)

PROBES = [
    "Bug recall nằm đâu đó trong bridge.",
    "chào em, hôm nay thế nào?",
    "trong ngữ cảnh của em lúc này có những phần nào? kể ngắn, đừng chạy tool",
]

CAP, EDITS = {}, {}
lb.EPISODIC = False
lb._save = lambda *a, **k: None
lb._save_claude_hist = lambda *a, **k: None
lb._save_prefs = lambda *a, **k: None
lb.send = lambda cid, t: CAP.setdefault(str(cid), []).append(str(t or ""))
lb.reply = lb.send
lb.send_id = lambda cid, t: 1
lb.edit = lambda cid, mid, t: EDITS.setdefault(str(cid), []).append(str(t or ""))
lb.send_document = lambda *a, **k: None


def _sha(s):
    return hashlib.sha256((s or "").encode()).hexdigest()[:12]


async def _raw_probe(prompt, with_persona=True):
    """MODE A: gọi SDK trực tiếp, client mới, không resume, không recall. Trả (text, meta)."""
    from claude_agent_sdk import ClaudeSDKClient
    persona = lb._persona_append(None) if with_persona else ""
    opts = lb._SdkOpts(
        model="claude-sonnet-5", permission_mode="bypassPermissions", cwd=lb.WORKDIR,
        system_prompt={"type": "preset", "preset": "claude_code", "append": persona},
        add_dirs=[lb.VAULT] if os.path.isdir(lb.VAULT) else [],
        env=lb._direct_claude_env(), include_partial_messages=False,
        strict_mcp_config=True, mcp_servers={},
    )
    text, tools, sid = [], [], None
    async with ClaudeSDKClient(options=opts) as c:
        await c.query(prompt)
        async for m in c.receive_response():
            cn = type(m).__name__
            if cn == "AssistantMessage":
                for b in (m.content or []):
                    tb = type(b).__name__
                    if tb == "TextBlock":
                        text.append(getattr(b, "text", ""))
                    elif tb in ("ToolUseBlock", "ServerToolUseBlock"):
                        tools.append(getattr(b, "name", "?"))
            elif cn == "ResultMessage":
                sid = m.session_id
        try:
            usage = await c.get_context_usage()
        except Exception as e:
            usage = {"err": f"{type(e).__name__}"}
    meta = {
        "session_id": (sid or "")[:8], "resumed": False,
        "persona_chars": len(persona), "persona_sha": _sha(persona),
        "tools": tools,
        "ctx_total": usage.get("totalTokens"), "ctx_pct": usage.get("percentage"),
        "ctx_categories": [(c.get("name"), c.get("tokens")) for c in (usage.get("categories") or [])],
        "memory_files": [m.get("path", m) if isinstance(m, dict) else m
                         for m in (usage.get("memoryFiles") or [])][:8],
    }
    return "".join(text), meta


def mode_a(prompt, with_persona=True):
    return lb._submit(_raw_probe(prompt, with_persona), 300)


def mode_c(prompt, cid):
    CAP[str(cid)] = []; EDITS[str(cid)] = []
    lb.handle({"chat": {"id": cid}, "from": {"id": int(lb.ALLOWED or 1)}, "text": prompt}, {})
    ed = EDITS.get(str(cid)) or []
    ans = "\n".join(([ed[-1]] if ed else []) + CAP.get(str(cid), []))
    tr = lb.trace_get(cid)
    h = lb.session_health(cid)
    return ans, {"session_id": (h.get("sid") or ""), "tools": tr.get("tools") or [],
                 "mem_tok": tr.get("mem_tok"), "mem_titles": tr.get("mem_titles"),
                 "recall_skip": tr.get("recall_skip"), "persona_chars": tr.get("persona_tok", 0) * 3,
                 "ctx_total": h.get("ctx_tokens"), "ctx_pct": h.get("ctx_pct"),
                 "ctx_categories": h.get("ctx_categories")}


def main():
    rows = []
    print(f"cwd của Lucy: {lb.WORKDIR}")
    try:
        files = sorted(os.listdir(lb.WORKDIR))
        imgs = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))]
        print(f"  file trong cwd: {len(files)} · trong đó ẢNH: {len(imgs)}")
        if imgs:
            print(f"  ví dụ ảnh: {imgs[:5]}")
        mds = [f for f in files if f.lower().endswith(".md")][:8]
        print(f"  file .md trong cwd: {len(mds)} {mds}")
    except Exception as e:
        print("  không đọc được cwd:", e)
    print()

    for i, p in enumerate(PROBES):
        # MODE A — chỉ persona
        try:
            a_txt, a_meta = mode_a(p, with_persona=True)
        except Exception as e:
            a_txt, a_meta = f"ERR {type(e).__name__}: {e}", {}
        # MODE A0 — KHÔNG persona (tách ảnh hưởng của persona)
        try:
            a0_txt, a0_meta = mode_a(p, with_persona=False)
        except Exception as e:
            a0_txt, a0_meta = f"ERR {type(e).__name__}: {e}", {}
        # MODE C — production
        cid = -940000 - i
        try:
            c_txt, c_meta = mode_c(p, cid)
        finally:
            lb._ps_close(cid)

        row = {"probe": p}
        for tag, txt, meta in (("A0_khong_persona", a0_txt, a0_meta),
                               ("A_persona", a_txt, a_meta),
                               ("C_production", c_txt, c_meta)):
            hit = PHANTOM.findall(txt or "")
            row[tag] = {"phantom": bool(hit), "dau_hieu": sorted({h.lower() for h in hit})[:6],
                        "answer_head": (txt or "")[:220], "meta": meta}
            print(f"[{tag}] ma={'CÓ' if hit else 'không'} {sorted({h.lower() for h in hit})[:4]}")
            print(f"    {p[:48]!r} → {(txt or '')[:130]!r}")
        rows.append(row)
        print("-" * 70, flush=True)

    json.dump({"ts": time.time(), "rows": rows}, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"→ ghi {OUT}")
    a0 = sum(1 for r in rows if r["A0_khong_persona"]["phantom"])
    a = sum(1 for r in rows if r["A_persona"]["phantom"])
    c = sum(1 for r in rows if r["C_production"]["phantom"])
    print(f"\nTỔNG: ma xuất hiện — A0(không persona)={a0}/{len(rows)} · A(persona)={a}/{len(rows)} · C(production)={c}/{len(rows)}")


if __name__ == "__main__":
    main()
