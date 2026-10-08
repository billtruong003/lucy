# Lucy — Remote Control & In-House Agent Dev (kiến trúc)

> **Chốt 2026-06-07.** Máy LOCAL = nơi host **multi-agent `claude -p` toàn quyền** + dev project (Unity…).
> VPS = **não/hub/relay** always-on. Bill điều khiển + xem **từ mọi thiết bị, mọi nơi** (đth/laptop/desktop/web).
> Tất cả **in-house, tận dụng lib open-source** — KHÔNG app SaaS ngoài (chậm vì relay chung + phải trả VIP).
>
> Doc này thay cho cụm kiến trúc Hermes cũ ([`_outdated/`](_outdated/)). Tầm nhìn tổng: [VISION_2026.md](_outdated/VISION_2026.md).
> Mọi lựa chọn dưới đây neo vào **deep-research 2026-06-07** (23 nguồn · 25 claim verify adversarial) — nguồn cuối doc.

---

## 0. Một câu

Local Windows **quay ra** nối VPS qua một **mạng overlay WireGuard** (Headscale). Trên đường đó chạy 3 thứ:
**(1)** full remote desktop low-latency (Sunshine + Moonlight), **(2)** web terminal xem/lái agent (xterm.js),
**(3)** coordinator↔worker dispatch `claude -p`. Bill vào bằng **bất kỳ thiết bị nào**: Telegram / web dashboard / Moonlight native / app Tauri.

---

## 1. Bài toán & ràng buộc

| Ràng buộc | Hệ quả thiết kế |
|---|---|
| Local Windows **sau NAT / IP đổi** | Local **không nhận inbound** → phải **chủ động quay ra** VPS (IP cố định). |
| VPS nhỏ (~2GB Vietnix) | VPS làm **signaling + control + relay fallback**, KHÔNG gánh stream nếu P2P được. |
| "Ở đâu cũng vào được" | Đa mặt tiền: Telegram (đth) · web (laptop) · native app/Moonlight (desktop) · remote-control nhúng web. |
| **In-house, tận dụng lib** | Ưu tiên deploy project open-source self-host; chỗ nào thiếu thì **glue code trong hub/ sẵn có** (Express+React). |
| Agent **toàn quyền máy** | Bảo mật là tối thượng (tầng 5) — đây là cửa điều khiển nguyên cái máy. |

**Nền sẵn có (tái dùng, không bỏ):** [hub/server/src/index.ts](../hub/server/src/index.ts) (Express, engine `claude -p`, 2FA TOTP, jobs, telemetry) · [bridge/lucy_bridge.py](../bridge/lucy_bridge.py) (Telegram) · React/Vite frontend.

---

## 2. Kiến trúc 6 tầng

```
        📱 Telegram(đth)    🌐 Web dashboard(laptop)   🖥️ Moonlight/Tauri(desktop)
              │                      │                          │
   ┌──────────▼──────────────────────▼──────────────────────────▼──── VPS (não·hub·relay, IP cố định) ──┐
   │  • Telegram bridge          • Web hub (Express+React)      • Coordinator: job queue + worker registry │
   │  • Headscale control (overlay WireGuard)   • coturn (TURN relay — fallback khi P2P fail)              │
   └───────────────────────────────────────▲───────────────────────────┬─────────────────────────────────┘
              overlay WireGuard (local QUAY RA, P2P khi được)           │ kết quả/stream/màn hình ▲   job ▼
   ┌───────────────────────────────────────┴───────────────────────────▼──── MÁY LOCAL (Windows, có GPU) ─┐
   │  T1 Desktop:  Sunshine (encode GPU)  ──► Moonlight native / moonlight-web-stream(WebRTC) ──► browser  │
   │  T2 Terminal: node-pty  ──► xterm.js (xem/lái claude -p live)                                         │
   │  T3 Worker:   quay ra giữ WebSocket ──► nhận job ──► claude -p (toàn quyền) ──► stream về             │
   │  + multi-agent fleet (/fan /orch /auto) + project dev (Unity…)                                        │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────┘

   Tầng xuyên suốt:  T0 Transport/NAT (overlay+TURN)   ·   T5 Security (E2E + 2FA + ACL + audit)
```

