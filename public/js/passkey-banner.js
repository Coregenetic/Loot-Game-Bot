// Hinweis im Dashboard, solange das eigene Konto noch keinen Passkey hat
(async function () {
  if (!window.PasskeyAuth) return;
  try {
    const info = await PasskeyAuth.list();
    if (!info.configured || info.limited) return;
    // Nur noch ein Hinweis, solange kein Passkey eingerichtet ist (Passkeys gelten nur für Windows Hello)
    if (info.passkeys.length > 0) return;
    const main = document.querySelector('.adm-main');
    if (!main) return;
    const bar = document.createElement('a');
    bar.href = '/passkey-setup.html';
    bar.className = 'pk-banner';
    bar.innerHTML = '<svg class="ic"><use href="#i-key"/></svg><span>Du hast noch keinen Passkey. Richte jetzt Windows Hello ein, der Passkey wird bald Pflicht.</span>';
    main.insertBefore(bar, main.firstChild);
  } catch (e) { /* Banner ist optional */ }
})();
