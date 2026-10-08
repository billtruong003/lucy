#!/usr/bin/env python3
"""PHASE 2 — Chạy bộ kịch bản chất-lượng-ngữ-cảnh qua ĐÚNG đường production của bridge.

Cách chạy:
    python3 qa_harness.py                  # chạy hết, ghi kết quả JSON
    python3 qa_harness.py A1 B3            # chỉ chạy scenario chỉ định
    python3 qa_harness.py --cat A,B        # chỉ chạy theo nhóm
    LUCY_QA_OUT=/path/x.json python3 qa_harness.py

An toàn: KHÔNG gửi Telegram (mock send/edit), KHÔNG ghi episodic (tránh bẩn memory.db),
KHÔNG ghi file session production. Mỗi scenario dùng chat_id riêng + đóng client sau khi xong.
"""
import json
import os
import re
import sys
import time
import threading
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "qa:token")
import lucy_bridge as lb          # noqa: E402
from qa_scenarios import SCENARIOS  # noqa: E402
from qa_policy import DIMENSIONS, countable_tools, policy_for  # noqa: E402

# PHASE 2.1: phát hiện Lucy có GHI trí nhớ bền trong lúc test hay không (bắt ca "giả định → note thật").
VAULT_MEM = os.path.expanduser("~/lucy/lucy-vault/Brain/claude-memory")


def _vault_fingerprint():
    """Dấu vân tay thư mục trí nhớ: {tên file: (kích thước, mtime)}. Rẻ, không đọc nội dung."""
    out = {}
    try:
        for n in os.listdir(VAULT_MEM):
            p = os.path.join(VAULT_MEM, n)
            if os.path.isfile(p):
                st = os.stat(p)
                out[n] = (st.st_size, int(st.st_mtime))
    except Exception:
        pass
    return out

OUT = os.environ.get("LUCY_QA_OUT", "/root/lucy/.state/qa-results.json")
LABEL = os.environ.get("LUCY_QA_LABEL", "run")

# ── Cô lập khỏi production ──
lb.EPISODIC = False                       # không ghi turn test vào memory.db
lb._save = lambda *a, **k: None           # không đụng ~/.lucy-bridge-sessions.json
lb._save_claude_hist = lambda *a, **k: None
lb._save_prefs = lambda *a, **k: None

CAP = {}          # chat_id -> list text gửi qua send/reply
EDITS = {}        # chat_id -> list text edit (claude-path chốt câu trả lời bằng edit cuối cùng)


def _cap(cid, text):
    CAP.setdefault(str(cid), []).append(str(text or ""))


def _cap_edit(cid, mid, text):
    EDITS.setdefault(str(cid), []).append(str(text or ""))


lb.send = lambda cid, text: _cap(cid, text)
lb.reply = lambda cid, text: _cap(cid, text)
lb.send_document = lambda *a, **k: None
lb.send_kb = lambda *a, **k: None
lb.send_id = lambda cid, text: 1
lb.edit = _cap_edit