| Tầng | Vai trò | Lib/Project chốt |
|---|---|---|
| **T0 Transport/NAT** | đường đi low-latency qua NAT | **Headscale** (overlay WireGuard self-host) + **coturn** (TURN fallback) |
| **T1 Full desktop** | màn hình + chuột + phím, trễ thấp | **Sunshine** (host, encode GPU) + **Moonlight** (native) + **moonlight-web-stream** (browser) |
| **T2 Web terminal** | xem/lái agent live trong web | **xterm.js** + **node-pty** + **ws** (glue trong hub) |
| **T3 Coordinator/Worker** | VPS giao job → local chạy `claude -p` | WebSocket worker quay-ra + job queue (glue, pattern Inngest Connect) |
| **T4 Mặt tiền đa thiết bị** | ở đâu cũng vào | Telegram bridge · Web hub · **Tauri** (app desktop bọc hub) |
| **T5 Bảo mật** | khoá cửa điều khiển toàn máy | WireGuard E2E + TOTP 2FA (hub đã có) + Headscale ACL + audit log |

---

## 3. T1 — Full remote desktop (phần khó & quyết định chính)

### Phát hiện then chốt: host **Windows** loại gần hết option WebRTC-browser
Mấy project WebRTC-HTML5 đẹp nhất **chỉ chạy host Linux** → KHÔNG stream được desktop Windows thật:

| Project | Browser-native | Host Windows? | Ghi chú |
|---|---|---|---|
| **Sunshine + Moonlight** | qua bridge | ✅ **Có** (NVENC + AMD AMF + Intel QuickSync) | ⭐ **duy nhất** self-host + low-latency + hardware-encode + native Windows |
| Selkies-GStreamer | ✅ (clientless) | ❌ chỉ Linux X11 | đẹp nhất về browser design, nhưng sai host |
| Neko | ✅ (WebRTC <300ms) | ❌ chỉ Linux container | desktop ảo trong Docker |
| KasmVNC | ✅ (WebRTC UDP) | ❌ chỉ Linux | clientless |
| RustDesk / MeshCentral / Guacamole / noVNC | (tuỳ) | (RustDesk có) | ⚠️ research **không verify được** — lỗ hổng coverage, cần đào riêng |

