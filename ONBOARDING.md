# ONBOARDING — efin Refresh Token Tester

คู่มือพาเข้าโปรเจกต์ + บันทึกการสร้าง (handoff) เปิดไฟล์นี้ใน Claude Code เพื่อทำงาน/พัฒนาต่อจากจุดล่าสุดได้ทันที

---

## 1. โปรเจกต์นี้ทำอะไร

ทดสอบ **refresh token** ของ efin.finance แบบอัตโนมัติด้วย Playwright (Node.js)

flow เต็ม:
1. เลือกโหมด (1-4) ใน terminal
2. login (2 ขั้น) + เริ่มจับเวลา
3. เปิดหน้าโหมด → เก็บ cookie `SSIDI` (token1)
4. เปิด **jwt.io** วาง SSIDI → อ่าน `exp`/`iat`
5. ยิง API ทุก column พร้อมกันด้วย token สด → ต้องได้ **DATA (200)**
6. รอจน `exp` หมด (auto countdown)
7. เก็บ SSIDI อีกครั้ง (token2) **โดยไม่ refresh หน้า**
8. ยิง API ด้วย token ที่หมดอายุ → ต้องได้ **`Authentication failed. Token is not valid.`** → หยุดเวลา
9. ค้างจอให้กดเล่น → กด ENTER → สร้าง **report HTML**

report: เทียบ token เก่า/ใหม่ + เวลาใช้งาน (เกณฑ์ < 15 นาที) + ตารางสถานะ API ก่อน/หลังหมดอายุ พร้อมเวลายิงแต่ละครั้ง

---

## 2. รันยังไง

```bash
npm install
npx playwright install chromium      # ครั้งแรก
copy .env.example .env               # ใส่ EFIN_EMAIL / EFIN_PASSWORD
npm start
```

---

## 3. ข้อเท็จจริงสำคัญ (verify กับ site จริงแล้ว — อย่าเดาใหม่)

ส่วนนี้คือ "ความรู้ที่เทรนมาแล้ว" — ค่าที่ได้จากการลองจริงกับเว็บ ไม่ใช่เดา

- **token ที่ API รับ** = cookie `SSIDI` บน domain **`dc3hw.efin.finance`** (อายุ ~15 นาที)
  - มี `SSIDI` บน `www.efin.finance` ด้วย (อายุ 24h) แต่ยิง API → **401** → ห้ามใช้
  - `SSIDII` (double-I) = refresh token (24h) ไม่ใช่ตัวยิง API
  - `extractSSIDI` ให้คะแนนเลือกตาม domain หน้าโหมด + ชื่อ exact "SSIDI"
- **login 2 ขั้น**: `#emailOrPhone` → ปุ่ม `#login_next_btn` ("ต่อไป") → `#password` → `#login_submit_btn` ("ยืนยัน")
  - ปุ่ม disabled จนกว่าจะ **พิมพ์จริง** → ใช้ `pressSequentially` ไม่ใช่ `fill` (ดู `typeUntilEnabled`)
- **exp/iat อ่านผ่าน jwt.io จริง** (ตาม spec) ไม่ decode local — `src/jwtio.js`
- **token2 เก็บโดยไม่ refresh หน้า** — อ่าน cookie ปัจจุบันตรงๆ เพื่อดูว่าระบบ refresh เองไหม
- **readline ใช้ instance เดียวตลอด** — สร้าง/ปิดใหม่ทุกครั้งทำ stdin ค้างบน Windows (ENTER ไม่ตอบสนอง) แก้ด้วย shared `rl` + `rl.once('line')`

---

## 3.5 โหมดที่มีตอนนี้ + วิธีเพิ่มโหมด

**ตอนนี้มีโหมด 1-8 แล้ว** (โหมดถัดไป = 9):

| โหมด | ชื่อ | type | columns / endpoints |
|---|---|---|---|
| 1 | หน้าอ่านข่าว stock | stock | latest, popular |
| 2 | หน้าอ่านข่าว crypto | crypto | latest, popular |
| 3 | หน้าหลักคริปโต | crypto | 21 columns |
| 4 | หน้าหลักหุ้น | stock | 29 columns |
| 5 | หน้า home | stock | latest, popular |
| 6 | หน้าหุ้น dr รายตัว | stock | 4 endpoints เต็ม |
| 7 | หน้าหลักหุ้น dr | stock | 3 endpoints เต็ม |
| 8 | หน้า search result | stock | 1 endpoint POST + JSON body |

> endpoint รองรับ POST ผ่าน field `method: 'POST'` + `body: {...}` (ดูโหมด 8) — `fireUrl` ใส่ Content-Type + stringify ให้

