// ============================================================================
// src/jwt.js
// decode JWT แบบ local (ไม่ verify signature) เทียบเท่ากับการวางใน jwt.io
// ดึง payload เพื่ออ่านค่า exp / iat แล้วแปลงเป็นวันเวลาที่อ่านง่าย
// ============================================================================

/**
 * decodeJwt — แตก JWT เป็น header/payload โดย decode ส่วน base64url
 * @param {string} token - JWT string (เช่นค่า SSIDI)
 * @returns {{header:object, payload:object, exp:number|null, iat:number|null}}
 * คืน exp/iat เป็น unix seconds (null ถ้าไม่มี)
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('decodeJwt: token ว่างหรือไม่ใช่ string');
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('decodeJwt: รูปแบบไม่ใช่ JWT (ต้องมี 3 ส่วนคั่นด้วยจุด)');
  }

  // helper: base64url -> JSON object
  const decodePart = (part) => {
    // base64url ใช้ -/_ แทน +// และไม่มี padding — แปลงกลับก่อน decode
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  };

  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);

  return {
    header,
    payload,
    exp: typeof payload.exp === 'number' ? payload.exp : null,
    iat: typeof payload.iat === 'number' ? payload.iat : null,
  };
}

/**
 * formatUnix — แปลง unix seconds เป็นข้อความวันเวลา (เขตเวลาไทย)
 * @param {number|null} unixSeconds
 * @returns {string}
 */
function formatUnix(unixSeconds) {
  if (!unixSeconds) return '-';
  const d = new Date(unixSeconds * 1000);
  // แสดงเป็นเวลาไทย (Asia/Bangkok) อ่านง่าย
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) + ' (TH)';
}

module.exports = { decodeJwt, formatUnix };
