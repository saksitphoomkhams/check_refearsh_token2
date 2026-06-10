// ============================================================================
// src/jwtio.js
// อ่านค่า exp/iat ของ token ผ่านเว็บ jwt.io จริง (ตาม spec ข้อ 4)
// เปิด https://www.jwt.io/ เป็น tab ใหม่ → วาง SSIDI ในกล่อง Encoded Token
// → อ่าน payload ที่ decode แล้วจากหน้าเว็บ → ดึง exp/iat
// ============================================================================

const JWT_IO_URL = 'https://www.jwt.io/';

// selector ของกล่อง Encoded Token (jwt.io ใช้ react-simple-code-editor)
const ENCODED_TEXTAREA = 'textarea.npm__react-simple-code-editor__textarea';

/**
 * getExpViaJwtIo — เปิด jwt.io วาง token แล้วอ่าน exp/iat จาก payload ที่หน้าเว็บ decode
 * เปิดเป็น tab ใหม่ใน context เดิม (ผู้ใช้เห็นได้จริงตอน headed) และเว้น tab ไว้ไม่ปิด
 * @param {import('playwright').BrowserContext} context
 * @param {string} token - ค่า SSIDI
 * @returns {Promise<{exp:number|null, iat:number|null, page:import('playwright').Page}>}
 *   exp/iat เป็น unix seconds (อ่านได้จาก jwt.io)
 */
async function getExpViaJwtIo(context, token) {
  const page = await context.newPage();
  await page.goto(JWT_IO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500); // รอ editor พร้อม

  // วาง token ลงกล่อง Encoded Token
  const enc = page.locator(ENCODED_TEXTAREA).first();
  await enc.click();
  await enc.fill(token);
  await page.waitForTimeout(2500); // รอ jwt.io decode + render payload

  // อ่านข้อความทั้งหน้า แล้วดึงค่า exp/iat จาก payload ที่ decode แล้ว
  const body = await page.locator('body').innerText();

  // exp มีค่าเดียว (ของ token เรา) — ดึงตรงๆ
  const expMatch = body.match(/"exp":\s*(\d+)/);
  const exp = expMatch ? parseInt(expMatch[1], 10) : null;

  // iat อาจมีหลายค่า (jwt.io มี sample token ปนในหน้า)
  // เลือก iat ที่อยู่ payload เดียวกับ exp — คือค่าที่ exp - iat สมเหตุผล (< 2 วัน)
  let iat = null;
  if (exp) {
    const iatMatches = [...body.matchAll(/"iat":\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
    iat = iatMatches.find((v) => exp - v >= 0 && exp - v < 2 * 86400) ?? iatMatches[0] ?? null;
  }

  return { exp, iat, page };
}

module.exports = { getExpViaJwtIo, JWT_IO_URL };