> หมายเหตุ: endpoint host `sit-api-efincontent` ใช้ token จาก dc3hw ไม่ได้ (401 คนละ env) — สลับเป็น `dc3-api-efincontent` แทน (โหมด 6, 7)

> โหมด 6 ใช้ `endpoints: [{label, url}]` (ยิง API หลาย path/หลายแบบ) แทน `columns` — รองรับใน `fireMode`

**วิธีเพิ่มโหมดใหม่ (ง่ายๆ):** แก้ที่ `MODES` ใน `config.js`
1. ก็อป block โหมดเดิม 1 อัน เปลี่ยนเลขนำหน้าเป็นเลขถัดไป (เช่น `5:`)
2. แก้ 4 ค่า: `name` (ชื่อ), `type` (`stock`/`crypto`), `page` (URL เก็บ SSIDI), `columns` (list)
3. save → `npm start` → เมนูมีโหมดใหม่อัตโนมัติ

> ถ้าให้ Claude ทำให้: มันจะเด้ง popup ถามข้อมูล 4 ค่านี้ก่อน แล้วเพิ่มให้เอง (ดู playbook ใน `CLAUDE.md`)

API เส้นจริง = `${API_BASE}/${type}/latest/${column}?limit=5&lang=th`

## 4. โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `config.js` | creds (จาก .env), URL, นิยามโหมด 1-4 + columns |
| `src/jwt.js` | format unix time |
| `src/jwtio.js` | อ่าน exp/iat ผ่านเว็บ jwt.io |
| `src/api.js` | ยิง API + classify + เก็บ firedAt |
| `src/browser.js` | login 2 ขั้น, เปิดหน้าโหมด, เก็บ SSIDI |
| `src/report.js` | สร้าง report HTML |
| `src/main.js` | orchestrator + timer + countdown + เมนู |

---

## 5. ประวัติการสร้าง (เทรนมาถึงไหนแล้ว)

ลำดับที่ทำไป — อ่านเพื่อเข้าใจว่าทำไมโค้ดเป็นแบบนี้:

1. **โครงเริ่มต้น** — เลือก Node.js + Playwright, terminal menu, auto-wait expiry
2. **เจอ login 2 ขั้น** — ตอนแรกคิดว่ากรอก email+password พร้อมกัน แต่จริงๆ ต้องกรอก email → "ต่อไป" → password โผล่ → "ยืนยัน"
3. **เจอปุ่ม disabled** — `fill()` ไม่ trigger React validation ปุ่มไม่ enable → เปลี่ยนเป็น `pressSequentially` + รอ enabled + retry
4. **เจอ token ผิด domain** — `SSIDI` บน www (24h) ยิง 401, ต้องใช้ของ dc3hw (15min) → แก้ `extractSSIDI` ให้เลือกตาม domain
5. **อ่าน exp ผ่าน jwt.io จริง** — user ขอให้ผ่านเว็บ jwt.io ไม่ decode เอง → เพิ่ม `src/jwtio.js`
6. **เปลี่ยน login URL** → `dc3hw.efin.finance/th/login`
7. **โชว์ data ใน terminal** — เพิ่ม snippet body + dataCount (นับ array ซ้อนใน `data.news`)
8. **ไม่ refresh ตอนเก็บ token2** + **แก้ ENTER ค้าง** (shared readline)
9. **เพิ่มเวลายิง API** — `firedAt` + 2 คอลัมน์ในตาราง report
10. **ย้าย creds → .env + git init + CLAUDE.md** (commit `73119ca`, `3527b58`)

---

## 6. ทำงานต่อยังไง (สำหรับคนที่มารับช่วง)

- เปิด repo นี้ใน **Claude Code** → Claude อ่าน `CLAUDE.md` + ไฟล์นี้ได้ context ครบ คุยต่อได้เลย
- **แก้ไขสดๆ พร้อมกัน**: VS Code **Live Share** (`ms-vsliveshare.vsliveshare`) — host แชร์ invite link
- ถ้า login/decode พัง → เว็บอาจ update selector เช็ก `src/browser.js` / `src/jwtio.js` ก่อน

### งานที่อาจทำต่อ (ideas)
- รันหลายโหมดต่อเนื่องในรอบเดียว
- export report เป็น PDF / รวมหลายรอบ
- แจ้งเตือน (LINE/Slack) เมื่อเจอ FAIL
- CI: รัน headless ตามเวลา + เก็บ report เป็น artifact

---

## 7. ข้อควรระวัง

- **อย่า commit `.env`** (gitignore ไว้แล้ว) — credentials อยู่ในนั้น
- โหมด 4 spec เขียนหน้าเป็น `/th/crypto` (พิมพ์ผิด) — โค้ดใช้ `/th/stock`
- repo นี้ยิง internal API → ถ้า push GitHub ควรเป็น **private repo**
