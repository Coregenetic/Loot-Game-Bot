(function () {
  const $ = id => document.getElementById(id);
  let limited = false;

  function showError(msg) { const b = $('errorBox'); b.textContent = msg; b.classList.remove('hidden'); $('okBox').classList.add('hidden'); }
  function showOk(msg)    { const b = $('okBox'); b.textContent = msg; b.classList.remove('hidden'); $('errorBox').classList.add('hidden'); }
  function clearMsgs()    { $('errorBox').classList.add('hidden'); $('okBox').classList.add('hidden'); }

  function fmt(ts) { return ts ? new Date(ts * 1000).toLocaleString('de-DE') : 'noch nie'; }

  function render(data) {
    limited = !!data.limited;
    $('requiredBanner').classList.toggle('hidden', !limited);
    $('backLink').classList.toggle('hidden', limited);
    $('pageTitle').textContent = limited ? 'Passkey einrichten' : 'Passkeys verwalten';

    const list = $('pkList');
    list.textContent = '';
    if (!data.passkeys.length) {
      const d = document.createElement('div');
      d.className = 'text-sm text-slate-500';
      d.textContent = 'Noch kein Passkey eingerichtet.';
      list.appendChild(d);
      return;
    }
    data.passkeys.forEach(p => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 rounded-xl border border-slate-800 px-4 py-3';
      const left = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'text-sm font-semibold text-white';
      name.textContent = p.name;
      const meta = document.createElement('div');
      meta.className = 'text-[11px] text-slate-500 mono mt-0.5';
      meta.textContent = (p.backed_up ? 'synchronisiert' : 'an Gerät gebunden') + ' · erstellt ' + fmt(p.created_at) + ' · zuletzt benutzt ' + fmt(p.last_used_at);
      left.appendChild(name); left.appendChild(meta);
      row.appendChild(left);
      if (!limited) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger';
        btn.textContent = 'Löschen';
        let armed = false;
        btn.addEventListener('click', async () => {
          if (!armed) { armed = true; btn.textContent = 'Sicher? Nochmal klicken'; setTimeout(() => { armed = false; btn.textContent = 'Löschen'; }, 4000); return; }
          try { clearMsgs(); await PasskeyAuth.remove(p.id); showOk('Passkey gelöscht.'); load(); }
          catch (e) { showError(e.message); }
        });
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
  }

  async function load() {
    try {
      const data = await PasskeyAuth.list();
      if (!data.configured) showError('Passkeys sind auf dem Server noch nicht eingerichtet (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN fehlen).');
      render(data);
    } catch (e) {
      if (e.status === 401) { window.location.href = '/login.html'; return; }
      showError(e.message);
    }
  }

  async function add(hint) {
    clearMsgs();
    if (!PasskeyAuth.supported()) { showError('Dieser Browser unterstützt keine Passkeys.'); return; }
    const btns = [$('addPcBtn')];
    btns.forEach(b => b.disabled = true);
    try {
      const res = await PasskeyAuth.register($('pkName').value, hint);
      showOk('Passkey eingerichtet.');
      if (res.promoted) {
        showOk('Passkey eingerichtet. Du wirst zum Dashboard weitergeleitet…');
        setTimeout(() => { window.location.href = '/admin.html'; }, 1200);
        return;
      }
      load();
    } catch (e) {
      showError(PasskeyAuth.friendlyError(e));
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  }

  $('addPcBtn').addEventListener('click', () => add('client-device'));
  $('logoutBtn').addEventListener('click', () => LootGameAPI.logout());
  load();
})();
