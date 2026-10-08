---
title: "Cắm API keys cho Lucy (M2 Tay)"
date: 2026-06-15
author: Lucy
---

# Cách chủ nhân cắm API keys (để bật "tay" M2)

> **Nguyên tắc bảo mật:** chủ nhân tự nhập key vào file `.env.llm` trên VPS (gitignored, mode 600) — KHÔNG paste key vào chat. Cắm xong nhắn em *"đã cắm <tên>"* → em bật flag đúng + verify (không cần đọc value).
> File: `/root/lucy/.env.llm` (sửa bằng `nano /root/lucy/.env.llm`, thêm 1 dòng `KEY=value`).

## 1. GitHub (đọc repo/PR/issue) — DỄ
1. Vào https://github.com/settings/tokens → **Generate new token** (fine-grained khuyến nghị).
2. Scope: `repo` (read) + `read:org` (nếu cần). Hết hạn tuỳ chọn.
3. Thêm dòng: `GITHUB_TOKEN=ghp_xxx` vào `.env.llm`.
4. Nhắn em "đã cắm GitHub" → em bật `LUCY_MCP=1` + GitHub server + restart worker + verify gọi thật (list repo).

## 2. TwelveData (CK/forex/vàng XAU) — DỄ, free
1. Đăng ký free https://twelvedata.com/ → lấy API key (free 800 call/ngày).
2. Thêm: `TWELVEDATA_API_KEY=xxx` vào `.env.llm`.
3. Nhắn em → bật finance MCP + verify (lấy giá VN-Index/XAU thật). (CoinGecko + Binance đã chạy keyless sẵn.)

## 3. Notion (nếu dùng) — DỄ
1. https://www.notion.so/my-integrations → **New integration** → copy "Internal Integration Token".
2. Share page/database cần đọc cho integration đó (nút Share → mời integration).
3. Thêm: `NOTION_TOKEN=secret_xxx` vào `.env.llm`. → nhắn em bật + verify.

## 4. Google Workspace (Gmail/Calendar/Drive) — OAUTH, hơi nhiều bước
> Google KHÔNG phải paste-key đơn giản, mà là **OAuth** (uỷ quyền 1 lần). 2 đường:
- **A. Qua MCP claude.ai** (Gmail/Calendar/Drive connector đang "connecting" trong môi trường) — chủ nhân chạy `authenticate` → mở link Google → đồng ý → xong. *Hợp khi dùng trong phiên claude.*
- **B. Self-host (Google Cloud OAuth)** — tạo project ở console.cloud.google.com → bật Gmail/Calendar/Drive API → tạo OAuth client (Desktop) → tải `credentials.json` → chạy luồng OAuth lần đầu lấy `token.json`. Nặng hơn, để Lucy chạy nền 24/7.
> → Khi tới Google, *nhắn em*, em hướng dẫn từng bước theo đường chủ nhân chọn (A nhanh, B bền cho cron đêm).

## Sau khi cắm bất kỳ key nào
Nhắn em "đã cắm <tên>" → em: bật flag (`LUCY_MCP=1` + per-server) → tái dựng env worker (qua /proc, giữ env cũ) → restart `lucy-vps-worker` → smoke gọi tool thật → báo OK. Mỗi cái bật riêng được, lỗi 1 cái không ảnh hưởng cái khác (circuit-breaker).
