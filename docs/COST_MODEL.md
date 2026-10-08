# LUCY — Cost Model / Bài toán token (Claude vs free)

> **Viết 2026-06-09.** Trả lời lo lắng của Bill: "API Claude 1M token siêu đắt, subscription thì
> không cho dùng extra cho `claude -p` — phải có bài toán." Neo: [ROADMAP_TO_PEAK.md](_outdated/ROADMAP_TO_PEAK.md)
> §4, [RESEARCH_HERMES_OMNIROUTE_2026.md](_outdated/RESEARCH_HERMES_OMNIROUTE_2026.md). Giá verify từ claude-api skill (cache 2026-05-26).

---

## 0. Câu chốt

**Đừng để cỗ máy content (60 bài/ngày) chạm vào Claude.** Claude chỉ dùng cho **não** (code thật,
orchestration) — volume nhỏ, value cao. Bulk (content/Aki/narration/classify) chạy **free-tier qua
OmniRoute** = ~$0. Với cách chia này, cả đế chế chạy ~**$100–300/tháng**, không phải nghìn đô.

---

## 1. Giá Claude API (per 1M token) — verify

| Model | Input | Output | Cache READ (0.1×) | Cache WRITE 5ph (1.25×) | Batch (−50%) |
|---|---|---|---|---|---|
| **Opus 4.8** | $5 | $25 | **$0.50** | $6.25 | input $2.5 / output $12.5 |
| **Sonnet 4.6** | $3 | $15 | **$0.30** | $3.75 | input $1.5 / output $7.5 |
| **Haiku 4.5** | $1 | $5 | **$0.10** | $1.25 | input $0.5 / output $2.5 |

**3 đòn bẩy hạ giá Claude khi buộc phải dùng:**
1. **Prompt cache**: đọc lại context = **0.1× giá** (Opus context lặp lại $0.50 thay vì $5/1M) → agentic coding tiết kiệm 5–10× thực tế.
2. **opus/sonnet split** (m đã ship): code=opus, check=sonnet → phần lớn token ở $3/$15 không $5/$25.
3. **`--resume` session-cache** (m đã ship): agent khỏi quét lại project → ít input token.
4. **Batch API −50%** cho việc không cần real-time.

---

## 2. Vì sao content KHÔNG được chạy trên Claude (con số)

Cỗ máy content peak: **60 bài/ngày × 5 stage × ~6k token (4k in + 2k out)** ≈ **1.8M token/ngày**.

| Chạy trên | Chi phí/ngày | Chi phí/tháng |
|---|---|---|
| **Opus 4.8** | ~$25–35 | **~$800–1000** 💸 |
| **Sonnet 4.6** | ~$13 | **~$380** 💸 |
| **Free-tier (Groq Llama 3.3 / Gemini / Cerebras) qua OmniRoute** | **~$0** | **~$0** ✅ |

OmniRoute gom **~1.9B free token/tháng** (Groq 7k req/ngày, Gemini free, Cerebras, NVIDIA NIM…) → cỗ
máy content **vừa khít free quota**, fallback 4 tầng khi 1 nguồn cạn. **→ Đây là chỗ tiết kiệm
$380–1000/tháng. Bắt buộc free, không Claude.**

Chất lượng draft của Llama 3.3 70B đủ tốt cho bài tutorial (có editor-gate + fact-check stage lọc).

---

## 3. claude -p (não) — subscription vs API, và "bài toán extra"

### 3.1. Vấn đề Bill nêu (đúng)
- **API pay-go**: không giới hạn nhưng **đắt theo token** — không hợp chạy nhiều.
- **Subscription (Claude Max $100/$200)**: rẻ-phẳng cho **dùng tương tác**, NHƯNG:
  - ⚠️ **Từ 15/6/2026** (còn ~6 ngày), `claude -p` + Agent SDK trên subscription **rút từ pool
    "Agent SDK credit" RIÊNG**, tách khỏi hạn mức chat tương tác. Tức **không thể xài `claude -p`
    vô hạn** bằng gói subscription — hết credit Agent SDK thì phải chờ reset hoặc trả API overage.
  - Trỏ proxy (OmniRoute) làm **hỏng đăng nhập OAuth subscription** → mất luôn giá phẳng.

