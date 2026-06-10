// ============================================================================
// src/browser.js
// ควบคุม browser ด้วย Playwright:
// - เปิด browser แบบ headed (ให้ผู้ใช้เห็น/กดเล่นได้)
// - login เข้า efin.finance
// - เปิดหน้าโหมด แล้วเก็บค่า SSIDI จาก cookie/localStorage/sessionStorage
// ============================================================================

const { chromium } = require('playwright');
const { CREDENTIALS, LOGIN_URL, TOKEN_KEY_PATTERN } = require('../config');

/**
 * launchBrowser — เปิด Chromium แบบ headed + context ใหม่
 * headed = false ไม่ใช้ เพราะ spec ต้องการให้ค้างจอกดเล่นได้
 * @returns {Promise<{browser, context, page}>}
 */
async function launchBrowser() {
  const browser = await chromium.launch({
    headless: false,        // ให้เห็นหน้าจอจริง
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * dismissPopups — ปิด popup consent/cookie ที่อาจบังช่องกรอก (PDPA ฯลฯ)
 * กดปุ่มยอมรับถ้าเจอ ไม่เจอก็ผ่านเงียบๆ
 * @param {import('playwright').Page} page
 */
async function dismissPopups(page) {
  const labels = ['ยอมรับทั้งหมด', 'ยอมรับ', 'ตกลง', 'Accept all', 'Accept', 'I agree'];
  for (const label of labels) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    try {
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(400);
      }
    } catch { /* ไม่มี popup นี้ — ข้าม */ }
  }
}

/**
 * typeUntilEnabled — พิมพ์ค่าลง field แล้วรอให้ปุ่มที่กำหนด enable
 * efin ใช้ React validation: ปุ่มจะ disabled จนกว่า input จะถูก "พิมพ์" + valid
 * ทำ retry: พิมพ์ → blur (Tab) → รอ enable; ถ้ายัง disabled จะล้างแล้วพิมพ์ใหม่
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} field - ช่อง input
 * @param {string} value - ค่าที่จะพิมพ์
 * @param {import('playwright').Locator} btn - ปุ่มที่ต้องรอให้ enable
 */
async function typeUntilEnabled(page, field, value, btn) {
  await btn.waitFor({ state: 'visible', timeout: 20000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await field.click();
    await field.fill('');                                  // ล้างค่าเก่า
    await field.pressSequentially(value, { delay: 40 });   // พิมพ์จริงเพื่อ trigger validation
    await field.press('Tab');                              // blur ให้ validation ทำงาน
    // รอปุ่ม enable สูงสุด ~8 วินาที
    for (let i = 0; i < 16; i++) {
      if (!(await btn.isDisabled().catch(() => false))) return; // enable แล้ว
      await page.waitForTimeout(500);
    }
    console.log(`    (retry พิมพ์ครั้งที่ ${attempt + 1} — ปุ่มยัง disabled)`);
  }
  // ถ้ายัง disabled หลัง retry ก็ปล่อยให้ขั้น click จัดการ/ฟ้อง error เอง
}

/**
 * login — login แบบ 2 ขั้นของ efin.finance
 *   ขั้น 1: กรอก email/เบอร์ ที่ช่อง #emailOrPhone แล้วกดปุ่ม "ต่อไป"
 *   ขั้น 2: ช่อง #password โผล่ขึ้นมา กรอก password แล้วกดปุ่ม "ยืนยัน"
 * ถ้า login ไม่ผ่านจะ throw (main จะถ่าย screenshot ไว้ debug)
 * @param {import('playwright').Page} page
 */
async function login(page) {
  console.log('  → เปิดหน้า login:', LOGIN_URL);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // ปิด popup consent/cookie ถ้ามี (กันบังช่องกรอก) — ลองกดปุ่มยอมรับแบบเงียบๆ
  await dismissPopups(page);

  // ----- ขั้น 1: กรอก email/เบอร์ -----
  // ช่องแรกคือ #emailOrPhone (type=text)
  // สำคัญ: ปุ่ม "ต่อไป" จะ disabled จนกว่าจะ "พิมพ์" จริง (React validation)
  // ต้องใช้ pressSequentially (ไม่ใช่ fill) เพื่อ trigger event ให้ปุ่ม enable
  const step1Selector = '#emailOrPhone, input[id*="email" i], input[placeholder*="อีเมล" i]';
  console.log('  → ขั้น 1: กรอก email');
  await page.waitForSelector(step1Selector, { timeout: 30000, state: 'visible' });
  const emailField = page.locator(step1Selector).first();

  // รอปุ่ม "ต่อไป" enable แล้วกด — มี retry: ถ้ายัง disabled จะล้างแล้วพิมพ์ใหม่
  const nextBtn = page
    .locator('#login_next_btn, button:has-text("ต่อไป"), button:has-text("ถัดไป")')
    .first();
  await typeUntilEnabled(page, emailField, CREDENTIALS.email, nextBtn);

  console.log('  → กดปุ่ม "ต่อไป"');
  await nextBtn.click();

  // ----- ขั้น 2: กรอก password -----
  console.log('  → ขั้น 2: รอช่องรหัสผ่าน + กรอก password');
  const passField = page.locator('#password, input[type="password"]').first();
  await passField.waitFor({ state: 'visible', timeout: 30000 });
  const confirmBtn = page
    .locator('#login_submit_btn, button:has-text("ยืนยัน"), button:has-text("เข้าสู่ระบบ")')
    .first();
  // พิมพ์ password จนปุ่ม "ยืนยัน" enable (retry แบบเดียวกับขั้น 1)
  await typeUntilEnabled(page, passField, CREDENTIALS.password, confirmBtn);

  // กดปุ่ม "ยืนยัน" (confirm) เพื่อ login จริง
  console.log('  → กดปุ่ม "ยืนยัน"');
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {}),
    confirmBtn.click(),
  ]);

  // ให้เวลา redirect / set cookie หลัง login
  await page.waitForTimeout(3000);
  console.log('  → login เสร็จ (URL ปัจจุบัน:', page.url() + ')');
}

