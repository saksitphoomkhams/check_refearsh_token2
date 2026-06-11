// ============================================================================
// src/api.js
// ยิง API ของ efincontent ด้วย token (SSIDI) ใน Authorization header
// แล้ว classify ผลลัพธ์ว่า: ได้ data / token invalid / error อื่น
// ============================================================================

const { API_BASE, TOKEN_INVALID_MESSAGE } = require('../config');

/**
 * buildUrl — ประกอบ URL ของ API ตาม type และ column
 * @param {string} type   - 'stock' | 'crypto'
 * @param {string} column - ชื่อ column เช่น 'latest', 'popular'
 * @returns {string}
 */
function buildUrl(type, column) {
  return `${API_BASE}/${type}/latest/${encodeURIComponent(column)}?limit=5&lang=th`;
}

/**
 * classify — ตัดสินผลจาก response
 * - TOKEN_INVALID : body มีข้อความ "Token is not valid" (token หมดอายุ/ใช้ไม่ได้)
 * - DATA          : HTTP 2xx และไม่ใช่ token invalid (ถือว่าได้ข้อมูลกลับมา)
 * - OTHER         : กรณีอื่น (error, network ฯลฯ)
 * @returns {'TOKEN_INVALID'|'DATA'|'OTHER'}
 */
function classify(httpStatus, statusMessage, hasData) {
  if (statusMessage && statusMessage.includes(TOKEN_INVALID_MESSAGE)) {
    return 'TOKEN_INVALID';
  }
  if (httpStatus >= 200 && httpStatus < 300 && hasData) {
    return 'DATA';
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    // 2xx แต่ไม่เจอ data ชัดเจน — ยังถือว่า DATA (บาง endpoint คืน object ตรงๆ)
    return 'DATA';
  }
  return 'OTHER';
}

/**
 * fireUrl — ยิง URL เต็ม 1 เส้นด้วย token แล้ว classify ผล (ใช้ได้กับทุก endpoint)
 * @param {string} label - ชื่อแสดงผลในตาราง (เช่น column หรือชื่อ endpoint)
 * @param {string} url   - URL เต็มที่จะยิง
 * @param {string} token - ค่า SSIDI ที่ใส่เป็น Bearer
 * @returns {Promise<object>} ผลลัพธ์ที่ classify แล้ว
 */
async function fireUrl(label, url, token) {
  const result = {
    column: label,
    url,
    httpStatus: 0,
    statusMessage: '',
    hasData: false,
    dataCount: 0,    // จำนวน item ใน data (ถ้าเป็น array)
    classification: 'OTHER',
    snippet: '',
    firedAt: Date.now(),   // เวลาที่ยิง API เส้นนี้ (unix ms) — ใช้แสดงในตาราง report
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    result.httpStatus = res.status;

    const text = await res.text();
    result.snippet = text.slice(0, 600); // เก็บ snippet body ไว้โชว์ใน terminal/report

    // พยายาม parse JSON เพื่ออ่าน status_message และตรวจว่ามี data ไหม
    try {
      const body = JSON.parse(text);
      result.statusMessage = body.status_message || body.message || '';
      // ถือว่ามี data ถ้ามี field data ที่ไม่ว่าง
      const d = body.data;
      result.hasData = Array.isArray(d) ? d.length > 0 : !!d;
      // นับจำนวน item: data เป็น array ตรงๆ หรือซ้อนใน data.news/data.list/data.items
      if (Array.isArray(d)) {
        result.dataCount = d.length;
      } else if (d && typeof d === 'object') {
        const arr = d.news || d.list || d.items || Object.values(d).find((v) => Array.isArray(v));
        result.dataCount = Array.isArray(arr) ? arr.length : (d ? 1 : 0);
      }
    } catch {
      // ไม่ใช่ JSON — เช็คข้อความ token invalid จาก text ตรงๆ
      result.statusMessage = text.includes(TOKEN_INVALID_MESSAGE) ? TOKEN_INVALID_MESSAGE : '';
    }

    result.classification = classify(result.httpStatus, result.statusMessage, result.hasData);
  } catch (err) {
    // network error / DNS / timeout
    result.statusMessage = `REQUEST_ERROR: ${err.message}`;
    result.classification = 'OTHER';
  }

  return result;
}

/**
 * fireApi — ยิง API ตาม type+column (URL pattern มาตรฐาน)
 * @param {string} type   - 'stock' | 'crypto'
 * @param {string} column - ชื่อ column
 * @param {string} token  - ค่า SSIDI
 */
function fireApi(type, column, token) {
  return fireUrl(column, buildUrl(type, column), token);
}

/**
 * fireMode — ยิงทุกเส้นของโหมดพร้อมกัน (parallel) ด้วย token เดียว
 * รองรับ 2 แบบ:
 *   - mode.endpoints : list ของ {label, url} เต็มๆ (สำหรับโหมดที่ใช้หลาย API/หลาย host)
 *   - mode.columns   : list ชื่อ column (ใช้ URL pattern มาตรฐานตาม type)
 * @param {object} mode  - object โหมดจาก config
 * @param {string} token - ค่า SSIDI
 * @returns {Promise<object[]>} array ผลลัพธ์ของแต่ละเส้น
 */
async function fireMode(mode, token) {
  const tasks = mode.endpoints
    ? mode.endpoints.map((ep) => fireUrl(ep.label, ep.url, token))   // โหมด endpoint เต็ม
    : mode.columns.map((col) => fireApi(mode.type, col, token));     // โหมด column ปกติ
  return Promise.all(tasks);
}

module.exports = { buildUrl, fireUrl, fireApi, fireMode, classify };
