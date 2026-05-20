/** เมนูร่วมทุกหน้า panel */
window.PanelNav = {
  render(active) {
    const el = document.getElementById('panelNav');
    if (!el) return;
    const items = [
      { id: 'home', href: '/panel.html', label: 'สถิติสด' },
      { id: 'download', href: '/panel-download.html', label: 'ดาวน์โหลด EA' },
      { id: 'install', href: '/panel-install.html', label: 'วิธีติดตั้ง' },
    ];
    el.innerHTML = items
      .map(
        (it) =>
          `<a href="${it.href}" class="${it.id === active ? 'active' : ''}">${it.label}</a>`,
      )
      .join('');
  },
};
