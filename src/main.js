// ============================================================================
// src/main.js
// ตัวควบคุมหลัก (orchestrator) ของระบบทดสอบ refresh token
//
// ลำดับการทำงาน (ตาม spec):
//   1. เลือกโหมด (terminal menu 1-4)
//   2. login + เริ่มจับเวลา
//   3. เปิดหน้าโหมด → เก็บ SSIDI (token1) → decode exp/iat
//   4. ยิง API ทุก column ด้วย token1 (สด) → ต้องได้ DATA
//   5. รอจนถึงเวลา exp (auto) + buffer
//   6. เปิดหน้าโหมดอีกครั้ง → เก็บ SSIDI (token2) → decode
//   7. ยิง API ทุก column ด้วย token1 (ที่หมดอายุแล้ว) → ต้องได้ TOKEN_INVALID → หยุดจับเวลา
//   8. ค้างจอให้กดเล่นได้ → กด ENTER เพื่อหยุด → สร้าง report
// ============================================================================

const readline = require('readline');
const { spawn } = require('child_process');
const { MODES, EXPIRY_BUFFER_SECONDS } = require('../config');
const { launchBrowser, login, gotoModePage, extractSSIDI } = require('./browser');
const { fireMode } = require('./api');
const { formatUnix } = require('./jwt');
const { getExpViaJwtIo } = require('./jwtio');
const { buildReport } = require('./report');

// readline instance เดียวใช้ตลอดโปรแกรม
// (ห้ามสร้าง/ปิดใหม่ทุกครั้ง — บน Windows การปิดแล้วเปิดใหม่ทำให้ stdin ค้าง กด ENTER ไม่ตอบสนอง)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/**
 * ask — ถามคำถามใน terminal แล้วคืนคำตอบ (Promise) ผ่าน rl ตัวกลาง
 */
