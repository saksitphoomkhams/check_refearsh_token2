// ============================================================================
// config.js
// ค่าคงที่ทั้งหมดของระบบทดสอบ refresh token
// - credentials สำหรับ login
// - URL หน้า login / API base
// - นิยามของแต่ละ "โหมด" (1-4): ชื่อ, ประเภท (stock/crypto), หน้าที่ใช้ตรวจ, columns
// แก้ค่าที่นี่ที่เดียวเวลาต้องเปลี่ยน account หรือเพิ่ม column
// ============================================================================

// --- บัญชีที่ใช้ login ---
// อ่านจาก environment variable (.env) เพื่อไม่ commit รหัสผ่านลง git
// รันผ่าน `npm start` ซึ่งโหลด .env ให้อัตโนมัติ (ดู package.json)
const CREDENTIALS = {
  email: process.env.EFIN_EMAIL,
  password: process.env.EFIN_PASSWORD,
};

// เช็กว่าตั้ง credentials ครบ ถ้าไม่ครบหยุดพร้อมบอกวิธีแก้
if (!CREDENTIALS.email || !CREDENTIALS.password) {
  console.error('\n✗ ไม่พบ credentials — ตั้งค่าในไฟล์ .env ก่อน');
  console.error('  คัดลอก .env.example เป็น .env แล้วใส่ EFIN_EMAIL / EFIN_PASSWORD');
  process.exit(1);
}

// --- URL หลัก ---
const LOGIN_URL = 'https://dc3hw.efin.finance/th/login';

// API base — เส้นจริงคือ `${API_BASE}/${type}/latest/${column}?limit=5&lang=th`
// type = 'stock' หรือ 'crypto'
const API_BASE = 'https://dc3-api-efincontent.efin.finance/api/v1';

// ชื่อ key ของ token ที่ต้องเก็บจาก Application tab (cookie / localStorage / sessionStorage)
// ระบบจะค้นหา key ที่ match regex นี้แบบไม่สนตัวพิมพ์
const TOKEN_KEY_PATTERN = /ssid/i;

// ข้อความที่ API ตอบกลับเมื่อ token หมดอายุ — ใช้เป็นตัวตัดสินว่า token invalid
const TOKEN_INVALID_MESSAGE = 'Token is not valid';

// เกณฑ์ผ่าน: ระยะเวลาที่ใช้ token ก่อนหมดอายุต้อง < 15 นาที
const MAX_USABLE_MINUTES = 15;

// เวลา buffer (วินาที) ที่รอเพิ่มหลังถึง exp เพื่อให้มั่นใจว่า token หมดอายุจริง
const EXPIRY_BUFFER_SECONDS = 5;