/**
 * gotoModePage — เปิดหน้าของโหมดที่เลือก แล้วรอโหลด
 * @param {import('playwright').Page} page
 * @param {object} mode - object โหมดจาก config
 */
async function gotoModePage(page, mode) {
  console.log('  → เปิดหน้าโหมด:', mode.page);
  await page.goto(mode.page, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // รอให้ app set token ลง storage/cookie
  await page.waitForTimeout(4000);
}

/**
 * extractSSIDI — เก็บค่า token (SSIDI) จาก cookie / localStorage / sessionStorage
 * ค้นหา key ที่ match TOKEN_KEY_PATTERN (เช่น /ssid/i) แล้วเลือกค่าที่ดูเป็น JWT มากสุด
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @returns {Promise<{value:string, source:string, allKeys:object}>}
 */
async function extractSSIDI(context, page) {
  // 1) รวบรวม cookie ทั้งหมด
  const cookies = await context.cookies();

  // 2) รวบรวม localStorage + sessionStorage จากหน้าปัจจุบัน
  const storage = await page.evaluate(() => {
    const dump = (s) => {
      const o = {};
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        o[k] = s.getItem(k);
      }
      return o;
    };
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });

  // host ของหน้าปัจจุบัน (เช่น dc3hw.efin.finance) — ใช้เลือก cookie domain ที่ถูกต้อง
  // สำคัญมาก: SSIDI มีหลาย domain (www.efin.finance อายุ 24h ใช้ยิง API ไม่ได้,
  // ส่วน dc3hw.efin.finance อายุ 15 นาที คือ access token ที่ API รับจริง)
  const pageHost = new URL(page.url()).hostname;

  // รวม candidate ทั้งหมดเป็น list { key, value, source, domain }
  const candidates = [];
  for (const c of cookies) {
    candidates.push({ key: c.name, value: c.value, source: `cookie(${c.domain})`, domain: c.domain });
  }
  for (const [k, v] of Object.entries(storage.local)) candidates.push({ key: k, value: v, source: 'localStorage', domain: pageHost });
  for (const [k, v] of Object.entries(storage.session)) candidates.push({ key: k, value: v, source: 'sessionStorage', domain: pageHost });

  // เก็บ key ทั้งหมดไว้ debug
  const allKeys = candidates.map((c) => `${c.source}:${c.key}`);

  // เลือกเฉพาะค่าที่หน้าตาเป็น JWT (ขึ้นต้น eyJ มี 3 ส่วน)
  const isJwt = (v) => typeof v === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(v);

  // ให้คะแนนแต่ละ candidate เพื่อเลือกตัวที่ถูกต้องที่สุด
  const score = (c) => {
    let s = 0;
    if (!isJwt(c.value)) return -1;                        // ต้องเป็น JWT เท่านั้น
    if (/^ssidi$/i.test(c.key)) s += 100;                  // ชื่อ exact "SSIDI" (ไม่ใช่ SSIDII)
    else if (TOKEN_KEY_PATTERN.test(c.key)) s += 20;       // ชื่อ match /ssid/ อื่นๆ
    // domain ตรงกับหน้าโหมดได้คะแนนสูงสุด (dc3hw.efin.finance)
    const dom = (c.domain || '').replace(/^\./, '');
    if (dom === pageHost) s += 60;
    else if (pageHost.endsWith(dom)) s += 30;
    return s;
  };

  const scored = candidates
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    throw new Error('extractSSIDI: หา SSIDI (JWT) ไม่เจอ. key ทั้งหมดที่พบ:\n  ' + allKeys.join('\n  '));
  }

  const best = scored[0].c;
  return { value: best.value, source: `${best.source}:${best.key}`, allKeys };
}

module.exports = { launchBrowser, login, gotoModePage, extractSSIDI };