function ask(question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

/**
 * waitForEnter — รอผู้ใช้กด ENTER (one-shot) เพื่อหยุดโปรแกรม
 * ใช้ rl.once('line') แทน rl.question เพื่อความแน่นอน (กดแล้วต้อง resolve เสมอ)
 * @param {string} prompt
 */
function waitForEnter(prompt) {
  process.stdout.write(prompt);
  return new Promise((resolve) => rl.once('line', () => resolve()));
}

/**
 * chooseMode — แสดงเมนูเลือกโหมด แล้ว validate input
 * @returns {Promise<{key:string, mode:object}>}
 */
async function chooseMode() {
  console.log('\n==============================================');
  console.log('   ระบบทดสอบ Refresh Token — efin.finance');
  console.log('==============================================');
  console.log('เลือกโหมดที่ต้องการทดสอบ:');
  for (const [k, m] of Object.entries(MODES)) {
    const n = m.columns ? m.columns.length : m.endpoints.length;
    console.log(`  ${k}. ${m.name}  [${m.type}, ${n} เส้น]`);
  }
  console.log('----------------------------------------------');

  while (true) {
    const a = await ask('พิมพ์หมายเลขโหมด (1-4): ');
    if (MODES[a]) return { key: a, mode: MODES[a] };
    console.log('  ✗ เลือกไม่ถูกต้อง ลองใหม่');
  }
}

/**
 * sleep — หน่วงเวลา (ms)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * waitUntilExpiry — รอจนถึงเวลา exp + buffer พร้อมแสดง countdown ใน terminal
 * @param {number} expUnixSeconds - เวลา exp (unix seconds)
 */
async function waitUntilExpiry(expUnixSeconds) {
  const targetMs = expUnixSeconds * 1000 + EXPIRY_BUFFER_SECONDS * 1000;
  console.log(`\n⏳ รอ token หมดอายุ... (exp: ${formatUnix(expUnixSeconds)} + buffer ${EXPIRY_BUFFER_SECONDS}s)`);

  while (Date.now() < targetMs) {
    const remainSec = Math.ceil((targetMs - Date.now()) / 1000);
    const m = Math.floor(remainSec / 60);
    const s = remainSec % 60;
    // เขียนทับบรรทัดเดิม (countdown)
    process.stdout.write(`\r   เหลืออีก ${m}:${String(s).padStart(2, '0')} นาที   `);
    await sleep(remainSec > 15 ? 5000 : 1000); // ใกล้หมดเช็คถี่ขึ้น
  }
  process.stdout.write('\r   token หมดอายุแล้ว ✓                 \n');
}

/**
 * printResults — log ผลยิง API พร้อมโชว์ data ที่ return กลับมา
 * แสดง: column, classification, HTTP, จำนวน data, ข้อความ status, และ snippet body
 */
function printResults(label, results) {
  console.log(`\n  [${label}] ผลยิง API ${results.length} เส้น:`);
  for (const r of results) {
    console.log(`  ──────────────────────────────────────────────`);
    console.log(`   column   : ${r.column}`);
    console.log(`   ผล       : ${r.classification} (HTTP ${r.httpStatus})`);
    if (r.classification === 'DATA') {
      console.log(`   data      : ${r.dataCount} รายการ`);
    }
    if (r.statusMessage) {
      console.log(`   message   : ${r.statusMessage}`);
    }
    // โชว์ body ที่ API ตอบกลับ (ตัดสั้น) ให้เห็นว่าได้ข้อมูลอะไรมา
    const snippet = (r.snippet || '').replace(/\s+/g, ' ').slice(0, 400);
    console.log(`   response  : ${snippet}${(r.snippet || '').length > 400 ? '…' : ''}`);
  }
  console.log(`  ──────────────────────────────────────────────`);
}

/**
 * openInBrowser — เปิดไฟล์ report ด้วยโปรแกรม default ของ OS (Windows)
 */
function openInBrowser(file) {
  try {
    // Windows: ใช้ cmd start เปิดไฟล์
    spawn('cmd', ['/c', 'start', '""', file], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ถ้าเปิดไม่ได้ ปล่อยผ่าน — path แสดงใน log อยู่แล้ว */ }
}

/**
 * main — รันทั้ง flow
 */
async function main() {
  // ---- 1) เลือกโหมด ----
  const { key, mode } = await chooseMode();
  console.log(`\n✓ เลือกโหมด ${key}: ${mode.name}\n`);

  const { browser, context, page } = await launchBrowser();

  // เก็บข้อมูลสำหรับ report
  const data = { mode, modeKey: key };

  try {
    // ---- 2) login + เริ่มจับเวลา ----
    console.log('[STEP] Login');
    await login(page);
    const timerStart = Date.now(); // เริ่มจับเวลาหลัง login สำเร็จ
    console.log('  ⏱  เริ่มจับเวลาแล้ว\n');

    // ---- 3) เก็บ SSIDI ครั้งแรก (token1) ----
    console.log('[STEP] เก็บ SSIDI ครั้งแรก');
    await gotoModePage(page, mode);
    const grab1 = await extractSSIDI(context, page);
    const token1 = grab1.value;
    data.token1 = token1;
    console.log(`  → SSIDI จาก: ${grab1.source}`);

    // อ่าน exp/iat ผ่าน jwt.io จริง (ตาม spec — ไม่ decode เอง)
    console.log('  → เปิด jwt.io วาง SSIDI เพื่ออ่าน exp/iat');
    const jwt1 = await getExpViaJwtIo(context, token1);
    data.iat1Str = formatUnix(jwt1.iat);
    data.exp1Str = formatUnix(jwt1.exp);
    console.log(`  → iat (จาก jwt.io): ${data.iat1Str}`);
    console.log(`  → exp (จาก jwt.io): ${data.exp1Str}`);
    if (!jwt1.exp) throw new Error('jwt.io อ่าน exp ของ token1 ไม่ได้');

    // ---- 4) ยิง API ด้วย token สด → คาดว่าได้ DATA ----
    console.log('\n[STEP] ยิง API ด้วย token สด (ก่อนหมดอายุ)');
    data.beforeResults = await fireMode(mode, token1);
    printResults('ก่อนหมดอายุ', data.beforeResults);

    // ---- 5) รอจนถึง exp ----
    await waitUntilExpiry(jwt1.exp);

    // ---- 6) เก็บ SSIDI ครั้งที่สอง (token2) หลังหมดอายุ ----
    // ไม่ refresh หน้า — อ่าน cookie/storage ปัจจุบันตรงๆ
    // (เพื่อดูว่าระบบ refresh token เองโดยไม่ต้อง reload หรือไม่)
    console.log('\n[STEP] เก็บ SSIDI อีกครั้ง (หลังหมดอายุ) — ไม่ refresh หน้า');
    let token2 = '';
    try {
      const grab2 = await extractSSIDI(context, page);
      token2 = grab2.value;
      console.log(`  → SSIDI(2) จาก: ${grab2.source}`);
      // อ่าน exp ของ token2 ผ่าน jwt.io เช่นกัน
      const jwt2 = await getExpViaJwtIo(context, token2);
      data.exp2Str = formatUnix(jwt2.exp);
      console.log(`  → exp(2) (จาก jwt.io): ${data.exp2Str}`);
    } catch (e) {
      // ถ้าเก็บ token2 ไม่ได้ (เช่น ถูก logout) ก็ยังทำต่อได้
      console.log('  ⚠ เก็บ token2 ไม่ได้:', e.message);
      data.exp2Str = '-';
    }
    data.token2 = token2;

    // ---- 7) ยิง API ด้วย token1 (หมดอายุแล้ว) → คาด TOKEN_INVALID → หยุดจับเวลา ----
    console.log('\n[STEP] ยิง API ด้วย token ที่หมดอายุแล้ว');
    data.afterResults = await fireMode(mode, token1);
    printResults('หลังหมดอายุ', data.afterResults);

    // คำนวณเวลา 3 แบบ (spec กำกวม — โชว์ครบให้ตัดสินเอง):
    //  - usableMs       : login -> ถึงเวลา exp (เวลาที่ token ใช้งานได้จริง) ← ใช้ตัดสิน PASS/FAIL < 15 นาที
    //  - wallClockMs    : login -> ตอนยิง token หมดอายุ (จับเวลาแบบ literal ตาม spec)
    //  - tokenLifetimeMs: exp - iat (อายุของ token ตามที่ระบบออกให้)
    data.usableMs = jwt1.exp * 1000 - timerStart;
    data.wallClockMs = Date.now() - timerStart;
    data.tokenLifetimeMs = (jwt1.exp - jwt1.iat) * 1000;
    console.log(`\n  ⏱  หยุดจับเวลา`);
    console.log(`     - เวลา token ใช้ได้ (login→exp): ${(data.usableMs / 60000).toFixed(2)} นาที`);
    console.log(`     - wall-clock (login→ยิงตอนหมดอายุ): ${(data.wallClockMs / 60000).toFixed(2)} นาที`);
    console.log(`     - อายุ token (exp-iat): ${(data.tokenLifetimeMs / 60000).toFixed(2)} นาที`);

    // ---- 8) ค้างจอ → กด ENTER เพื่อหยุด + สร้าง report ----
    console.log('\n==============================================');
    console.log('✓ ทดสอบครบแล้ว — browser ค้างไว้ให้กดเล่นได้');
    console.log('==============================================');
    await waitForEnter('กด ENTER เพื่อหยุดโปรแกรมและสร้าง report... ');

    console.log('\n→ กำลังสร้าง report...');
    const file = buildReport(data);
    console.log(`\n📄 สร้าง report แล้ว: ${file}`);
    openInBrowser(file);
  } catch (err) {
    console.error('\n✗ เกิดข้อผิดพลาด:', err.message);
    // ถ่าย screenshot ไว้ debug
    try {
      await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
      console.error('  บันทึก screenshot ไว้ที่ error-screenshot.png');
    } catch { /* ignore */ }
    // ถ้ามีข้อมูลพอ ก็ลองสร้าง report เท่าที่มี
    if (data.beforeResults || data.afterResults) {
      data.beforeResults = data.beforeResults || [];
      data.afterResults = data.afterResults || [];
      data.usableMs = data.usableMs || 0;
      try {
        const file = buildReport(data);
        console.log(`📄 สร้าง report (บางส่วน): ${file}`);
      } catch { /* ignore */ }
    }
  } finally {
    rl.close();                 // ปิด readline กัน process ค้าง
    await browser.close();
    console.log('\nปิด browser แล้ว — จบโปรแกรม');
    process.exit(0);
  }
}

main();
