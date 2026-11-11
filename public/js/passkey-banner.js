// Hinweis im Dashboard, solange das eigene Konto noch keinen Passkey hat
(async function () {
  if (!window.PasskeyAuth) return;
  try {
    const info = await PasskeyAuth.list();
    if (!info.configured || info.limited) return;
    const missing = info.passkeys.length === 0;
    const onlyOne = info.passkeys.length === 1;
    if (!missing && !onlyOne) return;

    const bar = document.createElement('a');
    bar.href = '/passkey-setup.html';
    bar.style.cssText = 'display:block;text-align:center;padding:8px 12px;font:600 12px Inter,sans-serif;color:#fde68a;background:rgba(251,191,36,.12);border-bottom:1px solid rgba(251,191,36,.35);text-decoration:none';
    bar.textContent = missing
      ? '🔐 Du hast noch keinen Passkey. Richte jetzt Windows Hello ein, der Passkey wird bald Pflicht. →'
      : '🔐 Du hast nur einen Passkey. Lege einen zweiten an (z. B. Handy), damit du nicht ausgesperrt bist. →';
    // Nicht direkt in <body> einfügen (dort liegt ein Flex-Layout), sondern über dem Inhalt
    const main = document.querySelector('main');
    if (!main) return;
    bar.style.cssText += ';border-radius:12px;margin-bottom:16px;border:1px solid rgba(251,191,36,.35)';
    main.insertBefore(bar, main.firstChild);
  } catch (e) { /* Banner ist optional */ }
})();
