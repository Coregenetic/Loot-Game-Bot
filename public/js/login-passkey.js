// Passkey-Login-Box für login.html (Admin-Login)
(function () {
  const NOTICE_ENFORCED = 'Admin-Zugang nur mit Passkey. Melde dich mit Windows Hello an (Fingerabdruck, Gesicht oder PIN). Das Passwort dient nur dazu, einmalig einen Passkey einzurichten.';
  const NOTICE_OPTIONAL = 'Passkeys sind verfügbar. Melde dich mit Windows Hello an, oder richte nach dem Passwort-Login einen Passkey ein. Bald ist der Passkey Pflicht.';

  const ui = { box: 'passkeyBox', notice: 'passkeyNotice', btn: 'passkeyBtn', err: 'passkeyErr', pw: 'pwDividerLabel', target: '/admin.html' };

  const $ = id => document.getElementById(id);
  const box = $(ui.box);
  if (!box || !window.PasskeyAuth) return;

  function showErr(msg) {
    const el = $(ui.err);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  PasskeyAuth.config().then(cfg => {
    if (!cfg.configured || !PasskeyAuth.supported()) return;
    $(ui.notice).textContent = cfg.enforce ? NOTICE_ENFORCED : NOTICE_OPTIONAL;
    if (cfg.enforce && $(ui.pw)) $(ui.pw).textContent = 'Passwort (nur zum Einrichten eines Passkeys)';
    box.classList.remove('hidden');
  }).catch(() => {});

  $(ui.btn).addEventListener('click', async () => {
    const btn = $(ui.btn);
    const label = btn.innerHTML;
    showErr('');
    btn.disabled = true;
    btn.textContent = 'Warte auf Windows Hello…';
    try {
      const data = await PasskeyAuth.login();
      localStorage.setItem('lootgame_session_token', data.token);
      localStorage.setItem('lootgame_username', data.username);
      window.location.href = ui.target;
    } catch (e) {
      showErr(PasskeyAuth.friendlyError(e));
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });
})();
