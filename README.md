# ระบบทดสอบ Refresh Token — efin.finance

ทดสอบว่า access token (SSIDI) หมดอายุตามเวลา และหลังหมดอายุ API ปฏิเสธจริง โดยอัตโนมัติด้วย Playwright

## ใช้งาน

```bash
npm install                          # ติดตั้ง deps
npx playwright install chromium      # ติดตั้ง browser (ครั้งแรก)
copy .env.example .env               # Windows (Mac/Linux: cp) แล้วใส่ EFIN_EMAIL / EFIN_PASSWORD
npm start                            # รัน (โหลด .env อัตโนมัติ)
```

จะมีเมนูให้เลือกโหมด 1-4 ใน terminal

## แชร์งาน / collaborate

- **แก้ไขสดๆ ร่วมกัน**: ใช้ VS Code **Live Share** (`ms-vsliveshare.vsliveshare`) — host กด Live Share → ส่ง invite link → เพื่อน join เห็น cursor/แก้ไข real-time + shared terminal
- **เก็บประวัติ / สำรอง**: push ขึ้น GitHub (private repo แนะนำ เพราะยิง internal API). `.env` ถูก gitignore — เพื่อนต้องสร้าง `.env` เองจาก `.env.example`

## Flow การทำงาน

1. เลือกโหมด (terminal menu)
2. login เข้า efin.finance (แบบ 2 ขั้น: กรอก email → "ต่อไป" → กรอก password → "ยืนยัน") + **เริ่มจับเวลา**
3. เปิดหน้าโหมด → เก็บ **SSIDI** (token1) → เปิด **jwt.io** วาง SSIDI อ่าน `exp`/`iat` (ตาม spec — ไม่ decode เอง)
4. ยิง API ทุก column พร้อมกันด้วย token สด → ต้องได้ **DATA (HTTP 200)**
5. รอจนถึงเวลา `exp` อัตโนมัติ (มี countdown ใน terminal)
6. เปิดหน้าโหมดอีกครั้ง → เก็บ SSIDI (token2) เพื่อเทียบ
7. ยิง API ทุก column ด้วย token1 (หมดอายุแล้ว) → ต้องได้ **`Authentication failed. Token is not valid.`** → หยุดจับเวลา
8. ค้างจอให้กดเล่นได้ → กด **ENTER** → สร้าง **report HTML** (เปิดอัตโนมัติ)

## Report (โฟลเดอร์ `reports/`)

1. **เทียบ token เก่า/ใหม่** — token1 vs token2 เหมือน/ไม่เหมือน (ไม่เหมือน = มี refresh), เวลาที่ใช้ก่อนหมดอายุ + เกณฑ์ < 15 นาที
2. **ตารางสถานะ API** — แต่ละ column: ผลก่อนหมดอายุ (คาด DATA) / หลังหมดอายุ (คาด TOKEN_INVALID)

## หมายเหตุสำคัญ (จากการทดสอบจริง)

- **token ที่ API รับ** คือ cookie ชื่อ `SSIDI` บน domain **`dc3hw.efin.finance`** (อายุ ~15 นาที)
  - มี cookie `SSIDI` บน `www.efin.finance` ด้วย (อายุ 24 ชม.) แต่ยิง API แล้ว **401** — ระบบเลือก domain ให้อัตโนมัติแล้ว
  - cookie `SSIDII` (double-I) คือ refresh token (อายุ 24 ชม.) — ไม่ใช่ตัวยิง API
- decode JWT ทำ local (เทียบเท่า jwt.io) — ไม่ต้องเปิด jwt.io จริง
- โหมด 4 spec ระบุหน้าเป็น `/th/crypto` (น่าจะพิมพ์ผิด) — โค้ดใช้ `/th/stock`

## โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `config.js` | credentials, URL, นิยามโหมด 1-4 + columns |
| `src/jwt.js` | decode JWT หา exp/iat |
| `src/api.js` | ยิง API + classify (DATA / TOKEN_INVALID / OTHER) |
| `src/browser.js` | login, เปิดหน้าโหมด, เก็บ SSIDI |
| `src/report.js` | สร้าง report HTML |
| `src/main.js` | orchestrator + timer + countdown + เมนู |
