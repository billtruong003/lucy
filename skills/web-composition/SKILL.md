---
name: web-composition
description: "Trí tuệ thiết kế web cho STRATARO Factory v2 — bố cục compositional (atoms × recipes), narrative arc, taste rubric chấm điểm, constraint hợp lệ. Composer + Taste-Gate LOAD skill này để bốc recipe per-section + chấm screenshot. Trigger: compose landing, chọn recipe/layout per-section, chấm điểm design, factory đẻ template đa dạng."
license: MIT
metadata:
  domain: design
  author: Lucy
  related: ui-ux-pro-max
---

# Web Composition — design brain cho Factory v2

Externalize "gu" ra khỏi đầu model → nhất quán, audit được, tự cải thiện. Composer (bốc recipe) + Gate (chấm) load skill này.

## 1. ATOM TAXONOMY (đơn vị nội dung — tách khỏi layout)
`eyebrow · heading · body · media · ctas[] · items[]` (item: icon/title/desc/media). Section = atoms + 1 recipe. Cùng atoms, đổi recipe → bố cục khác. Nguồn: apps/web/src/blocks/compose/SectionRenderer.astro.

## 2. RECIPE CATALOG (cách đặt atoms — apps/web/src/blocks/compose/recipes.ts)
- `stack-center` — text giữa + media dưới + items lưới. Hợp: hero/feature/statement. Density airy.
- `split-media-right` — chữ trái | ảnh phải. Hợp: hero/feature/content.
- `split-media-left` — ảnh trái | chữ phải.
- `editorial-asym` — heading lớn lệch 7/5 + media full-bleed. Hợp: hero/statement (cảm giác tạp chí).
- `bento` — copy + media + items trong lưới 2D kích cỡ khác nhau. Hợp: feature/showcase/gallery.

## 3. NARRATIVE ARC (Composer bốc recipe theo nhịp — factory/lib/composer.mjs)
Trang = chuỗi có nhịp, KHÔNG đồng đều: **impact (hero) → context → climax (showcase) → proof → close**.
- Hero = impact: editorial-asym hoặc split (ảnh dẫn).
- Giữa: xen kẽ split-trái/phải + 1 statement stack-center (điểm nghỉ).
- Showcase/features = climax: bento (2D, mật độ cao).
- KHÔNG để 2 section liền nhau cùng recipe (tạo nhịp/tương phản).
- Mục tiêu: ≥3 recipe khác nhau/trang.

## 4. CONSTRAINT (loại combo xấu — factory/lib/constraints.mjs)
`isValidCombo({style, archetype, recipe})`: vd bento-page hợp recipe bento; panel hợp section ít content; brutalism không đi với clay. Composer loại combo invalid TRƯỚC khi render → "tổ hợp" hết ảo.

## 5. TASTE RUBRIC (Gate chấm 0–100 — factory/lib/taste-rubric.mjs, 7 tiêu chí)
visual_hierarchy · balance · whitespace · contrast/a11y · focal_point · "template-hay-agency" · consistency.
Khắt khe: template thường ~50–65, tốt ~75, agency ~90+. `buildJudgePrompt(RUBRIC)` → prompt cho vision model (Gemini) chấm screenshot → JSON {scores, total, issues[]}. Ngưỡng pass mặc định 70. Dưới ngưỡng → trả issues → Composer sửa (loop). Gate: factory/gate-taste.mjs.

## 6. COPY GATE (factory/lib/copy-gate.mjs)
`checkCopy(text)` chặn: gạch ngang dài (— –, luật chủ nhân), cụm sáo rỗng ("chất lượng hàng đầu/uy tín/tốt nhất"), câu quá dài.

## 7. TỰ CẢI THIỆN (skill-engine T6)
Gate loại mẫu nào → lưu lý do (issues) → tinh recipe/rubric/constraint trong skill → kho mẫu khá dần. Đây là vòng học của factory.

## Pre-delivery checklist (mọi mẫu)
- [ ] ≥3 recipe khác nhau/trang (đa dạng) [ ] combo hợp lệ (constraint) [ ] taste total ≥70
- [ ] không emoji icon, không gạch ngang [ ] màu/shape theo token (--color-*, --ui-*) [ ] responsive 375/768/1440 [ ] reduced-motion