def _fold(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _hit(pattern, text):
    """Khớp regex trên text đã bỏ dấu + text gốc (chủ nhân gõ có dấu lẫn không dấu)."""
    try:
        return bool(re.search(pattern, text, re.I)) or bool(re.search(_fold(pattern), _fold(text), re.I))
    except re.error:
        return pattern.lower() in text.lower()


# Dấu hiệu PHỦ ĐỊNH đứng ngay trước từ bị cấm → nhắc để LOẠI TRỪ, không phải để theo.
_NEG_BEFORE = re.compile(
    r"(khong phai|ko phai|chu khong|chu ko|thay vi|thay cho|loai bo|khong con|ko con|khac voi|so voi|"
    r"\bkhong\b|\bko\b|\bchang\b|\bbo\b|\bdung\b|\bhon\b|\bthay\b)\s*$", re.I)


def _forbidden_hit(pattern, text):
    """Như _hit nhưng BỎ QUA lần xuất hiện nằm trong ngữ cảnh phủ định.

    Bug đo lường 2026-08-16: Lucy trả lời ĐÚNG "systemd chứ không phải pm2" nhưng bộ chấm bắt chữ
    'pm2' rồi kết luận rò ngữ cảnh. Ba trong bốn ca 'trượt ổn định' đều do bẫy này, không phải Lucy sai.
    """
    ft = _fold(text)
    for pat in (pattern, _fold(pattern)):
        try:
            for m in re.finditer(pat, ft if pat != pattern else text, re.I):
                head = (ft if pat != pattern else _fold(text))[max(0, m.start() - 28):m.start()]
                if not _NEG_BEFORE.search(head):
                    return True          # xuất hiện KHÔNG bị phủ định → đúng là rò
        except re.error:
            if pattern.lower() in text.lower():
                return True
    return False


def run_turn(chat_id, say, sessions):
    """1 lượt qua handle() thật. Câu trả lời = edit CUỐI (claude-path chốt bằng edit) + mọi send/reply."""
    CAP[str(chat_id)] = []
    EDITS[str(chat_id)] = []
    t0 = time.time()
    lb.handle({"chat": {"id": chat_id}, "from": {"id": int(lb.ALLOWED or 1)}, "text": say}, sessions)
    wall = time.time() - t0
    parts = []
    ed = EDITS.get(str(chat_id)) or []
    if ed:
        parts.append(ed[-1])
    parts.extend(CAP.get(str(chat_id), []))
    return "\n".join(p for p in parts if p), wall, lb.trace_get(chat_id)


def score_turn(turn, answer, trace, pol, wrote_durable=False):
    """PHASE 2.1 — chấm theo 9 CHIỀU, trả (errs, warns, dims, status).

    Khác Phase 2: đúng nội dung KHÔNG còn đủ để PASS. Một lượt tán gẫu mà gọi 6 tool
    trong 94 giây thì là FAIL, dù câu trả lời đúng (ca A4 thật của Phase 2)."""
    errs, warns = [], []
    dims = {d: True for d in DIMENSIONS}
    mem_tok = int(trace.get("mem_tok") or 0)
    tools = trace.get("tools") or []
    ttft = float(trace.get("ttft") or 0)

    # ── ngữ nghĩa ──
    ea = turn.get("expect_any")
    if ea and not any(_hit(p, answer) for p in ea):
        errs.append(f"intent: thiếu {ea}"); dims["intent_correct"] = False
    for p in turn.get("expect_all", []) or []:
        if not _hit(p, answer):
            errs.append(f"intent: thiếu '{p}'"); dims["intent_correct"] = False
    # expect_ref: tham chiếu ("cái đó", "option 2") PHẢI trỏ đúng — chiều riêng, nặng hơn intent
    er = turn.get("expect_ref")
    if er and not any(_hit(p, answer) for p in er):
        errs.append(f"reference: không trỏ đúng {er}"); dims["reference_resolved"] = False
    for p in turn.get("forbid", []) or []:
        if _forbidden_hit(p, answer):   # bỏ qua lần xuất hiện trong câu PHỦ ĐỊNH ("systemd chứ không phải pm2")
            errs.append(f"context-leak: xuất hiện '{p}'"); dims["no_context_leak"] = False
    # stale_override: memory/ý cũ đè lệnh đang nói
    for p in turn.get("forbid_stale", []) or []:
        if _forbidden_hit(p, answer):
            errs.append(f"stale-override: theo ý cũ '{p}' thay vì lệnh hiện tại")
            dims["current_instruction_respected"] = False
    if turn.get("must_ask") and "?" not in answer:
        errs.append("scope: mơ hồ nhưng không hỏi lại"); dims["scope_respected"] = False

    # ── trí nhớ ──
    if turn.get("no_recall") and mem_tok > 0:
        errs.append(f"memory-noise: chèn {mem_tok} tok trí nhớ dù không cần"); dims["memory_relevance"] = False
    if turn.get("want_recall") and mem_tok == 0:
        errs.append("memory-miss: cần trí nhớ nhưng không chèn"); dims["memory_relevance"] = False
    for note in turn.get("forbid_notes", []) or []:
        if any(note.lower() in t.lower() for t in (trace.get("mem_titles") or [])):
            errs.append(f"memory-noise: chèn note cấm '{note}'"); dims["memory_relevance"] = False

    # ── ghi trí nhớ bền ──
    if turn.get("no_durable_write") and wrote_durable:
        errs.append("durable-write: biến nội dung giả định/test thành trí nhớ bền")
        dims["durable_write_safe"] = False
    if turn.get("want_durable_write") and not wrote_durable:
        warns.append("durable-write: đáng lẽ nên ghi nhớ mà không ghi")

    # ── tool ── (AskUserQuestion không tính: hỏi lại là hành vi hội thoại, không phải soi hệ thống)
    counted = countable_tools(tools)
    n = len(counted)
    if turn.get("want_tools") and n == 0:
        errs.append("tool-miss: cần tool nhưng không gọi"); dims["tool_policy_correct"] = False
    elif n > pol["max_tools"]:
        msg = f"tool-overreach[{pol['mode']}]: {n} tool (trần {pol['max_tools']}) {counted[:6]}"
        errs.append(msg); dims["tool_policy_correct"] = False
    elif n > pol["warn_tools"]:
        warns.append(f"tool: {n} tool (mức cảnh báo {pol['warn_tools']})")
    if pol["hard_no_tools"] and n:
        errs.append(f"tool-negation: chủ nhân CẤM dùng tool mà vẫn gọi {counted}")
        dims["tool_policy_correct"] = False

    # ── độ trễ ──
    if ttft > pol["ttft_fail"]:
        errs.append(f"latency: TTFT {ttft:.0f}s > trần {pol['ttft_fail']}s"); dims["latency_acceptable"] = False
    elif ttft > pol["ttft_warn"]:
        warns.append(f"latency: TTFT {ttft:.0f}s > {pol['ttft_warn']}s")

    status = "FAIL" if errs else ("WARN" if warns else "PASS")
    return errs, warns, dims, status


def run_scenario(sc):
    cid = -970000 - abs(hash(sc["id"])) % 90000
    sessions = {}
    res = {"id": sc["id"], "cat": sc["cat"], "desc": sc["desc"], "turns": [], "pass": True}
    try:
        for i, turn in enumerate(sc["turns"]):
            interrupt_this = sc.get("interrupt") and i == 0
            if interrupt_this:
                # Lượt dài chạy nền → gửi tin đè giữa chừng (mô phỏng chủ nhân nhắn cắt lời)
                box = {}
                th = threading.Thread(target=lambda: box.update(zip(("a", "w", "t"), run_turn(cid, turn["say"], sessions))), daemon=True)
                th.start()
                time.sleep(6)
                cut = lb.interrupt_chat(cid)
                th.join(timeout=120)
                res["turns"].append({"say": turn["say"][:60], "errs": [], "interrupted": bool(cut),
                                     "wall": round(box.get("w", 0), 2), "answer_chars": len(box.get("a", ""))})
                if not cut:
                    res["pass"] = False
                    res["turns"][-1]["errs"] = ["interrupt: không ngắt được lượt đang chạy"]
                continue
            fp_before = _vault_fingerprint()
            answer, wall, trace = run_turn(cid, turn["say"], sessions)
            fp_after = _vault_fingerprint()
            wrote = fp_before != fp_after
            if wrote:
                res.setdefault("vault_writes", []).append(
                    sorted(set(fp_after) - set(fp_before)) or ["(sửa file có sẵn)"])
            # nhóm R: ép xoay vòng phiên ngay sau lượt này → lượt sau phải sống nhờ nối mạch
            rotated = False
            if sc.get("rotate_after") == i:
                rotated = lb.force_rotate(cid)
            pol = policy_for(sc, turn)
            errs, warns, dims, status = score_turn(turn, answer, trace, pol, wrote_durable=wrote)
            if sc.get("rotate_after") == i and not rotated:
                warns.append("rotate: không ép xoay vòng được")
            if status == "FAIL":
                res["pass"] = False
                res["status"] = "FAIL"
            elif status == "WARN" and res.get("status") != "FAIL":
                res["status"] = "WARN"
            res["turns"].append({
                "say": turn["say"][:60], "mode": pol["mode"], "status": status,
                "errs": errs, "warns": warns, "dims": dims, "wall": round(wall, 2),
                "ttft": round(float(trace.get("ttft") or 0), 2), "mem_tok": trace.get("mem_tok") or 0,
                "mem_titles": (trace.get("mem_titles") or [])[:3], "recall_skip": trace.get("recall_skip") or "",
                "tools": trace.get("tools") or [], "vault_wrote": wrote, "answer": answer[:400],
            })
    except Exception as e:
        res["pass"] = False
        res["status"] = "FAIL"
        res["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        lb._ps_close(cid)
    res.setdefault("status", "PASS")
    return res


def _save_partial(results, t0):
    """Ghi kết quả TĂNG DẦN sau mỗi scenario → chạy đứt giữa chừng vẫn resume được (đã học bài 2026-08-16)."""
    try:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT + ".partial", "w", encoding="utf-8") as f:
            json.dump({"label": LABEL, "ts": time.time(), "elapsed_s": round(time.time() - t0, 1),
                       "results": results}, f, ensure_ascii=False)
    except Exception:
        pass


def _load_partial():
    """Đọc kết quả dở (nếu có) để bỏ qua scenario đã chạy. Xoá file .partial = chạy lại từ đầu."""
    try:
        with open(OUT + ".partial", encoding="utf-8") as f:
            d = json.load(f)
        if d.get("label") == LABEL:
            return d.get("results") or []
    except Exception:
        pass
    return []


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cats = None
    for a in sys.argv[1:]:
        if a.startswith("--cat"):
            cats = set(a.split("=", 1)[1].split(",")) if "=" in a else None
    todo = [s for s in SCENARIOS
            if (not args or s["id"] in args) and (not cats or s["cat"] in cats)]
    results = _load_partial()
    done_ids = {r["id"] for r in results}
    if done_ids:
        print(f"↻ resume: bỏ qua {len(done_ids)} scenario đã chạy", flush=True)
        todo = [s for s in todo if s["id"] not in done_ids]
    print(f"QA harness · {len(todo)} scenario cần chạy · engine={lb._ENGINE} · label={LABEL}\n", flush=True)
    t0 = time.time()
    for i, sc in enumerate(todo, 1):
        r = run_scenario(sc)
        results.append(r)
        _save_partial(results, t0)
        mark = {"PASS": "✓", "WARN": "▲", "FAIL": "✗"}[r["status"]]
        print(f"[{i}/{len(todo)}] {mark} {r['id']} ({r['cat']}) {r['desc'][:46]}", flush=True)
        for t in r["turns"]:
            for e in t.get("errs", []):
                print(f"        ✗ {e}", flush=True)
            for w in t.get("warns", []):
                print(f"        ▲ {w}", flush=True)
        if r.get("error"):
            print(f"        !! {r['error']}", flush=True)

    # ── tổng hợp: NGỮ NGHĨA và TRẢI NGHIỆM tách riêng (mission §4) ──
    bycat = {}
    for r in results:
        c = bycat.setdefault(r["cat"], {"pass": 0, "warn": 0, "fail": 0, "total": 0})
        c["total"] += 1
        c[r["status"].lower()] += 1
    all_turns = [t for r in results for t in r["turns"] if "dims" in t]
    talk = [t for t in all_turns if t.get("mode") == "talk"]

    def dim_ok(name, turns=None):
        return sum(1 for t in (turns if turns is not None else all_turns) if t["dims"].get(name))

    ttft_talk = sorted(t["ttft"] for t in talk if t.get("ttft"))
    agg = {
        # ngữ nghĩa: đúng nội dung (bỏ qua tool/độ trễ) — so được với điểm Phase 2
        "scenarios_semantic_ok": sum(1 for r in results if not any(
            (not t["dims"].get("intent_correct")) or (not t["dims"].get("reference_resolved"))
            or (not t["dims"].get("no_context_leak")) or (not t["dims"].get("current_instruction_respected"))
            for t in r["turns"] if "dims" in t) and not r.get("error")),
        # trải nghiệm: PASS thật (không FAIL, không WARN)
        "scenarios_ux_healthy": sum(1 for r in results if r["status"] == "PASS"),
        "scenarios_warn": sum(1 for r in results if r["status"] == "WARN"),
        "scenarios_fail": sum(1 for r in results if r["status"] == "FAIL"),
        "scenarios_total": len(results),
        "turns_total": len(all_turns),
        "talk_turns": len(talk),
        **{f"dim_{d}": dim_ok(d) for d in DIMENSIONS},
        "talk_turns_with_tools": sum(1 for t in talk if countable_tools(t.get("tools"))),
        "turns_over_3_tools": sum(1 for t in all_turns if len(countable_tools(t.get("tools"))) > 3),
        "irrelevant_memory": sum(1 for t in all_turns if not t["dims"].get("memory_relevance")),
        "stale_over_current": sum(1 for t in all_turns if not t["dims"].get("current_instruction_respected")),
        "wrong_reference": sum(1 for t in all_turns if not t["dims"].get("reference_resolved")),
        "context_leak": sum(1 for t in all_turns if not t["dims"].get("no_context_leak")),
        "durable_write_violations": sum(1 for t in all_turns if not t["dims"].get("durable_write_safe")),
        "talk_ttft": ttft_talk,
        "talk_ttft_over15": sum(1 for v in ttft_talk if v > 15),
        "talk_ttft_over30": sum(1 for v in ttft_talk if v > 30),
        "talk_tools_list": sorted(len(countable_tools(t.get("tools"))) for t in talk),
        "ttft_list": sorted(t["ttft"] for t in all_turns if t.get("ttft")),
        "wall_list": sorted(t["wall"] for t in all_turns if t.get("wall")),
        "elapsed_s": round(time.time() - t0, 1),
    }

    def pct(v, n):
        return f"{v}/{n}" + (f" ({100*v//n}%)" if n else "")

    def q(lst, p):
        return round(lst[min(len(lst) - 1, int(len(lst) * p))], 2) if lst else 0

    print("\n" + "=" * 60)
    print(f"NGỮ NGHĨA đúng:      {pct(agg['scenarios_semantic_ok'], agg['scenarios_total'])}")
    print(f"TRẢI NGHIỆM tốt:     {pct(agg['scenarios_ux_healthy'], agg['scenarios_total'])}"
          f"   (WARN {agg['scenarios_warn']} · FAIL {agg['scenarios_fail']})")
    print("Theo nhóm (pass/warn/fail): " + " · ".join(
        f"{k}={v['pass']}/{v['warn']}/{v['fail']}" for k, v in sorted(bycat.items())))
    print("-" * 60)
    for d in DIMENSIONS:
        print(f"  {d:32} {pct(agg['dim_' + d], agg['turns_total'])}")
    print("-" * 60)
    print(f"Lượt TÁN GẪU có dùng tool:  {agg['talk_turns_with_tools']}/{agg['talk_turns']}")
    print(f"Lượt gọi >3 tool:           {agg['turns_over_3_tools']}")
    print(f"Chèn trí nhớ thừa:          {agg['irrelevant_memory']}")
    print(f"Ý cũ đè lệnh hiện tại:      {agg['stale_over_current']}")
    print(f"Trỏ sai tham chiếu:         {agg['wrong_reference']}")
    print(f"Ghi trí nhớ bền sai:        {agg['durable_write_violations']}")
    print(f"TÁN GẪU TTFT: median={q(ttft_talk,.5)}s p90={q(ttft_talk,.9)}s p95={q(ttft_talk,.95)}s"
          f" · >15s: {agg['talk_ttft_over15']} · >30s: {agg['talk_ttft_over30']}")
    print(f"TÁN GẪU số tool: median={q(agg['talk_tools_list'],.5)} p95={q(agg['talk_tools_list'],.95)}")
    print(f"TẤT CẢ TTFT: median={q(agg['ttft_list'],.5)}s p90={q(agg['ttft_list'],.9)}s")
    print(f"Tổng thời gian: {agg['elapsed_s']}s")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"label": LABEL, "ts": time.time(), "agg": agg, "bycat": bycat, "results": results}, f,
                  ensure_ascii=False, indent=1)
    print(f"→ ghi {OUT}")


if __name__ == "__main__":
    main()
