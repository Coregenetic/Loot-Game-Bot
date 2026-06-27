const ROLE_BADGE = {
  superadmin: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  admin:      'bg-blue-500/10 text-blue-400 border-blue-500/30',
  mod:        'bg-slate-700/30 text-slate-300 border-slate-700'
};

async function loadUsers() {
  try {
    const users = await fetch('/api/admin/users',{headers:{'x-session-token':LootGameAPI.getToken()}}).then(r=>r.json());
    document.getElementById('userList').innerHTML = users.map(u => {
      const badge = ROLE_BADGE[u.role] || ROLE_BADGE.mod;
      const isMe = u.username === currentUser.username;
      return '<div class="flex items-center justify-between p-3 rounded-xl border border-slate-800/50 hover:bg-slate-800/30 transition-colors">' +
        '<div class="flex items-center gap-3">' +
          '<div><div class="text-slate-200 font-medium text-sm">' + u.username + (isMe ? ' <span class="text-[10px] text-slate-500">(du)</span>' : '') + '</div>' +
          '<span class="text-[10px] font-mono px-2 py-0.5 rounded-md border mt-1 inline-block ' + badge + '">' + u.role + '</span></div>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<select onchange="changeUserRole(\'' + u.username + '\', this.value)" ' + (isMe ? 'disabled title="Du kannst dir selbst keine Rolle entziehen"' : '') + ' class="bg-slate-900/50 border border-slate-700 rounded-lg text-xs text-slate-300 px-2 py-1.5 outline-none focus:border-emerald-500 disabled:opacity-40">' +
            ['mod','admin','superadmin'].map(r => '<option value="'+r+'" '+(r===u.role?'selected':'')+'>'+r+'</option>').join('') +
          '</select>' +
          (isMe ? '' : '<button class="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 text-[10px] font-bold tracking-wider transition-colors" onclick="deleteUser(\'' + u.username + '\')">LÖSCHEN</button>') +
        '</div></div>';
    }).join('');
  } catch {}
  loadPermissionMatrix();
  loadAuditLog();
}

async function createUser() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role     = document.getElementById('newRole').value;
  const msg = document.getElementById('userMsg');

  if (!username||!password) {
    msg.textContent='⚠ Alle Felder ausfüllen';
    msg.className='text-xs text-amber-400 mt-2 block';
    return;
  }
  try {
    const res = await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','x-session-token':LootGameAPI.getToken()},body:JSON.stringify({username,password,role})});
    const d = await res.json();
    if (d.success) {
      showToast('✓ User ' + username + ' angelegt', 'success');
      msg.className='hidden';
      document.getElementById('newUsername').value='';
      document.getElementById('newPassword').value='';
      loadUsers();
    }
    else {
      msg.textContent='✗ '+(d.error||'Fehler');
      msg.className='text-xs text-rose-400 mt-2 block';
    }
  } catch(e) {
    msg.textContent='✗ '+e.message;
    msg.className='text-xs text-rose-400 mt-2 block';
  }
}

async function changeUserRole(username, role) {
  try {
    const res = await fetch('/api/admin/users/'+username+'/role',{method:'PATCH',headers:{'Content-Type':'application/json','x-session-token':LootGameAPI.getToken()},body:JSON.stringify({role})});
    const d = await res.json();
    if (d.success) { showToast('✓ Rolle geändert', 'success'); loadUsers(); }
    else { showToast('✗ '+(d.error||'Fehler'), 'error'); loadUsers(); }
  } catch(e) { showToast('✗ '+e.message, 'error'); }
}

async function deleteUser(username) {
  showConfirm('User löschen', 'Möchtest du den User "' + username + '" wirklich unwiderruflich löschen?', async () => {
    await fetch('/api/admin/users/'+username,{method:'DELETE',headers:{'x-session-token':LootGameAPI.getToken()}});
    showToast('✓ User gelöscht', 'success');
    loadUsers();
  });
}

// ─── Rollen-Permission-Matrix ──────────────────────────────────────────────────
async function loadPermissionMatrix() {
  try {
    const data = await fetch('/api/admin/permissions',{headers:{'x-session-token':LootGameAPI.getToken()}}).then(r=>r.json());
    document.getElementById('permMatrixBody').innerHTML = data.keys.map(key => `
      <tr class="border-t border-slate-800/50">
        <td class="py-2.5 pr-4 text-slate-300">${data.labels[key] || key}</td>
        <td class="py-2.5 px-4 text-center"><input type="checkbox" checked disabled class="accent-amber-500 opacity-60"></td>
        <td class="py-2.5 px-4 text-center"><input type="checkbox" ${data.roles.admin.includes(key)?'checked':''} onchange="togglePermission('admin','${key}',this.checked)" class="accent-blue-500"></td>
        <td class="py-2.5 px-4 text-center"><input type="checkbox" ${data.roles.mod.includes(key)?'checked':''} onchange="togglePermission('mod','${key}',this.checked)" class="accent-emerald-500"></td>
      </tr>`).join('');
  } catch (err) {
    document.getElementById('permMatrixBody').innerHTML = '<tr><td class="text-xs font-mono text-rose-400 py-2">Fehler: ' + err.message + '</td></tr>';
  }
}

async function togglePermission(role, key, checked) {
  try {
    const current = await fetch('/api/admin/permissions',{headers:{'x-session-token':LootGameAPI.getToken()}}).then(r=>r.json());
    let perms = current.roles[role] || [];
    perms = checked ? [...new Set([...perms, key])] : perms.filter(p => p !== key);
    const res = await fetch('/api/admin/permissions/'+role,{method:'PUT',headers:{'Content-Type':'application/json','x-session-token':LootGameAPI.getToken()},body:JSON.stringify({permissions:perms})});
    const d = await res.json();
    if (d.success) showToast('✓ Rechte für ' + role + ' aktualisiert', 'success');
    else { showToast('✗ '+(d.error||'Fehler'), 'error'); loadPermissionMatrix(); }
  } catch(e) { showToast('✗ '+e.message, 'error'); loadPermissionMatrix(); }
}

// ─── Audit Log ─────────────────────────────────────────────────────────────────
async function loadAuditLog() {
  try {
    const log = await fetch('/api/admin/audit?limit=50',{headers:{'x-session-token':LootGameAPI.getToken()}}).then(r=>r.json());
    document.getElementById('auditLog').innerHTML = log.length ? log.map(e => `
      <div class="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-800/30 text-xs font-mono">
        <div class="flex items-center gap-3">
          <span class="text-slate-500">${new Date(e.ts*1000).toLocaleString('de-DE')}</span>
          <span class="text-slate-200">${e.username}</span>
          <span class="text-emerald-400">${e.action}</span>
        </div>
        <span class="text-slate-600 truncate max-w-[200px]">${e.details ? JSON.stringify(e.details) : ''}</span>
      </div>`).join('') : '<p class="text-xs font-mono text-slate-600 p-3">Noch keine Einträge</p>';
  } catch (err) {
    document.getElementById('auditLog').innerHTML = '<p class="text-xs font-mono text-rose-400 p-3">Fehler: ' + err.message + '</p>';
  }
}

