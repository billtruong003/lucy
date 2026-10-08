# Model Comparison — free models LUCY có (benchmark, không assume)

> **Viết 2026-06-09.** Bill nghi Groq/Gemini/Cerebras = model yếu. Research benchmark cho thấy:
> **lẫn provider với model.** Bảng này xếp hạng theo benchmark thật (LiveCodeBench, SWE-Bench Pro,
> Intelligence Index, Arena) để routing chính xác. Nguồn cuối doc. Đi với [FREE_API_PROVIDERS.md](_outdated/FREE_API_PROVIDERS.md).

---

## 0. Hiểu lầm cần sửa TRƯỚC

**Groq & Cerebras KHÔNG làm model — họ bán TỐC ĐỘ.** Họ host **model mở** (Llama 3.3 70B, Qwen3 235B)
trên hardware nhanh. Cùng 1 model chạy ở Groq hay chỗ khác thì **chất lượng y hệt**, chỉ khác tốc độ.
**Gemini là model riêng của Google** — và **Gemini 3.1 Pro là hàng frontier**, KHÔNG yếu.

→ Cái "yếu" mà Bill cảm nhận đúng 1 phần: **Llama 3.3 70B** (model mặc định trên Groq/Cerebras) **yếu
cho CODE**. Nhưng đó là lỗi của *model Llama*, không phải Groq/Cerebras — 2 nhà này cũng host **Qwen3
235B** (mạnh). Và các model mạnh nhất (Kimi/DeepSeek/GLM/MiniMax) nằm ở **OpenRouter + OpenCode Zen**
mà Bill đã có key.

---

## 1. Bảng xếp hạng — model free LUCY truy cập được (qua key Bill đã cắm)

Thang: **S** = frontier-class · **A** = mạnh · **B** = khá · **C** = yếu/đủ-dùng. (∞ = ~1M context)

| Model | Free qua (key Bill) | Reasoning | **Code** | Writing EN | Tốc độ | Ctx | Điểm chuẩn nổi bật |
|---|---|---|---|---|---|---|---|
| **Kimi K2.6** | OpenRouter | A | **S** | A | B | 256K | SWE-Verified 80.2 · LiveCodeBench 89.6 · II 54 (top open) |
| **MiniMax M3** | OpenRouter | A | **S** | B | B | **∞** | SWE-Bench Pro **59.0** (top open-weight) · multimodal |
| **GLM-5.1 / GLM-5** | OpenRouter, **Z.ai** | A | **S** | B | B | 200K | SWE-Bench Pro 58.4 · agentic 8h long-horizon |
| **DeepSeek V4 Pro** | OpenRouter | **S** | **S** | A | B | **∞** | LiveCodeBench 69.99 · agentic 56.67 · II 52 |
| **DeepSeek V4 Flash** | **OpenCode Zen**, OpenRouter | A | A | B | A | **∞** | bản nhanh của V4, free Zen |
| **Qwen3.6 / Qwen3 235B** | OpenRouter, **Cerebras** | A | A | **S** (creative+đa ngữ) | A | ∞ | Coding 71.78 · top open creative writing |
| **Gemini 3.1 Pro** | **Gemini** | **S** | A | **S** (informational) | B | ∞ | frontier; "ít văn chương, mạnh nội dung thông tin" = HỢP tutorial |
| **Gemini 3 Flash / 3.5 Flash** | **Gemini** | A | B | A | **S** | ∞ | nhanh + 1500 RPD free — chủ lực volume |
| **MiMo-V2.5-Pro** | **OpenCode Zen**, OpenRouter | A | A | B | A | — | II 54 (ngang Kimi về intelligence index) |
| **Nemotron 3 (Super/Ultra)** | **OpenCode Zen**, (NVIDIA) | A | B | B | A | — | 120B MoE |
| **Mistral Large 3** | **Mistral** | B | B | A | A | — | đa ngữ tốt, 1B tok/tháng free |
| **Llama 3.3 70B** | **Groq, Cerebras** | C | **C** | C | **S** | 128K | ⚠️ nhanh nhất nhưng YẾU code — chỉ dùng classify/chat |
| **Big Pickle / Owl Alpha** (stealth) | OpenCode Zen / OpenRouter | ? | ? | ? | ? | ? | ẩn — phải tự test, có thể biến mất |

