/** เรียก API panel — แจ้งข้อความชัดถ้าได้ HTML แทน JSON */
async function panelFetchJson(url) {
  const r = await fetch(url);
  const text = await r.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    throw new Error(
      `API ไม่พบหรือเซิร์ฟเวอร์ยังไม่อัปเดต (${r.status}) — รีสตาร์ท Node หลัง git pull ล่าสุด`,
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ตอบกลับจากเซิร์ฟเวอร์ไม่ใช่ JSON');
  }
  if (!r.ok) throw new Error((data && data.error) || r.statusText || `HTTP ${r.status}`);
  return data;
}