// --- นิยามแต่ละโหมด ---
// page = หน้าที่เปิดเพื่อเก็บ SSIDI, type = ใช้เลือก path ของ API, columns = ยิงทุก column พร้อมกัน
//
// >>> ตอนนี้มีโหมด 1-6 แล้ว (โหมดถัดไปคือ 7) <<<
//   1 = หน้าอ่านข่าว stock | 2 = หน้าอ่านข่าว crypto | 3 = หน้าหลักคริปโต
//   4 = หน้าหลักหุ้น | 5 = หน้า home | 6 = หน้าหุ้น dr รายตัว (ใช้ endpoints เต็ม)
//
// หมายเหตุ: โหมดปกติใช้ `columns` (URL pattern), แต่โหมดที่ต้องยิงหลาย API คนละ path
// ให้ใช้ `endpoints: [{label, url}]` แทน (ดูโหมด 6 เป็นตัวอย่าง)
//
// --- วิธีเพิ่มโหมดใหม่ (ง่ายๆ 3 ขั้น) ---
//   1) ก็อป block โหมดเดิมมา 1 อัน เปลี่ยนเลขนำหน้าเป็นเลขถัดไป (เช่น 5:)
//   2) แก้ 4 ค่า:
//        name    = ชื่อโหมด (แสดงในเมนู)
//        type    = 'stock' หรือ 'crypto'  → กำหนด path API เป็น /stock/... หรือ /crypto/...
//        page    = URL หน้าที่เปิดเพื่อเก็บ cookie SSIDI
//        columns = list ชื่อ column ที่จะยิง (ยิงทุกตัวพร้อมกัน)
//   3) save แล้ว npm start → เมนูจะมีโหมดใหม่ให้เลือกอัตโนมัติ
//   API เส้นจริงที่ยิง = `${API_BASE}/${type}/latest/${column}?limit=5&lang=th`
const MODES = {
  1: {
    name: 'หน้าอ่านข่าว stock',
    type: 'stock',
    page: 'https://dc3hw.efin.finance/th/stock/news/detail/0xx0AA',
    columns: ['latest', 'popular'],
  },
  2: {
    name: 'หน้าอ่านข่าว crypto',
    type: 'crypto',
    page: 'https://dc3hw.efin.finance/th/crypto/news/detail/bitcoin-institutional-coinbase-bernstein',
    columns: ['latest', 'popular'],
  },
  3: {
    name: 'หน้าหลักคริปโต',
    type: 'crypto',
    page: 'https://dc3hw.efin.finance/th/crypto',
    columns: [
      'latest', 'popular', 'bitcoin', 'altcoins', 'etf', 'regulation', 'watch',
      'institution', 'rwa', 'blockchain', 'business', 'defi', 'nft', 'press-room',
      'fintech', 'verse', 'token-radar', 'research', 'genasis-talk', 'weshare', 'infobits',
    ],
  },
  4: {
    name: 'หน้าหลักหุ้น',
    // หมายเหตุ: spec ระบุหน้าเป็น .../th/crypto (น่าจะพิมพ์ผิด) — ใช้หน้าหุ้นแทนเพราะเป็นโหมดหุ้น
    type: 'stock',
    page: 'https://dc3hw.efin.finance/th/stock',
    columns: [
      'latest', 'popular', 'highlight', 'market', 'economics', 'politics', 'ai-tech',
      'company-news', 'earnings', 'press', 'infographics', 'opinion', 'editorial', 'scoops',
      'the-vision', 'f1', 'exclusive-talk', 'live-invested', 'company-visit', 'esg-story',
      'hotstock', 'hottopic', 'the-insight', 'company-news-mai', 'company-news-set',
      'foreign', 'research', 'economics-market-insights', 'efin-review',
    ],
  },
  5: {
    name: 'หน้า home',
    type: 'stock',
    page: 'https://dc3hw.efin.finance/th',
    columns: ['latest', 'popular'],
  },
  // โหมด 6 ไม่ใช้ column pattern — ใช้ endpoint เต็มหลายเส้น (มีข้าม host ไป sit-api ด้วย)
  // ทุกเส้นยิงด้วย SSIDI ที่เก็บมา (เปลี่ยนเฉพาะ Authorization)
  6: {
    name: 'หน้าหุ้น dr รายตัว',
    type: 'stock',
    page: 'https://dc3hw.efin.finance/th/symbol/set/aapl03/news-article',
    endpoints: [
      {
        label: 'dashboard/content/favorites',
        url: 'https://dc3-api-efincontent.efin.finance/api/v1/dashboard/content/favorites?PageNumber=1&PageSize=5&lang=th',
      },
      {
        label: 'dashboard/video/favorites',
        url: 'https://dc3-api-efincontent.efin.finance/api/v1/dashboard/video/favorites?PageNumber=1&PageSize=5&lang=th',
      },
      {
        label: 'dr/AAPL03/news',
        url: 'https://dc3-api-efincontent.efin.finance/api/v1/dr/AAPL03/news/dr?page=1&size=10&period=10Y&lang=th',
      },
      {
        // เส้น stock/latest แต่ column = dr, limit = 1 (ตามที่ระบุ)
        label: 'stock/latest/dr',
        url: 'https://dc3-api-efincontent.efin.finance/api/v1/stock/latest/dr?limit=1&lang=th',
      },
    ],
  },
};

module.exports = {
  CREDENTIALS,
  LOGIN_URL,
  API_BASE,
  TOKEN_KEY_PATTERN,
  TOKEN_INVALID_MESSAGE,
  MAX_USABLE_MINUTES,
  EXPIRY_BUFFER_SECONDS,
  MODES,
};
