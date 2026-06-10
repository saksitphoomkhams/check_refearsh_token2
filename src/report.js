// ============================================================================
// src/report.js
// สร้าง report เป็นไฟล์ HTML จากข้อมูลที่เก็บได้ตลอดการทดสอบ
// report ประกอบด้วย:
//   1) เปรียบเทียบ token เก่า/ใหม่ (เหมือน/ไม่เหมือน) + เวลาที่ใช้ก่อนหมดอายุ (PASS ถ้า < 15 นาที)
//   2) ตารางสถานะ API แต่ละเส้น ก่อน/หลัง token หมดอายุ
// ============================================================================

const fs = require('fs');
const path = require('path');
const { MAX_USABLE_MINUTES } = require('../config');

/**
 * esc — escape HTML กัน XSS / กันค่าทำ layout พัง
 */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * msToMinSec — แปลง millisecond เป็นข้อความ "X นาที Y วินาที"
 */
function msToMinSec(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m} นาที ${s} วินาที`;
}

/**
 * fmtTime — แปลง unix ms เป็นเวลา HH:MM:SS.mmm (เขตเวลาไทย) สำหรับแสดงเวลายิง API
 */
function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const t = d.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
  return `${t}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * badge — สร้าง span สีตามสถานะ (เขียว=ผ่าน, แดง=ไม่ผ่าน, เทา=อื่น)
 */
function badge(text, kind) {
  const color = kind === 'pass' ? '#1a7f37' : kind === 'fail' ? '#cf222e' : '#57606a';
  const bg = kind === 'pass' ? '#dafbe1' : kind === 'fail' ? '#ffebe9' : '#eaeef2';
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-weight:600;font-size:13px;">${esc(text)}</span>`;
}

/**
 * buildReport — รวมข้อมูลเป็น HTML แล้วเขียนลงไฟล์
 * @param {object} data ข้อมูลผลทดสอบ:
 *   {
 *     mode,                // object โหมด
 *     token1, token2,      // ค่า SSIDI ครั้งแรก/หลังหมดอายุ
 *     exp1Str, iat1Str,    // วันเวลา exp/iat ของ token1 (อ่านง่าย)
 *     exp2Str,             // exp ของ token2
 *     usableMs,            // เวลาที่ใช้ token ก่อนหมดอายุ (login -> ยิงตอนหมดอายุ)
 *     beforeResults,       // ผลยิงตอน token ยังสด (array)
 *     afterResults,        // ผลยิงตอน token หมดอายุ (array)
 *   }
 * @returns {string} path ของไฟล์ report
 */
