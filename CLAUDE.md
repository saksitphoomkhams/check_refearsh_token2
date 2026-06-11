# CLAUDE.md

แนวทางสำหรับ Claude Code เวลาทำงานกับ repo นี้

## โปรเจกต์นี้คืออะไร

ระบบทดสอบ **refresh token** ของ efin.finance ผ่าน Playwright (Node.js)
flow: login → เก็บ SSIDI → อ่าน exp ผ่าน jwt.io → ยิง API (token สด) → รอ token หมดอายุ → ยิงซ้ำ (token หมดอายุ) → สร้าง report HTML เทียบผล

## คำสั่ง

```bash
npm install                          # ติดตั้ง deps
npx playwright install chromium      # ติดตั้ง browser (ครั้งแรก)
npm start                            # รัน (โหลด .env อัตโนมัติ)
```

## ข้อเท็จจริงสำคัญ (verify กับ site จริงแล้ว — อย่าเดาใหม่)

- **token ที่ API รับ** = cookie ชื่อ `SSIDI` บน domain **`dc3hw.efin.finance`** (อายุ ~15 นาที)
  - มี `SSIDI` บน `www.efin.finance` ด้วย (อายุ 24h) แต่ยิง API → **401** อย่าใช้
  - `SSIDII` (double-I) = refresh token (24h) ไม่ใช่ตัวยิง API
  - `extractSSIDI` เลือกตาม domain ของหน้าโหมด + ชื่อ exact "SSIDI"
- **login เป็น 2 ขั้น**: `#emailOrPhone` → ปุ่ม "ต่อไป" (`#login_next_btn`) → `#password` → ปุ่ม "ยืนยัน" (`#login_submit_btn`)
  - ปุ่ม disabled จนกว่าจะ **พิมพ์จริง** → ต้องใช้ `pressSequentially` (ไม่ใช่ `fill`) ดู `typeUntilEnabled`
- **exp/iat อ่านผ่าน jwt.io จริง** (ตาม spec) ไม่ decode เอง — ดู `src/jwtio.js`
- **token2 (หลังหมดอายุ) เก็บโดยไม่ refresh หน้า** — อ่าน cookie ปัจจุบันตรงๆ เพื่อดูว่าระบบ refresh เองไหม
- **readline ต้องใช้ instance เดียวตลอด** — สร้าง/ปิดใหม่ทุกครั้งทำ stdin ค้างบน Windows (กด ENTER ไม่ตอบสนอง)

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `config.js` | creds (จาก .env), URL, นิยามโหมด 1-4 + columns |
| `src/jwt.js` | format unix time (decodeJwt สำรอง) |
| `src/jwtio.js` | อ่าน exp/iat ผ่านเว็บ jwt.io |
| `src/api.js` | ยิง API + classify (DATA / TOKEN_INVALID / OTHER) + firedAt |
| `src/browser.js` | login 2 ขั้น, เปิดหน้าโหมด, เก็บ SSIDI |
| `src/report.js` | สร้าง report HTML (เทียบ token + ตารางสถานะ API + เวลายิง) |
| `src/main.js` | orchestrator + timer + countdown + เมนู |

## เกณฑ์ที่ report ตรวจ

1. token1 vs token2 เหมือน/ไม่เหมือน + เวลา token ใช้ได้ (login→exp) ต้อง < 15 นาที
2. ตารางต่อ column: ก่อนหมดอายุ = DATA, หลังหมดอายุ = TOKEN_INVALID + เวลายิงทั้ง 2 ครั้ง

## ข้อควรระวัง

- **อย่า commit `.env`** (มี credentials) — gitignore ไว้แล้ว
- โหมด 4 spec เขียนหน้าเป็น `/th/crypto` (พิมพ์ผิด) — โค้ดใช้ `/th/stock`
- selector ของ efin/jwt.io อาจเปลี่ยนเมื่อเว็บ update — ถ้า login/decode พัง เช็ก selector ใน `browser.js` / `jwtio.js` ก่อน

## ⭐ เพิ่มโหมดใหม่ (playbook บังคับ)

**เมื่อ user ขอเพิ่มโหมด (หรือเอ่ยถึงการเพิ่มหน้า/โหมดตรวจใหม่) ให้ทำตามนี้เสมอ:**

ขั้น 1 — **เด้ง popup ถามข้อมูลก่อน** ด้วยเครื่องมือ `AskUserQuestion` เก็บ field ให้ครบ:

| field | คำอธิบาย | ตัวอย่าง |
|---|---|---|
| `key` | หมายเลขโหมด (ถัดจากล่าสุด) | `5` |
| `name` | ชื่อโหมด | `หน้าอ่านข่าว gold` |
| `type` | **stock** หรือ **crypto** (กำหนด path ของ API) | `stock` |
| `page` | URL หน้าที่ใช้ตรวจ (เก็บ SSIDI) | `https://dc3hw.efin.finance/th/...` |
| `columns` | รายชื่อ column (คั่นด้วย comma) ยิงทุกตัวพร้อมกัน | `latest, popular` |

- `type` ให้ทำเป็นตัวเลือก (stock/crypto) ใน popup
- `name` / `page` / `columns` เป็น free-text — รับผ่านช่อง "Other"/notes หรือถามเพิ่มถ้ายังไม่ครบ
- ถ้าข้อมูลไม่ครบ ห้ามเดา — ถามจนครบ

ขั้น 2 — **เพิ่ม entry ลง `MODES` ใน `config.js`** ตาม schema เดิม:
```js
5: {
  name: '<name>',
  type: '<stock|crypto>',
  page: '<page url>',
  columns: ['<col1>', '<col2>', ...],   // trim ช่องว่างออก
},
```

ขั้น 3 — **verify**: API เส้นจริง = `${API_BASE}/${type}/latest/${column}?limit=5&lang=th`
ถ้าทำได้ ลองยิง 1 column ด้วย token สดเพื่อเช็กว่า column ใช้ได้จริง (คาด DATA 200)

## ภาษา

ตอบ/คอมเมนต์เป็นไทยกระชับ เก็บ technical term เป็น English. โค้ดคอมเมนต์ทุกฟังก์ชัน
