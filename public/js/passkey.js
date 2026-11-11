// Passkey-Helfer (WebAuthn / Windows Hello) für Login, Einrichtung und Verwaltung
(function () {
  const TOKEN_KEY = 'lootgame_session_token';

  function b64uToBuf(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function bufToB64u(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function supported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    if (token) headers['x-session-token'] = token;
    const res = await fetch('/api/auth/passkey' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ('Fehler ' + res.status));
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // Browser-Fehler in verständliche deutsche Meldungen übersetzen
  function friendlyError(err) {
    if (!err) return 'Unbekannter Fehler';
    if (err.name === 'NotAllowedError') return 'Abgebrochen oder Zeit abgelaufen. Bitte erneut versuchen.';
    if (err.name === 'InvalidStateError') return 'Dieser Passkey ist auf diesem Gerät schon registriert.';
    if (err.name === 'SecurityError') return 'Passkeys funktionieren nur über die richtige Adresse (https://lootgamebot.de).';
    if (err.name === 'NotSupportedError') return 'Dieses Gerät oder dieser Browser unterstützt keine Passkeys.';
    return err.message || 'Unbekannter Fehler';
  }

  // Anmeldung mit vorhandenem Passkey (ohne Benutzername — Windows zeigt die Auswahl)
  async function login() {
    const o = await api('POST', '/login/options');
    const opts = o.options;
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: b64uToBuf(opts.challenge),
        rpId: opts.rpId,
        timeout: opts.timeout,
        userVerification: opts.userVerification || 'required',
        allowCredentials: (opts.allowCredentials || []).map(c => ({ type: 'public-key', id: b64uToBuf(c.id), transports: c.transports }))
      }
    });
    const r = cred.response;
    const payload = {
      id: cred.id,
      rawId: bufToB64u(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bufToB64u(r.clientDataJSON),
        authenticatorData: bufToB64u(r.authenticatorData),
        signature: bufToB64u(r.signature),
        userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined
      }
    };
    return api('POST', '/login/verify', { challengeId: o.challengeId, response: payload });
  }

  // Neuen Passkey für das angemeldete Konto registrieren
  // hint: 'client-device' (dieser PC) oder 'hybrid' (Handy per QR-Code) — nur ein Vorschlag an den Browser
  async function register(name, hint) {
    const o = await api('POST', '/register/options');
    const opts = o.options;
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: opts.rp,
        user: { id: b64uToBuf(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
        challenge: b64uToBuf(opts.challenge),
        pubKeyCredParams: opts.pubKeyCredParams,
        timeout: opts.timeout,
        attestation: opts.attestation || 'none',
        authenticatorSelection: opts.authenticatorSelection,
        excludeCredentials: (opts.excludeCredentials || []).map(c => ({ type: 'public-key', id: b64uToBuf(c.id), transports: c.transports })),
        hints: hint ? [hint] : undefined
      }
    });
    const r = cred.response;
    const payload = {
      id: cred.id,
      rawId: bufToB64u(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
      response: {
        clientDataJSON: bufToB64u(r.clientDataJSON),
        attestationObject: bufToB64u(r.attestationObject),
        transports: r.getTransports ? r.getTransports() : []
      }
    };
    return api('POST', '/register/verify', { challengeId: o.challengeId, response: payload, name });
  }

  window.PasskeyAuth = {
    supported, friendlyError, login, register,
    config: () => api('GET', '/config'),
    list: () => api('GET', ''),
    rename: (id, name) => api('PATCH', '/' + id, { name }),
    remove: id => api('DELETE', '/' + id),
    counts: () => api('GET', '/counts'),
    resetUser: username => api('DELETE', '/user/' + encodeURIComponent(username))
  };
})();