---

## 2. Đọc bảng — kết luận

1. **Bill có access tất cả model mạnh nhất** (Kimi K2.6, MiniMax M3, GLM-5.1, DeepSeek V4) qua
   **OpenRouter + OpenCode Zen + Z.ai** — không thiếu hàng xịn.
2. **Llama 3.3 70B (Groq/Cerebras) = yếu nhất cho code** → đừng giao nó viết code tutorial. Nhưng nó
   **nhanh nhất** → giao việc nhẹ: classify, tag, narration, chat Aki, tóm tắt.
3. **Gemini bị đánh giá thấp oan.** Gemini 3.1 Pro frontier; Gemini 3 Flash nhanh + 1500 RPD →
   **chủ lực viết content tutorial** (đúng sở trường "informational").
4. **Code tutorial / validate snippet** → DeepSeek V4 / Kimi K2.6 / GLM-5.1 / MiniMax M3 (S-tier code).
5. **Creative/đa ngữ (VN)** → Qwen3 (top open creative, multilingual mạnh).
6. **English customer-facing polish** → vẫn nên để Claude (tầng trả phí, volume nhỏ) — model TQ hay
   dính "ESL pattern" ở văn dài. Content tutorial/VN thì free models thừa sức.

---

## 3. Routing đề xuất cho LUCY (set combo trong OmniRoute)

| Việc (LUCY) | Model chính | Fallback | Vì sao |
|---|---|---|---|
| **Classify / tag / narration / Aki chat** | Llama 3.3 70B (Groq) | Cerebras Llama, Gemini Flash | nhẹ + cần nhanh, Llama đủ |
| **Viết bài tutorial (informational)** | Gemini 3 Flash | Gemini 3.1 Pro, Qwen3 | informational sweet spot + 1500 RPD |
| **Viết bài creative / VN** | Qwen3 235B (Cerebras) | DeepSeek V4, Gemini Pro | top open creative + đa ngữ |
| **Sinh/validate CODE trong bài** | DeepSeek V4 (OpenCode Zen free) | Kimi K2.6, GLM-5.1, MiniMax M3 | S-tier code, 1M ctx |
| **Fact-check / reasoning** | DeepSeek V4 Pro | Gemini 3.1 Pro, GLM-5.1 | reasoning S-tier |
| **Polish English (customer-facing)** | *(Claude trả phí, tầng 1)* | — | model free hay ESL ở văn dài EN |
| **Embedding** | Gemini embedding free | local | free |

**Combo strategy OmniRoute:** dùng **cost-optimized + round-robin + fallback 4 tầng**. Mỗi job map 1
"combo" (chuỗi model self-heal khi cạn quota). Bật **RTK+Caveman compression** lên hết.

---

## 4. Việc tiếp (Sprint 1 nốt)
- Tạo các **combo** trên trong OmniRoute theo bảng §3 (cần verify model-id chính xác qua `/v1/models`).
- Test 1 call mỗi combo → xác nhận routing + đo % token nén.
- Stealth models (Big Pickle/Owl Alpha): chạy 1 prompt thử, nếu tốt thì thêm, không thì bỏ.

---

## 5. Sources
[llm-stats leaderboard](https://llm-stats.com/leaderboards/llm-leaderboard) ·
[Artificial Analysis](https://artificialanalysis.ai/leaderboards/models) ·
[BenchLM — Chinese LLMs 2026](https://benchlm.ai/blog/posts/best-chinese-llm) ·
[BenchLM — best coding LLM](https://benchlm.ai/blog/posts/best-llm-coding) ·
[SWE-bench](http://www.swebench.com/) ·
[SiliconFlow — best open creative writing](https://www.siliconflow.com/articles/en/best-open-source-llm-for-creative-writing-ideation) ·
[Kilo — open coding models](https://kilo.ai/open-source-models)