→ **Chốt T1 = Sunshine** ([github](https://github.com/LizardByte/Sunshine)) làm host trên Windows, encode bằng GPU.
- **Desktop (trễ thấp NHẤT):** client **Moonlight native** — giao thức UDP tối ưu input→photon.
- **Browser/đth (ở đâu cũng vào):** **moonlight-web-stream** ([github](https://github.com/MrCreativ3001/moonlight-web-stream)) — WebRTC + WebCodecs, fallback WebSocket, nhúng thẳng dashboard.
- **Một host Sunshine phục vụ CẢ HAI** → không phải chọn.

### WebRTC vs native — độ trễ (trả lời câu hỏi của Bill)
```
THẤP NHẤT  Moonlight native (UDP custom + hardware encode)        ~10–30ms LAN
   ↓       WebRTC browser (moonlight-web-stream / Selkies)        sát nút, chậm vài ms (decode/jitter browser)
   ↓       ──────────────────────────────────────────────
CAO/GIẬT   VNC/RDP qua WebSocket (noVNC, Guacamole)               TCP + framebuffer, KHÔNG hardware codec
```
Trục trễ là **codec + đường mạng**, KHÔNG phải browser-vs-app. WebRTC **là** câu trả lời low-latency cho web (Stadia/GeForce-NOW chạy WebRTC). Native chỉ nhỉnh vài ms.

> ⚠️ moonlight-web-stream **unofficial, 1 maintainer** → rủi ro cho hệ toàn-quyền-máy. Cách xử: **Moonlight native làm chính**; browser-bridge là tiện ích và vì open-source → **fork về tự own** (đúng tinh thần in-house).

---

## 4. T0 — Transport / NAT (nền cho mọi tầng)

**Chốt = overlay WireGuard self-host (Headscale) + coturn fallback.**
- **Tailscale/Headscale** đạt **P2P trực tiếp >90%** ca thường, chỉ relay khi cần → giữ trễ thấp + WireGuard mã hoá sẵn ([nguồn](https://tailscale.com/blog/nat-traversal-improvements-pt-1)). **Headscale** = control-plane self-host → in-house, không phụ thuộc Tailscale cloud.
- Local **quay ra** nối overlay → mọi thiết bị Bill + VPS + local thành "**LAN ảo**". Moonlight/terminal/worker đều chạy trên đó như mạng nội bộ.
- **NAT đối xứng kép** (CGNAT 4G/mạng khách sạn) **buộc relay** → **bắt buộc tự host coturn** trên VPS làm fallback.
- Reverse tunnel (rathole/frp) hợp topology quay-ra nhưng **không giảm trễ stream** → chỉ dùng cho control-plane/dự phòng, không thay WebRTC/overlay cho stream desktop.

---

## 5. T2 — Web terminal (xem/lái agent live)

`xterm.js` (React) ↔ `ws` ↔ `node-pty` (local) — **glue code trong hub**, không deploy project ngoài.
- [sshx](https://github.com/ekzhang/sshx) đúng mô hình "quay-ra share terminal" **nhưng KHÔNG hỗ trợ self-host** → chỉ mượn ý tưởng, không xài nguyên.
- Stream stdout của job `claude -p` dài về dashboard real-time (đã có nền job/poll ở [index.ts](../hub/server/src/index.ts)).

---

## 6. T3 — Coordinator (VPS) ↔ Worker (local)

**Pattern bền = worker quay-ra giữ WebSocket** (kiểu [Inngest Connect](https://www.inngest.com/docs/setup/connect)): worker xin URL gateway qua HTTP → dial out → giữ WS bền → nhận job → chạy → stream về. Không cần inbound.

```
Worker(local) ──HELLO{id,caps,token}──► Coordinator(VPS)   ; heartbeat 15s
Coordinator  ──JOB{prompt,model,cwd}──► Worker             ; route nhẹ→VPS-claude, nặng→local
Worker       ──LOG{chunk}… DONE{result,session,cost}──► Coordinator(persist) ──► UI/Telegram
```
- **State (queue/jobs/logs/cost) ở VPS** → nguồn sự thật duy nhất, "VPS luôn biết".
- Worker offline → job `lost`/re-lease, router fallback. Multi-worker = cắm thêm là native.
- Tái dùng `runClaude` + jobs sẵn trong hub; tách vai: state/UI/router ở VPS, `claude -p` + report ở local.

---

## 7. T4 — Mặt tiền đa thiết bị

| Thiết bị | Đường vào | Dùng khi |
|---|---|---|
| 📱 Điện thoại | **Telegram bot** (đã có bridge) | ra lệnh nhanh ở bất kỳ đâu, chỉ cần Telegram |
| 💻 Laptop | **Web dashboard** (hub) — chat + terminal + desktop nhúng | làm việc đầy đủ qua browser |
| 🖥️ Desktop | **Moonlight native** (trễ thấp nhất) hoặc **app Tauri** bọc hub | điều khiển desktop mượt nhất |
| 🌐 Bất kỳ | remote-control nhúng thẳng dashboard (moonlight-web-stream) | máy lạ, không cài gì |

> App desktop = **Tauri** (nhẹ hơn Electron) bọc cùng web hub → 1 codebase, không nuôi 2 UI.

---

## 8. T5 — Bảo mật (⚠️ research chưa phủ — thiết kế từ đầu)

Hệ này trao **toàn quyền điều khiển nguyên máy chạy agent bypassPermissions** → bề mặt nguy hiểm nhất. Bắt buộc:

| Lớp | Cách | Trạng thái |
|---|---|---|
| **Kênh mã hoá** | WireGuard E2E (sẵn từ overlay Headscale) | từ T0 |
| **Xác thực** | mật khẩu + **TOTP 2FA** | ✅ hub đã có ([index.ts:115-155](../hub/server/src/index.ts#L115)) |
| **Allowlist thiết bị** | Headscale ACL (chỉ node của Bill) + khoá Telegram user ID | cần thêm |
| **Phân quyền lệnh** | gate desktop-control & worker-dispatch sau 2FA; cron auto-deny lệnh nguy hiểm | cần thêm |
| **Audit** | log mọi phiên desktop / job / lệnh (đã có ring-buffer log ở hub) | mở rộng |
| **Secret** | chỉ trên box, không paste chat (kỷ luật README) | giữ |

> Không bao giờ mở cổng desktop/worker ra internet **không qua overlay + 2FA**. Sunshine có PIN pairing riêng — bật.

---

## 9. Build phases (đừng làm 1 phát)

| Phase | Làm gì | Dep |
|---|---|---|
| **R0** | T0: Headscale trên VPS + node local quay ra + coturn fallback. Smoke: ping overlay 2 chiều. | — |
| **R1** | T3: worker local quay ra hub VPS + job queue + heartbeat (tách `runClaude` thành worker). | R0 |
| **R2** | T2: xterm.js trong dashboard xem/lái `claude -p` live qua worker. | R1 |
| **R3** | T1: Sunshine trên Windows + Moonlight native qua overlay. Smoke: điều khiển desktop trễ thấp. | R0 |
| **R4** | T1-web: nhúng moonlight-web-stream (fork) vào dashboard → desktop trong browser/đth. | R3 |
| **R5** | T4: app Tauri bọc hub + hoàn thiện Telegram lệnh. | R1-R4 |
| **R6** | T5: ACL + audit + gate đầy đủ + hardening. | tất cả |

R1+R2 (terminal/agent) cho giá trị ngay & dễ; R3+ (desktop) là phần "wow" làm sau.

---

## 10. Open decisions / caveat (cần Bill chốt / canh)

- [ ] **GPU local?** Sunshine cần GPU encode — xác nhận máy dev Unity có (NVIDIA NVENC / AMD AMF / Intel QSV).
- [ ] **VPS relay đủ không?** coturn relay stream desktop bitrate cao có thể quá **2GB Vietnix** → cân nâng box relay (chỉ ăn băng thông khi P2P fail).
- [ ] **Đào lỗ hổng coverage:** RustDesk self-host (hbbs/hbbr, native-Windows + 2FA sẵn) vs Sunshine — research chưa verify, đáng so 1 vòng trước R3.
- [ ] **moonlight-web-stream** unofficial → quyết: fork-own ngay, hay R4 để sau (Moonlight native trước).
- [ ] Telegram bridge hiện gửi thẳng `claude -p` — sẽ đổi thành **enqueue vào coordinator** (T3) để mọi mặt tiền chung 1 state.

---

## 11. References

**Research 2026-06-07 (verify adversarial):** Sunshine [github.com/LizardByte/Sunshine](https://github.com/LizardByte/Sunshine) · moonlight-web-stream [github.com/MrCreativ3001/moonlight-web-stream](https://github.com/MrCreativ3001/moonlight-web-stream) · Selkies [github.com/selkies-project/selkies-gstreamer](https://github.com/selkies-project/selkies-gstreamer) · Neko [github.com/m1k1o/neko](https://github.com/m1k1o/neko) · KasmVNC [github.com/kasmtech/KasmVNC](https://github.com/kasmtech/KasmVNC) · NAT traversal [tailscale.com/blog/nat-traversal-improvements-pt-1](https://tailscale.com/blog/nat-traversal-improvements-pt-1) · rathole [github.com/rathole-org/rathole](https://github.com/rathole-org/rathole) · sshx [github.com/ekzhang/sshx](https://github.com/ekzhang/sshx) · Inngest Connect [inngest.com/docs/setup/connect](https://www.inngest.com/docs/setup/connect) · xterm.js [github.com/xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) · Tauri vs Electron [gethopp.app/blog/tauri-vs-electron](https://www.gethopp.app/blog/tauri-vs-electron)

**Nội bộ:** [VISION_2026.md](_outdated/VISION_2026.md) · hub [../hub/server/src/index.ts](../hub/server/src/index.ts) · bridge [../bridge/lucy_bridge.py](../bridge/lucy_bridge.py) · kiến trúc Hermes cũ (bỏ) [_outdated/](_outdated/)
