# Lucy

**Trợ lý AI cá nhân tự host, chạy trên Claude.** Bạn nhắn cho Lucy qua Telegram hoặc web. Lucy nhớ bạn là ai, đang làm dự án gì, quen làm việc kiểu nào. Lucy chia được một việc lớn cho nhiều agent, dùng được công cụ của bạn và chạy việc theo lịch cả khi bạn ngủ.

[English](README.md)

> **Trạng thái: pre-alpha, đang dựng lại.** Lucy đã chạy làm trợ lý riêng từ giữa năm 2026. Repo này là bản viết lại sạch để mở mã nguồn. Code được đưa vào dần theo từng module (xem [Lộ trình](docs/vi/ROADMAP.md)), nên phần cài đặt dưới đây là trải nghiệm mục tiêu.

## Lucy làm được gì

| | |
|---|---|
| **Chat ở đâu cũng được** | Telegram và web dùng chung lịch sử và chung một bộ não. Câu trả lời hiện ra dần, có thể dừng hoặc đổi hướng giữa chừng. |
| **Bộ nhớ dài hạn** | Bộ nhớ là một thư mục Markdown thường (mở được bằng Obsidian). Mỗi lượt chat, Lucy tìm lại ghi chú liên quan (tìm theo chữ và theo nghĩa). Mỗi đêm có một lượt "dream" để gộp thông tin mới, bỏ trùng và cho hết hạn những gì đã cũ. Bạn đọc và sửa được hết. |
| **Đa agent** | Giao việc lớn thì việc thành các thẻ trên bảng. Worker nhận thẻ, các persona chuyên môn (lập kế hoạch, làm, review…) chuyền việc cho nhau. Có thể bật autopilot để tự duyệt các bước thường lệ. Ngân sách và token guard giữ chi phí trong giới hạn. |
| **Công cụ & MCP** | Lucy dùng công cụ của Claude Code (file, shell, web), mọi MCP server bạn kết nối và thư viện Agent Skills. |
| **Tự động hoá** | Prompt chạy theo lịch (tóm tắt buổi sáng, tổng kết tuần, lọc inbox…), gửi về Telegram hoặc web. |
| **Lane giá rẻ (tuỳ chọn)** | Việc nhẹ chạy bằng model qua API kiểu OpenAI (miễn phí hoặc rẻ), Claude vẫn là não chính. |

## Cài nhanh (mục tiêu)

```bash
git clone https://github.com/billtruong003/lucy && cd lucy
npx lucy init      # hỏi: đăng nhập Claude, token bot Telegram (tuỳ chọn), mật khẩu web; tạo vault
npx lucy start     # một process: API + web + Telegram + worker
```

Hoặc dùng Docker: chạy `lucy init` xong thì `docker compose up -d`.

**Cần có:** Node.js 20+, gói Claude hoặc Anthropic API key, và (nếu muốn) một bot Telegram tạo từ [@BotFather](https://t.me/BotFather).

## Tài liệu

- [Kiến trúc](docs/vi/ARCHITECTURE.md)
- [Lộ trình](docs/vi/ROADMAP.md)

## Giấy phép

[MIT](LICENSE).