function buildReport(data) {
  const {
    mode, token1, token2, exp1Str, iat1Str, exp2Str,
    usableMs, wallClockMs, tokenLifetimeMs, beforeResults, afterResults,
  } = data;

  // --- ส่วนที่ 1: เปรียบเทียบ token ---
  const tokenSame = token1 === token2;
  const usableMin = usableMs / 60000;
  const timePass = usableMin < MAX_USABLE_MINUTES;

  // --- ส่วนที่ 2: รวมผล before/after เป็นตารางต่อ column ---
  // map column -> {before, after}
  const byCol = {};
  for (const r of beforeResults) byCol[r.column] = { before: r };
  for (const r of afterResults) byCol[r.column] = { ...(byCol[r.column] || {}), after: r };

  // เกณฑ์ผ่านต่อเส้น: ก่อนหมดอายุต้องเป็น DATA, หลังหมดอายุต้องเป็น TOKEN_INVALID
  const rows = Object.entries(byCol).map(([col, v]) => {
    const b = v.before, a = v.after;
    const beforeOk = b && b.classification === 'DATA';
    const afterOk = a && a.classification === 'TOKEN_INVALID';
    const rowPass = beforeOk && afterOk;
    return `
      <tr>
        <td><code>${esc(col)}</code></td>
        <td>${b ? esc(b.classification) + ` (HTTP ${b.httpStatus})` : '-'}</td>
        <td>${beforeOk ? badge('ผ่าน', 'pass') : badge('ไม่ผ่าน', 'fail')}</td>
        <td><code>${b ? fmtTime(b.firedAt) : '-'}</code></td>
        <td>${a ? esc(a.classification) + ` (HTTP ${a.httpStatus})` : '-'}</td>
        <td>${afterOk ? badge('ผ่าน', 'pass') : badge('ไม่ผ่าน', 'fail')}</td>
        <td>${rowPass ? badge('PASS', 'pass') : badge('FAIL', 'fail')}</td>
        <td><code>${a ? fmtTime(a.firedAt) : '-'}</code></td>
      </tr>`;
  }).join('');

  const passCount = Object.values(byCol).filter(
    (v) => v.before?.classification === 'DATA' && v.after?.classification === 'TOKEN_INVALID'
  ).length;
  const totalCount = Object.keys(byCol).length;

  // ตัด token ให้สั้นลงเวลาแสดง (กดดูเต็มได้)
  const shortTok = (t) => (t ? esc(t.slice(0, 40)) + '…(' + t.length + ' chars)' : '-');

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Refresh Token Test Report — ${esc(mode.name)}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; margin: 24px; color: #1f2328; background:#f6f8fa; }
  h1 { font-size: 22px; } h2 { font-size: 18px; margin-top: 28px; border-bottom:2px solid #d0d7de; padding-bottom:6px;}
  .card { background:#fff; border:1px solid #d0d7de; border-radius:8px; padding:16px 20px; margin-bottom:16px; }
  table { border-collapse: collapse; width: 100%; background:#fff; }
  th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; font-size: 14px; }
  th { background:#f6f8fa; }
  code { background:#eff1f3; padding:1px 5px; border-radius:4px; font-size:13px; word-break:break-all; }
  .kv { display:grid; grid-template-columns: 220px 1fr; gap:6px 12px; font-size:14px; }
  .kv b { color:#57606a; font-weight:600; }
  details summary { cursor:pointer; color:#0969da; }
</style>
</head>
<body>
  <h1>📋 รายงานทดสอบ Refresh Token</h1>
  <div class="card">
    <div class="kv">
      <b>โหมดที่ทดสอบ</b><span>${esc(mode.name)} (type: ${esc(mode.type)})</span>
      <b>หน้าที่ใช้ตรวจ</b><span><a href="${esc(mode.page)}">${esc(mode.page)}</a></span>
      <b>จำนวน column</b><span>${mode.columns.length} เส้น</span>
    </div>
  </div>

  <h2>1) เปรียบเทียบ Token เก่า / ใหม่</h2>
  <div class="card">
    <div class="kv">
      <b>SSIDI ครั้งแรก (token1)</b><span><code>${shortTok(token1)}</code></span>
      <b>SSIDI หลังหมดอายุ (token2)</b><span><code>${shortTok(token2)}</code></span>
      <b>ผลเปรียบเทียบค่า</b><span>${tokenSame ? badge('เหมือน', 'fail') : badge('ไม่เหมือน', 'pass')} ${tokenSame ? '(token ไม่เปลี่ยน)' : '(token เปลี่ยน = มีการ refresh)'}</span>
      <b>iat (token1 ออกเมื่อ)</b><span>${esc(iat1Str)}</span>
      <b>exp (token1 หมดอายุ)</b><span>${esc(exp1Str)}</span>
      <b>exp (token2 หมดอายุ)</b><span>${esc(exp2Str)}</span>
      <b>⏱ เวลาที่ใช้ token ก่อนหมดอายุ (login→exp)</b><span><b>${msToMinSec(usableMs)}</b> (${usableMin.toFixed(2)} นาที)</span>
      <b>เกณฑ์ &lt; ${MAX_USABLE_MINUTES} นาที</b><span>${timePass ? badge('ผ่าน', 'pass') : badge('ไม่ผ่าน (เกิน 15 นาที)', 'fail')}</span>
      <b>wall-clock (login→ยิงตอนหมดอายุ)</b><span>${wallClockMs != null ? msToMinSec(wallClockMs) : '-'}</span>
      <b>อายุ token (exp − iat)</b><span>${tokenLifetimeMs != null ? msToMinSec(tokenLifetimeMs) : '-'}</span>
    </div>
    <details style="margin-top:12px;">
      <summary>ดูค่า token เต็ม</summary>
      <p><b>token1:</b><br><code>${esc(token1)}</code></p>
      <p><b>token2:</b><br><code>${esc(token2)}</code></p>
    </details>
  </div>

  <h2>2) ตารางสถานะ API (ก่อน / หลัง token หมดอายุ)</h2>
  <div class="card">
    <p>สรุป: ผ่าน <b>${passCount}/${totalCount}</b> เส้น</p>
    <table>
      <thead>
        <tr>
          <th>Column</th>
          <th>ก่อนหมดอายุ (ผล)</th>
          <th>ก่อน: คาด DATA</th>
          <th>⏱ เวลายิงครั้งแรก</th>
          <th>หลังหมดอายุ (ผล)</th>
          <th>หลัง: คาด TOKEN_INVALID</th>
          <th>สรุปเส้นนี้</th>
          <th>⏱ เวลายิงหลังหมดอายุ</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <p style="color:#57606a;font-size:13px;">สร้างโดยระบบทดสอบ refresh token — efin.finance</p>
</body>
</html>`;

  // เขียนไฟล์ลงโฟลเดอร์ reports พร้อม timestamp (เลี่ยงชื่อซ้ำ)
  const dir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `report-mode${data.modeKey}-${stamp}.html`);
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

module.exports = { buildReport };
