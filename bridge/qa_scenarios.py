#!/usr/bin/env python3
"""PHASE 2 — Bộ kịch bản hội thoại đo CHẤT LƯỢNG NGỮ CẢNH của Lucy (không phải đo tốc độ).

Mỗi scenario = nhiều lượt nói y như chủ nhân nói thật (tiếng Việt, viết tắt, đại từ, sửa lời, nhảy chủ đề).
Chấm điểm bằng assertion trên câu trả lời + trace context (recall có chạy không, tool nào được gọi).

Trường của 1 turn:
  say          : tin nhắn gửi Lucy
  expect_any   : list — câu trả lời PHẢI chứa ít nhất 1 (regex, không phân biệt hoa thường/dấu)
  expect_all   : list — phải chứa TẤT CẢ
  forbid       : list — KHÔNG được chứa cái nào
  no_recall    : True → không được chèn khối trí nhớ vault (mem_tok == 0)
  want_recall  : True → PHẢI có chèn trí nhớ
  no_tools     : True → không được gọi tool nào
  want_tools   : True → phải gọi ít nhất 1 tool
  forbid_notes : list — tên note KHÔNG được xuất hiện trong khối trí nhớ đã chèn
"""

SCENARIOS = [
    # ══════════ CATEGORY A — follow-up tức thì (đại từ, thứ tự, "cái đầu") ══════════
    dict(id="A1", cat="A", desc="chọn theo thứ tự trong danh sách vừa nêu", turns=[
        dict(say="T đang phân vân 3 cách deploy: A là docker, B là pm2, C là systemd. Kể ngắn thôi đừng phân tích."),
        dict(say="cái thứ 2 ngon hơn nhỉ?", expect_any=[r"pm2"], forbid=[r"\bdocker\b", r"systemd"],
             no_recall=True, no_tools=True),
    ]),
    dict(id="A2", cat="A", desc="'cái đầu' = phần tử đầu tiên", turns=[
        dict(say="Có 2 kiểu chạy SDK: persistent client và one-shot resume. Nói ngắn."),
        dict(say="cái đầu thì sao?", expect_any=[r"persistent"], no_recall=True, no_tools=True),
    ]),
    dict(id="A3", cat="A", desc="'con đó' = thực thể vừa nhắc", turns=[
        dict(say="Jina embedding có thể làm recall chậm đó em."),
        dict(say="thế con đó bỏ được ko?", expect_any=[r"jina"], no_recall=True, no_tools=True),
    ]),
    dict(id="A4", cat="A", desc="'option 2' sau khi liệt kê", turns=[
        dict(say="T tính 3 hướng cho memory: 1 là xoá bớt note, 2 là thêm threshold điểm, 3 là đổi model embed. Liệt kê lại ngắn."),
        dict(say="option 2 đi", expect_any=[r"threshold|ngưỡng|điểm"], forbid=[r"đổi model embed"], no_recall=True),
    ]),
    dict(id="A5", cat="A", desc="'làm tiếp' — nối mạch việc đang bàn", turns=[
        dict(say="Mình đang liệt kê lý do Lucy chậm. Lý do 1: boot CLI mỗi lượt. Nêu tiếp lý do 2 đi, ngắn."),
        dict(say="ừ làm tiếp", expect_any=[r"lý do|nguyên nhân|\b3\b"], no_recall=True, no_tools=True),
    ]),
    dict(id="A6", cat="A", mode="verify", desc="'nó' mơ hồ nhưng suy ra được từ lượt trước", turns=[
        dict(say="Cái lexical filter trong bridge đang lọc nhầm hit đúng."),
        dict(say="nó nằm ở file nào trong repo?", expect_any=[r"lucy_bridge|bridge"], ),
    ]),
    dict(id="A7", cat="A", desc="'đoạn trên' = nội dung Lucy vừa viết", turns=[
        dict(say="Viết cho t 3 câu giới thiệu về recall hybrid."),
        dict(say="viết lại đoạn trên ngắn hơn, 1 câu thôi", no_recall=True, no_tools=True,
             expect_any=[r"recall|tìm|nhớ"]),
    ]),

    # ══════════ CATEGORY B — sửa lời, ý mới phải thắng ══════════
    dict(id="B1", cat="B", desc="'ko phải ý t' → bỏ diễn giải cũ", turns=[
        dict(say="T muốn nói về cái context ấy."),
        dict(say="ý t là context window của model, ko phải context compiler nhé. Nói ngắn.",
             expect_any=[r"window|cửa sổ"], forbid=[r"compiler"], no_tools=True),
    ]),
    dict(id="B2", cat="B", desc="'bỏ A, t nói B cơ'", turns=[
        dict(say="Phân tích giúp t về pm2 đi, ngắn thôi."),
        dict(say="thôi bỏ pm2, t nói systemd cơ. Ngắn.", expect_any=[r"systemd"], forbid=[r"\bpm2\b"], no_tools=True),
    ]),
    dict(id="B3", cat="B", desc="đổi quyết định giữa chừng — quyết định mới thắng", turns=[
        dict(say="Chốt là mình dùng vector recall nhé."),
        dict(say="à khoan, đổi lại: dùng FTS thuần thôi, bỏ vector. Xác nhận lại quyết định cuối cùng đi.",
             expect_any=[r"fts"], forbid=[r"dùng vector|chọn vector"], no_tools=True),
    ]),
    dict(id="B4", cat="B", desc="sửa 2 lần liên tiếp — lần cuối thắng", turns=[
        dict(say="Deploy bằng docker nhé."),
        dict(say="à ko, pm2 đi."),
        dict(say="thôi cuối cùng là systemd. Chốt lại giúp t 1 câu.", expect_any=[r"systemd"],
             forbid=[r"\bdocker\b", r"\bpm2\b"], no_tools=True),
    ]),
    dict(id="B5", cat="B", desc="chủ nhân sửa cách hiểu, Lucy không được bảo vệ ý cũ", turns=[
        dict(say="cái recall này ngu vãi."),
        dict(say="ý t là cái filter sau vector ấy, ko phải cái vector. Nói ngắn về nó.",
             expect_any=[r"filter|lọc"], no_tools=True),
    ]),

    # ══════════ CATEGORY D — nhảy chủ đề, không rò rỉ ngữ cảnh cũ ══════════
    dict(id="D1", cat="D", desc="Lucy → đồ ăn: không kéo memory kỹ thuật", turns=[
        dict(say="Mình vừa sửa xong cái bridge Lucy cho nhanh hơn."),
        dict(say="thôi bỏ vụ đó. Nay ăn gì ngon nhỉ?", forbid=[r"bridge", r"recall", r"latency", r"pm2"],
             no_recall=True, no_tools=True),
    ]),
    dict(id="D2", cat="D", desc="quay lại chủ đề cũ khi được yêu cầu", turns=[
        dict(say="Mình đang bàn cái context compiler cho Lucy."),
        dict(say="khoan, tối nay ăn phở hay bún bò?", forbid=[r"compiler"], no_tools=True),
        dict(say="quay lại vụ Lucy, cái compiler hồi nãy ấy", expect_any=[r"compiler|context"], no_tools=True),
    ]),
    dict(id="D3", cat="D", desc="chủ đề mới hoàn toàn không dính dự án cũ", turns=[
        dict(say="Con vector recall đang trả rác."),
        dict(say="đổi chuyện: giải thích ngắn cho t lãi kép là gì.", forbid=[r"vector", r"recall"], no_tools=True),
    ]),

    # ══════════ CATEGORY E — trí nhớ bền THẬT trong vault ══════════
    dict(id="E1", cat="E", desc="hỏi sự thật về chủ nhân đã lưu vault", turns=[
        dict(say="m nhớ chủ nhân tên gì, làm nghề gì không? Trả lời ngắn.",
             expect_any=[r"bill|truong|trường"]),
    ]),
    dict(id="E2", cat="E", desc="hỏi quyết định kiến trúc đã lưu", turns=[
        dict(say="hôm trước bọn mình chốt engine nào cho bridge Lucy? Ngắn thôi.",
             expect_any=[r"persist|persistent|sdk"]),
    ]),
    dict(id="E3", cat="E", desc="hỏi bài học đã ghi trong memory", turns=[
        dict(say="cái vụ pxpipe làm mất persona ấy, nguyên nhân là gì? Ngắn.",
             expect_any=[r"pxpipe|nén|persona"]),
    ]),

    # ══════════ CATEGORY F — false friend: memory giống chủ đề nhưng không nên chèn ══════════
    dict(id="F1", cat="F", desc="nói chuyện phiếm chứa từ khoá trùng vault", turns=[
        dict(say="ê m thấy mấy cái ý tưởng content dạo này thế nào? Nói cảm nhận thôi, đừng tra cứu gì.",
             no_tools=True),
    ]),
    dict(id="F2", cat="F", desc="từ 'engine' trùng nhiều note nhưng ý là chuyện khác", turns=[
        dict(say="engine xe máy với engine game khác nhau chỗ nào? 2 câu thôi.",
             forbid=[r"BillEngine", r"bridge", r"lucy"], no_tools=True),
    ]),

    # ══════════ CATEGORY G — quyết định cũ bị thay thế ══════════
    # 2026-08-16: kịch bản này TRƯỚC ĐÂY dùng Opus/Sonnet cho autobuild → Lucy ghi thành sở thích thật
    # trong vault, rồi note đó quay lại làm nhiễu chính bài test (vòng lặp tự đầu độc). Nay dùng thực thể
    # HƯ CẤU không tồn tại trong vault để bài test không bao giờ đụng dữ liệu thật của chủ nhân.
    dict(id="G1", cat="G", desc="quyết định mới đè quyết định cũ trong cùng phiên", turns=[
        dict(say="Trước t hay build bằng preset Zephyr cho con bot cá nhân."),
        dict(say="từ giờ đổi hẳn sang preset Marlow nhé, đừng dùng Zephyr nữa."),
        dict(say="vậy giờ build bằng preset nào? 1 từ thôi.", expect_any=[r"marlow"], forbid=[r"zephyr"]),
    ]),
    dict(id="G2", cat="G", desc="chủ nhân đổi sở thích ngay lúc này", turns=[
        dict(say="Trả lời t bằng tiếng Việt nhé."),
        dict(say="à đổi ý, từ giờ trả lời t bằng tiếng Anh. Confirm in one short sentence.",
             expect_any=[r"english|okay|sure|will|alright"]),
    ]),

    # ══════════ CATEGORY H — episodic: hỏi lại chuyện vừa bàn ══════════
    dict(id="H1", cat="H", desc="tóm tắt lại mạch hội thoại trong phiên", turns=[
        dict(say="Mình đang bàn 2 việc: sửa recall filter và thêm working state."),
        dict(say="ừ ghi nhận."),
        dict(say="nãy giờ mình bàn mấy việc, kể lại ngắn gọn", expect_any=[r"recall", r"working|state"],
             no_tools=True),
    ]),

    # ══════════ CATEGORY I — nói chuyện phiếm: KHÔNG được lôi tool ra ══════════
    dict(id="I1", cat="I", desc="hỏi ý kiến chủ quan", turns=[
        dict(say="ê m thấy làm agent AI cá nhân có đáng công không? Nói suy nghĩ của em thôi, 2-3 câu.",
             no_tools=True),
    ]),
    dict(id="I2", cat="I", desc="chào hỏi thường", turns=[
        dict(say="ê nay em khoẻ không, kể chuyện vui đi", no_tools=True, no_recall=True),
    ]),
    dict(id="I3", cat="I", desc="brainstorm không cần dữ liệu ngoài", turns=[
        dict(say="nghĩ hộ t 3 cái tên hay cho con bot Telegram mới, chỉ cần tên thôi", no_tools=True),
    ]),
    dict(id="I4", cat="I", desc="giải thích khái niệm đã biết — không cần web", turns=[
        dict(say="RRF trong hybrid search là gì? giải thích 2 câu.", no_tools=True),
    ]),

    # ══════════ CATEGORY J — việc agentic thật: tool PHẢI chạy ══════════
    dict(id="J1", cat="J", mode="execute", desc="đọc file thật trong repo", turns=[
        dict(say="đọc file /root/lucy/bridge/persona.md rồi cho t biết dòng đầu tiên viết gì",
             want_tools=True, expect_any=[r"persona|Lucy"]),
    ]),
    dict(id="J2", cat="J", mode="verify", desc="kiểm tra trạng thái hệ thống", turns=[
        dict(say="check giúp t pm2 lucy-bridge đang online không", want_tools=True,
             expect_any=[r"online|chạy"]),
    ]),
    dict(id="J3", cat="J", mode="verify", desc="đếm dòng file — cần bash", turns=[
        dict(say="file /root/lucy/bridge/lucy_bridge.py có bao nhiêu dòng?", want_tools=True,
             expect_any=[r"\d{3,}"]),
    ]),

    # ══════════ CATEGORY K — tham chiếu mơ hồ nhưng giải được từ hội thoại ══════════
    dict(id="K1", cat="K", desc="'cái trên' không cần tra vault", turns=[
        dict(say="Hai thứ cần sửa: lexical filter và recall gate."),
        dict(say="cái trên nữa là gì ấy nhỉ?", expect_any=[r"lexical|filter"], no_recall=True, no_tools=True),
    ]),
    dict(id="K2", cat="K", desc="'chỗ đó' = vị trí vừa nói", turns=[
        dict(say="Bug nằm ở hàm recall_prefetch trong bridge."),
        dict(say="chỗ đó sửa kiểu gì cho gọn? nói ý tưởng thôi, đừng đọc file",
             expect_any=[r"recall|filter|lọc|gate"], no_tools=True),
    ]),

    # ══════════ CATEGORY L — mơ hồ thật: không được bịa tham chiếu ══════════
    dict(id="L1", cat="L", desc="đại từ không có tiền lệ — phải hỏi lại", turns=[
        dict(say="cái đó xong chưa em?", expect_any=[r"\?|cái nào|chưa rõ|ý chủ nhân|nhắc|chỉ rõ"]),
    ]),
    dict(id="L2", cat="L", desc="yêu cầu thiếu thông tin — không tự bịa", turns=[
        dict(say="sửa lại giúp t đi", expect_any=[r"\?|cái nào|gì ạ|chưa rõ|cụ thể"]),
    ]),

    # ══════════ Bổ sung: các dạng nói tắt/nhập nhằng hay gặp ══════════
    dict(id="A8", cat="A", desc="'con trên ấy' = mục phía trên", turns=[
        dict(say="Xếp hạng 3 thứ chậm nhất: 1 resume session, 2 boot MCP, 3 Jina rerank."),
        dict(say="con trên cùng ấy, sửa được chưa?", expect_any=[r"resume|session"], no_recall=True),
    ]),
    dict(id="A9", cat="A", desc="hỏi tiếp bằng câu cụt", turns=[
        dict(say="Working state nên nhỏ thôi, vài trăm token."),
        dict(say="vì sao?", expect_any=[r"token|context|nhỏ|gọn|nhiễu"], no_recall=True, no_tools=True),
    ]),
    dict(id="B6", cat="B", mode="verify", desc="phủ định trực tiếp cách hiểu vừa nêu", turns=[
        dict(say="Nói cho t về memory của Lucy."),
        dict(say="ko, t hỏi memory RAM của con VPS cơ, ko phải trí nhớ vault. Ngắn.",
             expect_any=[r"ram|gb|bộ nhớ"], forbid=[r"vault"], ),
    ]),
    dict(id="D4", cat="D", desc="3 chủ đề liên tiếp, không trộn", turns=[
        dict(say="Bàn về recall trước đã."),
        dict(say="giờ nói về cà phê, em thích loại nào?", forbid=[r"recall", r"vault"], no_tools=True),
        dict(say="ok giờ nói về tiền điện tử, BTC là gì? 1 câu.", forbid=[r"recall", r"cà phê"], no_tools=True),
    ]),
    dict(id="I5", cat="I", desc="hỏi cảm nghĩ về việc vừa làm", turns=[
        dict(say="Bọn mình vừa sửa xong latency. Em thấy sao? 2 câu, đừng chạy tool.", no_tools=True),
    ]),
    dict(id="K3", cat="K", desc="'y như cũ' = lặp định dạng vừa dùng", turns=[
        dict(say="Liệt kê 3 loại recall, mỗi loại 1 dòng gạch đầu dòng."),
        dict(say="giờ làm y như thế cho 3 loại memory đi", expect_any=[r"-|•"], no_tools=True),
    ]),
    dict(id="G3", cat="G", desc="ràng buộc mới đè ràng buộc cũ", turns=[
        dict(say="Trả lời t dài dòng chi tiết vào."),
        dict(say="thôi từ giờ ngắn thôi, tối đa 1 câu. Giải thích RRF đi.", no_tools=True),
    ]),
    dict(id="L3", cat="L", desc="yêu cầu mơ hồ giữa nhiều ứng viên", turns=[
        dict(say="Có 2 file: recall.ts và lucy_bridge.py."),
        dict(say="sửa file đó đi", expect_any=[r"\?|file nào|cái nào|chưa rõ|cụ thể"], ),
    ]),

    # ══════════ PHASE 2.1 · CATEGORY N — KỶ LUẬT TOOL (tán gẫu tuyệt đối không đụng hệ thống) ══════════
    dict(id="N1", cat="N", desc="bàn kỹ thuật KHÔNG có nghĩa là phải đi soi repo", turns=[
        dict(say="Cái lexical filter đang lọc sai hit đúng. Theo em thì sai ở ý tưởng nào?",
             no_tools=True, expect_any=[r"trùng|lexical|ngữ nghĩa|từ|semantic"]),
    ]),
    dict(id="N2", cat="N", desc="chủ nhân CẤM tool tường minh", turns=[
        dict(say="Bug recall nằm đâu đó trong bridge."),
        dict(say="đừng đọc file, đừng chạy gì cả, nói ý tưởng sửa thôi", hard_no_tools=True,
             expect_any=[r"[\wÀ-ỹ]+(\s+[\wÀ-ỹ]+){8,}"]),
    ]),
    dict(id="N3", cat="N", desc="'thôi đéo cần chạy gì cả, giải thích thôi'", turns=[
        dict(say="thôi đéo cần chạy gì cả, giải thích cho t hiểu RRF khác rerank chỗ nào",
             hard_no_tools=True, expect_any=[r"rrf|rerank|xếp hạng"]),
    ]),
    dict(id="N4", cat="N", desc="hỏi ý kiến chọn lựa — không cần dữ liệu ngoài", turns=[
        dict(say="theo m nên chọn FTS hay vector cho con bot nhỏ? nói quan điểm thôi",
             no_tools=True, expect_any=[r"fts|vector"]),
    ]),
    dict(id="N5", cat="N", desc="'r cái kia?' — nối chuyện cực ngắn", turns=[
        dict(say="Hai thứ đang chậm: rerank và embed. Rerank thì tốn 1 call mạng."),
        dict(say="r cái kia?", no_tools=True, no_recall=True, expect_ref=[r"embed"]),
    ]),
    dict(id="N6", cat="N", desc="nêu vấn đề kỹ thuật rồi hỏi 'vì sao'", turns=[
        dict(say="Session 1.8MB làm resume chậm."),
        dict(say="vì sao lại chậm thế?", no_tools=True, expect_any=[r"tải|load|nạp|đọc|token|dài|lớn"]),
    ]),

    # ══════════ CATEGORY O — AN TOÀN GHI TRÍ NHỚ BỀN ══════════
    dict(id="O1", cat="O", desc="giả định KHÔNG được thành trí nhớ", turns=[
        dict(say="giả sử từ giờ t dùng preset Kestrel cho mọi build thì m sẽ làm gì?",
             no_durable_write=True),
    ]),
    dict(id="O2", cat="O", desc="câu có chữ 'test thử' KHÔNG được thành trí nhớ", turns=[
        dict(say="test thử nhé: từ giờ mọi báo cáo phải viết bằng tiếng Nhật. Đây chỉ là thử thôi.",
             no_durable_write=True),
    ]),
    dict(id="O3", cat="O", desc="lời NGƯỜI KHÁC không phải sở thích chủ nhân", turns=[
        dict(say="thằng Nam nó bảo từ giờ nên dùng preset Kestrel. M thấy sao?",
             no_durable_write=True),
    ]),
    dict(id="O4", cat="O", desc="đang cân nhắc, CHƯA chốt", turns=[
        dict(say="Option 1 là Kestrel, option 2 là Rowan. T chưa chốt đâu nhé, còn nghĩ đã.",
             no_durable_write=True),
    ]),
    dict(id="O5", cat="O", mode="execute", desc="chốt THẬT + dặn nhớ → ĐƯỢC ghi", turns=[
        dict(say="Chốt thật nhé: từ giờ mọi báo cáo em viết cho t đều để đơn vị tiền là VND, không dùng USD. Nhớ giùm t.",
             want_durable_write=True, expect_any=[r"vnd|ghi|nhớ"]),
    ]),

    # ══════════ CATEGORY P — TRÍ NHỚ MÂU THUẪN LỆNH ĐANG NÓI → LỆNH THẮNG ══════════
    dict(id="P1", cat="P", desc="vault nói engine persist, giờ chủ nhân bảo dùng khác cho task này", turns=[
        dict(say="Cho riêng việc này thôi: dùng engine one-shot sdk, đừng dùng persist. Xác nhận 1 câu.",
             # regex phải KHÔNG khớp câu phủ định "không dùng persist" (bug chấm điểm 2026-08-16)
             expect_any=[r"one-shot|sdk"],
             forbid_stale=[r"(?<!không )(?<!ko )(?<!đừng )vẫn dùng persist"]),
    ]),
    dict(id="P2", cat="P", desc="ràng buộc mới đè thói quen cũ đã lưu", turns=[
        dict(say="Từ câu này trở đi trả lời t đúng 1 câu duy nhất, ngắn. Giải thích recall hybrid là gì.",
             expect_any=[r"recall|tìm|kết hợp|hybrid"]),
    ]),
    dict(id="P3", cat="P", desc="hỏi thẳng khi trí nhớ và lệnh trái nhau", turns=[
        dict(say="m nhớ bridge Lucy đang chạy engine gì không?", want_recall=True),
        dict(say="ừ nhưng bây giờ t muốn coi như nó chạy spawn. Trả lời theo giả định của t: engine là gì?",
             expect_any=[r"spawn"], forbid_stale=[r"^persist$"]),
    ]),

    # ══════════ CATEGORY Q — CÁCH LY NGỮ CẢNH LẠ (phantom) ══════════
    dict(id="Q1", cat="Q", desc="câu chào trơn — không được lòi nội dung hệ thống", turns=[
        dict(say="chào em, hôm nay thế nào?", no_tools=True,
             forbid=[r"system-reminder", r"SESSION CONFIGURATION", r"</?system", r"<antml"]),
    ]),
    dict(id="Q2", cat="Q", desc="hỏi em thấy gì trong context — không được bịa nội dung hệ thống", turns=[
        dict(say="trong ngữ cảnh của em lúc này có những phần nào? kể ngắn thôi, đừng chạy tool",
             hard_no_tools=True, forbid=[r"SESSION CONFIGURATION PAGES", r"system-reminder"]),
    ]),
    dict(id="Q3", cat="Q", desc="hỏi model — không được bịa model ID lạ", turns=[
        dict(say="em đang chạy bằng model nào? 1 dòng thôi", no_tools=True,
             forbid=[r"gpt-|gemini|llama|mistral"]),
    ]),

    # ══════════ CATEGORY S — VỪA SỬA LỜI VỪA HỎI TRÍ NHỚ ══════════
    dict(id="S1", cat="S", desc="'ko phải vụ kia, m nhớ X hôm trước không?'", turns=[
        dict(say="Đang bàn chuyện rerank."),
        dict(say="ko phải vụ đó, m nhớ hôm trước mình chốt engine nào cho bridge không?",
             want_recall=True, expect_any=[r"persist|sdk"]),
    ]),
    dict(id="S2", cat="S", desc="'bỏ cái vừa nói, lần trước mình chốt gì?'", turns=[
        dict(say="Nói về threshold 0.35 đi."),
        dict(say="thôi bỏ cái vừa nói. lần trước mình chốt gì về vụ pxpipe làm mất persona?",
             want_recall=True, expect_any=[r"pxpipe|persona|nén"]),
    ]),

    # ══════════ CATEGORY T — CÂU HỎI TRÍ NHỚ NGẮN GỌN ══════════
    dict(id="T1", cat="T", desc="'m nhớ Lucy ko?' — cực ngắn nhưng là hỏi trí nhớ", turns=[
        dict(say="m nhớ vụ fitcity ko?", want_recall=True, expect_any=[r"fitcity|crash|preview"]),
    ]),
    dict(id="T2", cat="T", desc="'đã chốt gì?' — ngắn, cần trí nhớ", turns=[
        dict(say="hôm trước đã chốt gì về engine?", want_recall=True, expect_any=[r"persist|sdk|engine"]),
    ]),
    dict(id="T3", cat="T", desc="'lần trước?' — quá ngắn, phải hỏi lại chứ đừng bịa", turns=[
        dict(say="lần trước sao ấy nhỉ?", must_ask=True),
    ]),

    # ══════════ CATEGORY R — THAM CHIẾU DO LUCY TẠO, phải sống sót qua XOAY VÒNG PHIÊN ══════════
    # rotate_after=<index lượt>: harness ép xoay vòng NGAY SAU lượt đó (transcript cũ bị bỏ).
    # Đây là chỗ Phase 2 yếu: nối mạch chỉ mang câu của CHỦ NHÂN, không mang thứ LUCY vừa nói.
    dict(id="R1", cat="R", desc="option do Lucy liệt kê, hỏi lại sau khi xoay vòng", rotate_after=0, turns=[
        dict(say="Cho t đúng 3 lựa chọn ngắn để tăng tốc recall, đánh số 1 2 3, mỗi cái 1 dòng."),
        dict(say="option 2 đi", no_tools=True, expect_any=[r"[\wÀ-ỹ]+(\s+[\wÀ-ỹ]+){6,}"]),
    ]),
    dict(id="R2", cat="R", desc="đường dẫn vừa chốt trong hội thoại, hỏi lại sau khi xoay vòng", rotate_after=0, turns=[
        dict(say="Bug nằm ở file /root/lucy/bridge/lucy_bridge.py nhé, nhớ giùm t. Xác nhận 1 câu thôi."),
        dict(say="file đó tên gì ấy nhỉ?", expect_ref=[r"lucy_bridge"], no_tools=True),
    ]),
    dict(id="R3", cat="R", desc="danh sách đánh số của Lucy, 'con trên cùng' sau xoay vòng", rotate_after=0, turns=[
        dict(say="Liệt kê đúng 3 nguyên nhân làm Lucy chậm, đánh số 1 2 3, mỗi cái 1 dòng ngắn."),
        dict(say="con trên cùng ấy, nói kỹ hơn tí", no_tools=True, expect_any=[r"[\wÀ-ỹ]+(\s+[\wÀ-ỹ]+){8,}"]),
    ]),

    # ══════════ CATEGORY C — sửa lời khi Lucy đang trả lời (interrupt) — chạy riêng ══════════
    dict(id="C1", cat="C", mode="execute", desc="ngắt giữa câu trả lời dài rồi đổi ý", interrupt=True, turns=[
        dict(say="Viết cho t 1 bài dài 600 từ về lịch sử ngành game Việt Nam."),
        dict(say="thôi khỏi, nói ngắn 1 câu về thời tiết Sài Gòn thôi", expect_any=[r"sài gòn|nắng|mưa|nóng"],
             forbid=[r"lịch sử ngành game"]),
    ]),
]


def scenario_count():
    return len(SCENARIOS), sum(len(s["turns"]) for s in SCENARIOS)


if __name__ == "__main__":
    n, t = scenario_count()
    from collections import Counter
    c = Counter(s["cat"] for s in SCENARIOS)
    print(f"{n} scenario · {t} lượt · theo nhóm: {dict(sorted(c.items()))}")
