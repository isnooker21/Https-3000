(function () {
  PanelNav.render('download');
  const $ = (sel) => document.querySelector(sel);

  async function load() {
    try {
      const data = await panelFetchJson('/panel/api/info');
      if (!data.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');

      $('#eaVersion').textContent = 'v' + data.version;
      $('#eaFileName').textContent = data.file_name;

      const btn = $('#btnDownload');
      if (data.download_url) {
        btn.href = data.download_url;
        btn.classList.remove('disabled');
      } else {
        btn.classList.add('disabled');
        $('#err').textContent = 'ยังไม่ได้วางไฟล์ EA บนเซิร์ฟเวอร์ — ติดต่อผู้ดูแล';
        $('#err').hidden = false;
      }
    } catch (e) {
      $('#err').textContent = e.message;
      $('#err').hidden = false;
    }
  }

  load();
})();
