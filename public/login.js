(function () {
  const AUTH_KEY = 'ea_admin_basic';

  if (location.search.includes('logout=1')) {
    sessionStorage.removeItem(AUTH_KEY);
  } else if (sessionStorage.getItem(AUTH_KEY)) {
    location.replace('/admin.html');
    return;
  }

  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('loginErr');
  const userEl = document.getElementById('user');

  userEl.value = 'isnooker';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const user = userEl.value.trim();
    const password = document.getElementById('password').value;

    try {
      const r = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        errEl.textContent = j.error || 'เข้าสู่ระบบไม่สำเร็จ';
        return;
      }
      sessionStorage.setItem(AUTH_KEY, btoa(`${user}:${password}`));
      location.replace('/admin.html');
    } catch (ex) {
      errEl.textContent = 'เชื่อมต่อ server ไม่ได้ — ตรวจว่า pm2 รันอยู่';
    }
  });
})();