### 3.2. Bài toán: phân tầng theo AI làm việc gì

```
┌─ TẦNG 0 — FREE qua OmniRoute (90%+ volume token) ──────────────── ~$0 ─┐
│  content fleet · Aki chat · narration · classify · fact-check · embed  │
│  → Groq Llama 3.3 / Gemini / Cerebras free. Đây là CỖ MÁY TIỀN.        │
├─ TẦNG 1 — Claude SUBSCRIPTION (Max $100–200, pool Agent SDK) ──────────┤
│  claude -p code/orchestration THẬT — vài chục task/ngày value cao.     │
│  Đi THẲNG Anthropic (giữ OAuth). Token rẻ nhờ cache + opus/sonnet.     │
├─ TẦNG 2 — Claude API pay-go (chỉ tràn) ───────────── budget cap $/ngày ┤
│  Chỉ khi pool Agent SDK cạn VÀ task buộc phải Claude. cost-ledger gác. │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.3. claude -p tốn bao nhiêu thật (có cache)
1 phiên code điển hình: context (system + repo) ~50k token, ~20 lượt.
- **Không cache:** 20 × 50k = 1M input → **$5** (Opus) chỉ để đọc lại context mỗi lượt.
- **Có cache:** ghi 1 lần (~$0.31) + 19 lần đọc 0.1× (~$0.95) ≈ **~$1.3** cho cùng context → **rẻ ~4×**.
- Cộng output thực + opus/sonnet split → 1 phiên dev nặng thường **$1–4 thực**, không phải chục đô.

**Volume não thực tế:** ~10–30 task code/ngày. Phần lớn nằm trong pool Agent SDK của Max. Tràn thì
Tầng 2 vài $/ngày. → **Max $100–200/tháng + overflow $0–100 + content $0 ≈ $100–300/tháng tổng.**

---

## 4. Tổng chi phí vận hành peak (ước lượng)

| Khoản | /tháng |
|---|---|
| Content fleet (free-tier qua OmniRoute) | ~$0 |
| Claude Max subscription (`claude -p` não) | $100–200 |
| API overflow Tầng 2 (cap bằng cost-ledger) | $0–100 |
| VPS Vietnix + (có thể) box relay | ~$10–30 |
| Visual gen (Flux Schnell ~$0.003/ảnh × 60/ngày) | ~$5 |
| **TỔNG** | **~$120–340/tháng** |

So với nỗi sợ "nghìn đô": **rẻ hơn 3–8×** chỉ nhờ **chia tầng + free content + cache**.

---

## 5. Việc phải làm để bài toán này thành thật

1. **Sprint 1 (OmniRoute):** route content+Aki qua free-tier → khoá Tầng 0 = $0. (Đòn lớn nhất.)
2. **Sprint 3 (cost-ledger):** gác Tầng 2 — cap $/ngày, tự dừng khi chạm; đo pool Agent SDK còn bao nhiêu.
3. **Giữ `claude -p` THẲNG Anthropic** trên Max subscription (đừng proxy → giữ OAuth phẳng).
4. **Tối ưu cache cho claude -p:** system/persona ổn định ở đầu prompt, context volatile ở cuối (xem prompt-caching). Verify `cache_read_input_tokens > 0`.
5. **Canh mốc 15/6/2026:** khi pool Agent SDK riêng kích hoạt → đo thực tế Max $100 đủ không, thiếu thì lên $200 hoặc thêm overflow budget. **Check hạn mức Max hiện hành lúc đăng ký** (điều khoản đang đổi).

---

## 6. Sources
Giá + subscription metering: claude-api skill (Anthropic, cache 2026-05-26) + Claude Code docs
(authentication / llm-gateway). Free-tier aggregation: [OmniRoute](https://github.com/diegosouzapw/OmniRoute).
