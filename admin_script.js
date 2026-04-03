
const API = '';
let TOKEN = localStorage.getItem('ot_token');
let currentPage = 'dashboard';
let editingUserId = null;
let editingPlanId = null;
let editingServiceId = null;
let editingFeatureId = null;
let editingIndustryId = null;
let planFeatures = [];
let svBullets = [];

// ── AUTH ──
async function doAdminLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const err = document.getElementById('loginErr');
  if (!email || !password) { err.textContent = 'Enter email and password'; err.classList.add('active'); return; }
  try {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
    const data = await r.json();
    if (!r.ok || data.user?.role !== 'admin') { err.textContent = data.error || 'Admin access required'; err.classList.add('active'); return; }
    TOKEN = data.token;
    localStorage.setItem('ot_token', TOKEN);
    initAdmin(data.user);
  } catch(e) { err.textContent = 'Server unreachable'; err.classList.add('active'); }
}

function initAdmin(user) {
  document.getElementById('loginPage').style.display = 'none';
  const panel = document.getElementById('adminPanel');
  panel.style.display = 'flex';
  panel.style.width = '100%';
  if (user) {
    document.getElementById('sb-email').textContent = user.email;
    document.getElementById('sb-company').textContent = user.company_name || 'OrbiTxt';
  }
  loadDashboard();
  loadLeadBadge();
}

function logout() {
  localStorage.removeItem('ot_token');
  location.reload();
}

async function apiFetch(url, opts={}) {
  const r = await fetch(url, { ...opts, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers||{}) } });
  if (r.status === 401) { logout(); return null; }
  return r;
}

function toast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${id}`);
  if (page) page.classList.add('active');
  const activeBtn = document.querySelector(`.nav-item[onclick=\"showPage('${id}')\"]`);
  if (activeBtn) activeBtn.classList.add('active');
  const titles = { dashboard:'Dashboard', sections:'Section Visibility', content:'Site Content', stats:'Hero Stats', services:'Services', features:'Why Choose Us', industries:'Industries', plans:'Pricing Plans', users:'Users', leads:'Leads', activity:'Activity Log' };
  document.getElementById('pageTitle').textContent = titles[id] || id;
  currentPage = id;
  const loaders = { dashboard: loadDashboard, sections: loadSections, content: loadContent, stats: loadStats, services: loadServices, features: loadFeatures, industries: loadIndustries, plans: loadPlans, users: loadUsers, leads: loadLeads, activity: loadActivity };
  if (loaders[id]) loaders[id]().catch(err => { console.error('page load failed', id, err); toast('Failed to load ' + (titles[id] || id), 'error'); });
}

// ── DASHBOARD ──
async function loadDashboard() {
  const r = await apiFetch('/api/admin/dashboard');
  if (!r) return;
  const data = await r.json();
  document.getElementById('d-total').textContent = data.totalUsers;
  document.getElementById('d-active').textContent = data.activeUsers;
  document.getElementById('d-plans').textContent = data.totalPlans;
  document.getElementById('d-recent').textContent = data.recentUsers.length;
  // Fetch new leads count
  apiFetch('/api/admin/leads').then(async lr => { if(lr){ const ld=await lr.json(); document.getElementById('d-leads').textContent=ld.counts.new||0; const b=document.getElementById('lead-badge'); if(b){b.textContent=ld.counts.new;b.style.display=ld.counts.new>0?'inline':'none';} } });
  document.getElementById('d-users').innerHTML = data.recentUsers.map(u => `<tr><td><strong>${u.company_name}</strong></td><td style="color:var(--muted)">${u.email}</td><td style="color:var(--muted);font-size:0.78rem">${u.created_at.substring(0,10)}</td></tr>`).join('');
  document.getElementById('d-activity').innerHTML = data.recentActivity.length ? data.recentActivity.slice(0,6).map(a => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div><div class="activity-action">${a.action}</div><div class="activity-detail">${a.details || '—'} · ${a.admin_email}</div></div>
      <div class="activity-time">${a.created_at.substring(0,16).replace('T',' ')}</div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:0.875rem;padding:12px 0">No activity yet.</div>';
}

// ── SECTIONS ──
async function loadSections() {
  const r = await apiFetch('/api/admin/sections');
  if (!r) return;
  const { sections } = await r.json();
  document.getElementById('sections-grid').innerHTML = sections.map(s => `
    <div class="section-toggle ${s.visible ? 'visible' : 'hidden'}" id="stog-${s.section_key}">
      <div>
        <div class="section-toggle-label">${s.label}</div>
        <div class="section-toggle-status">${s.visible ? 'Visible' : 'Hidden'}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${s.visible ? 'checked' : ''} onchange="toggleSection('${s.section_key}', this.checked)" />
        <span class="toggle-slider"></span>
      </label>
    </div>`).join('');
}

async function toggleSection(key, visible) {
  const r = await apiFetch(`/api/admin/sections/${key}`, { method: 'PUT', body: JSON.stringify({ visible }) });
  if (r?.ok) {
    const el = document.getElementById(`stog-${key}`);
    el.className = `section-toggle ${visible ? 'visible' : 'hidden'}`;
    el.querySelector('.section-toggle-status').textContent = visible ? 'Visible' : 'Hidden';
    toast(`Section ${visible ? 'shown' : 'hidden'}`);
  }
}

// ── CONTENT ──
async function loadContent() {
  const r = await apiFetch('/api/admin/content');
  if (!r) return;
  const { content } = await r.json();
  document.getElementById('content-tbody').innerHTML = content.map(c => `
    <tr>
      <td><span class="badge badge-client">${c.section}</span></td>
      <td style="color:var(--muted);font-size:0.8rem">${c.key}</td>
      <td class="value-cell" id="cv-${c.id}">
        <span class="editable" onclick="editContent(${c.id}, '${c.section}', '${c.key}', this)">${escHtml(c.value)}</span>
      </td>
      <td></td>
    </tr>`).join('');
}

function editContent(id, section, key, el) {
  const val = el.textContent;
  const long = val.length > 60;
  el.parentElement.innerHTML = `
    <div class="inline-form">
      ${long ? `<textarea id="ci-${id}" rows="3" style="flex:1">${escHtml(val)}</textarea>` : `<input id="ci-${id}" value="${escHtml(val)}" />`}
      <button class="btn btn-success btn-sm" onclick="saveContent('${section}','${key}',${id})">✓</button>
      <button class="btn btn-ghost btn-sm" onclick="loadContent()">✕</button>
    </div>`;
}

async function saveContent(section, key, id) {
  const el = document.getElementById(`ci-${id}`);
  const value = el.value;
  const r = await apiFetch('/api/admin/content', { method: 'PUT', body: JSON.stringify({ section, key, value }) });
  if (r?.ok) { toast('Content updated'); loadContent(); } else toast('Failed to save', 'error');
}

// ── STATS ──
async function loadStats() {
  const r = await apiFetch('/api/admin/stats');
  if (!r) return;
  const { stats } = await r.json();
  document.getElementById('stats-tbody').innerHTML = stats.map(s => `
    <tr>
      <td><input id="sl-${s.id}" value="${escHtml(s.label)}" style="background:transparent;border:none;color:var(--text);font-family:inherit;font-size:inherit;width:140px;padding:4px 8px;border-radius:6px;border:1px solid transparent" onfocus="this.style.borderColor='var(--border2)'" /></td>
      <td><input id="sv-${s.id}" value="${escHtml(s.value)}" style="background:transparent;border:none;color:var(--white);font-family:inherit;font-size:inherit;font-weight:700;width:100px;padding:4px 8px;border-radius:6px;border:1px solid transparent" onfocus="this.style.borderColor='var(--border2)'" /></td>
      <td><button class="btn btn-success btn-sm" onclick="saveStat(${s.id})">Save</button></td>
    </tr>`).join('');
}

async function saveStat(id) {
  const label = document.getElementById(`sl-${id}`).value;
  const value = document.getElementById(`sv-${id}`).value;
  const r = await apiFetch(`/api/admin/stats/${id}`, { method: 'PUT', body: JSON.stringify({ label, value }) });
  if (r?.ok) toast('Stat updated'); else toast('Failed', 'error');
}

// ── SERVICES ──
let servicesList = [];
async function loadServices() {
  const r = await apiFetch('/api/admin/services');
  if (!r) return;
  const { services } = await r.json();
  servicesList = services;
  document.getElementById('services-list').innerHTML = services.length ? services.map(s => {
    const bullets = arrSafe(s.bullet_points);
    return `
    <div class="service-item">
      <div class="item-icon">${s.icon || '📦'}</div>
      <div class="item-info">
        <h4>${escHtml(s.title)} ${boolLabel(!!s.active, 'Active', 'Hidden')}</h4>
        <p>${escHtml(s.description || '')}</p>
        <p style="margin-top:6px;font-size:0.72rem;color:var(--muted)">${bullets.length ? bullets.map(b => `• ${escHtml(b)}`).join(' &nbsp;') : 'No bullet points added.'}</p>
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" onclick="openServiceModal(${s.id})">Edit</button>
        <button class="btn ${s.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleServiceActive(${s.id}, ${s.active ? 0 : 1})">${s.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('services', ${s.id}, loadServices)">Delete</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="icon">⚙️</div><p>No services yet.</p></div>';
}

function openServiceModal(id=null) {
  editingServiceId = id;
  svBullets = [];
  document.getElementById('serviceModalTitle').textContent = id ? 'Edit Service' : 'Add Service';
  if (id) {
    const s = servicesList.find(x => sameId(x.id, id));
    if (s) {
      document.getElementById('sv-icon').value = s.icon;
      document.getElementById('sv-title').value = s.title;
      document.getElementById('sv-desc').value = s.description;
      document.getElementById('sv-order').value = s.sort_order;
      document.getElementById('sv-active').value = s.active ? '1' : '0';
      svBullets = [...arr(s.bullet_points)];
    }
  } else {
    ['sv-icon','sv-title','sv-desc','sv-order'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('sv-active').value = '1';
  }
  renderSvBullets();
  openModal('serviceModal');
}

function renderSvBullets() {
  document.getElementById('sv-bullet-tags').innerHTML = arrSafe(svBullets).map((b,i) => `<span class="feature-tag">${escHtml(b)}<button onclick="svBullets.splice(${i},1);renderSvBullets()">×</button></span>`).join('');
}

function addSvBullet() {
  const inp = document.getElementById('sv-bullet-input');
  if (inp.value.trim()) { svBullets.push(inp.value.trim()); inp.value=''; renderSvBullets(); }
}

async function saveService() {
  const body = { icon: document.getElementById('sv-icon').value||'📦', title: document.getElementById('sv-title').value, description: document.getElementById('sv-desc').value, bullet_points: svBullets, sort_order: parseInt(document.getElementById('sv-order').value)||99, active: parseInt(document.getElementById('sv-active').value) };
  if (!body.title) { toast('Title required', 'error'); return; }
  const url = editingServiceId ? `/api/admin/services/${editingServiceId}` : '/api/admin/services';
  const method = editingServiceId ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, body: JSON.stringify(body) });
  if (r?.ok) { toast('Service saved'); closeModal('serviceModal'); loadServices(); } else toast('Failed', 'error');
}

async function toggleServiceActive(id, active) {
  const r = await apiFetch(`/api/admin/services/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (r?.ok) { toast(active ? 'Service shown' : 'Service hidden'); loadServices(); } else toast('Failed', 'error');
}

// ── FEATURES ──
let featuresList = [];
async function loadFeatures() {
  const r = await apiFetch('/api/admin/features');
  if (!r) return;
  const { features } = await r.json();
  featuresList = features;
  document.getElementById('features-list').innerHTML = features.length ? features.map(f => `
    <div class="feature-item">
      <div class="item-icon">${f.icon || '📦'}</div>
      <div class="item-info">
        <h4>${escHtml(f.title)} ${boolLabel(!!f.active, 'Active', 'Hidden')}</h4>
        <p>${escHtml(f.description || '')}</p>
      </div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" onclick="openFeatureModal(${f.id})">Edit</button>
        <button class="btn ${f.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleFeatureActive(${f.id}, ${f.active ? 0 : 1})">${f.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('features', ${f.id}, loadFeatures)">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">💡</div><p>No features yet.</p></div>';
}

function openFeatureModal(id=null) {
  editingFeatureId = id;
  document.getElementById('featureModalTitle').textContent = id ? 'Edit Feature' : 'Add Feature';
  if (id) {
    const f = featuresList.find(x => sameId(x.id, id));
    if (f) { document.getElementById('f-icon').value=f.icon; document.getElementById('f-title').value=f.title; document.getElementById('f-desc').value=f.description; document.getElementById('f-order').value=f.sort_order; document.getElementById('f-active').value=f.active; }
  } else {
    ['f-icon','f-title','f-desc','f-order'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('f-active').value='1';
  }
  openModal('featureModal');
}

async function saveFeature() {
  const body = { icon: document.getElementById('f-icon').value||'📦', title: document.getElementById('f-title').value, description: document.getElementById('f-desc').value, sort_order: parseInt(document.getElementById('f-order').value)||99, active: parseInt(document.getElementById('f-active').value) };
  if (!body.title) { toast('Title required','error'); return; }
  const url = editingFeatureId ? `/api/admin/features/${editingFeatureId}` : '/api/admin/features';
  const method = editingFeatureId ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, body: JSON.stringify(body) });
  if (r?.ok) { toast('Feature saved'); closeModal('featureModal'); loadFeatures(); } else toast('Failed','error');
}

async function toggleFeatureActive(id, active) {
  const r = await apiFetch(`/api/admin/features/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (r?.ok) { toast(active ? 'Feature shown' : 'Feature hidden'); loadFeatures(); } else toast('Failed', 'error');
}

// ── INDUSTRIES ──
let industriesList = [];
async function loadIndustries() {
  const r = await apiFetch('/api/admin/industries');
  if (!r) return;
  const { industries } = await r.json();
  industriesList = industries;
  document.getElementById('industries-list').innerHTML = industries.length ? industries.map(i => `
    <div class="industry-item">
      <div class="item-icon">${i.icon || '🏢'}</div>
      <div class="item-info"><h4>${escHtml(i.name)} ${boolLabel(!!i.active, 'Active', 'Hidden')}</h4></div>
      <div class="item-actions">
        <button class="btn btn-ghost btn-sm" onclick="openIndustryModal(${i.id})">Edit</button>
        <button class="btn ${i.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleIndustryActive(${i.id}, ${i.active ? 0 : 1})">${i.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('industries', ${i.id}, loadIndustries)">Delete</button>
      </div>
    </div>`).join('') : '<div class="empty-state"><div class="icon">🏢</div><p>No industries yet.</p></div>';
}

function openIndustryModal(id=null) {
  editingIndustryId = id;
  document.getElementById('industryModalTitle').textContent = id ? 'Edit Industry' : 'Add Industry';
  if (id) {
    const i = industriesList.find(x => sameId(x.id, id));
    if (i) { document.getElementById('i-icon').value=i.icon; document.getElementById('i-name').value=i.name; document.getElementById('i-order').value=i.sort_order; document.getElementById('i-active').value=i.active; }
  } else {
    ['i-icon','i-name','i-order'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('i-active').value='1';
  }
  openModal('industryModal');
}

async function saveIndustry() {
  const body = { icon: document.getElementById('i-icon').value||'🏢', name: document.getElementById('i-name').value, sort_order: parseInt(document.getElementById('i-order').value)||99, active: parseInt(document.getElementById('i-active').value) };
  if (!body.name) { toast('Name required','error'); return; }
  const url = editingIndustryId ? `/api/admin/industries/${editingIndustryId}` : '/api/admin/industries';
  const r = await apiFetch(url, { method: editingIndustryId?'PUT':'POST', body: JSON.stringify(body) });
  if (r?.ok) { toast('Industry saved'); closeModal('industryModal'); loadIndustries(); } else toast('Failed','error');
}

async function toggleIndustryActive(id, active) {
  const r = await apiFetch(`/api/admin/industries/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (r?.ok) { toast(active ? 'Industry shown' : 'Industry hidden'); loadIndustries(); } else toast('Failed', 'error');
}

// ── PLANS ──
let plansList = [];
async function loadPlans() {
  const r = await apiFetch('/api/admin/plans');
  if (!r) return;
  const { plans } = await r.json();
  plansList = plans;
  document.getElementById('plans-tbody').innerHTML = plans.map(p => `
    <tr>
      <td><strong>${escHtml(p.name)}</strong></td>
      <td>${p.price===0?'Custom':'₹'+p.price.toLocaleString('en-IN')}</td>
      <td style="color:var(--muted)">${p.sms_count===-1?'Unlimited':p.sms_count.toLocaleString('en-IN')}</td>
      <td>${boolLabel(!!p.active, 'Active', 'Hidden')}</td>
      <td>${p.popular?'<span class="badge badge-popular">⭐ Popular</span>':'—'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="openPlanModal(${p.id})">Edit</button>
        <button class="btn ${p.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="togglePlanActive(${p.id}, ${p.active ? 0 : 1})">${p.active ? 'Hide' : 'Show'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('plans',${p.id},loadPlans)">Delete</button>
      </td>
    </tr>`).join('');
}

function openPlanModal(id=null) {
  editingPlanId = id;
  planFeatures = [];
  document.getElementById('planModalTitle').textContent = id ? 'Edit Plan' : 'Add Plan';
  if (id) {
    const p = plansList.find(x => sameId(x.id, id));
    if (p) {
      document.getElementById('p-name').value=p.name; document.getElementById('p-price').value=p.price;
      document.getElementById('p-sms').value=p.sms_count; document.getElementById('p-panels').value=p.panels;
      document.getElementById('p-order').value=p.sort_order; document.getElementById('p-active').value=p.active;
      document.getElementById('p-popular').value=p.popular;
      planFeatures = [...arr(p.features)];
    }
  } else {
    ['p-name','p-price','p-sms','p-panels','p-order'].forEach(id => { document.getElementById(id).value=''; });
    document.getElementById('p-active').value='1'; document.getElementById('p-popular').value='0';
  }
  renderPlanFeatures();
  openModal('planModal');
}

function renderPlanFeatures() {
  document.getElementById('plan-feature-tags').innerHTML = arrSafe(planFeatures).map((f,i) => `<span class="feature-tag">${escHtml(f)}<button onclick="planFeatures.splice(${i},1);renderPlanFeatures()">×</button></span>`).join('');
}

function addPlanFeature() {
  const inp = document.getElementById('plan-feature-input');
  if (inp.value.trim()) { planFeatures.push(inp.value.trim()); inp.value=''; renderPlanFeatures(); }
}

async function savePlan() {
  const body = { name: document.getElementById('p-name').value, price: parseInt(document.getElementById('p-price').value)||0, sms_count: parseInt(document.getElementById('p-sms').value)||0, panels: parseInt(document.getElementById('p-panels').value)||1, sort_order: parseInt(document.getElementById('p-order').value)||99, active: parseInt(document.getElementById('p-active').value), popular: parseInt(document.getElementById('p-popular').value), features: planFeatures };
  if (!body.name) { toast('Name required','error'); return; }
  const url = editingPlanId ? `/api/admin/plans/${editingPlanId}` : '/api/admin/plans';
  const r = await apiFetch(url, { method: editingPlanId?'PUT':'POST', body: JSON.stringify(body) });
  if (r?.ok) { toast('Plan saved'); closeModal('planModal'); loadPlans(); } else toast('Failed','error');
}

async function togglePlanActive(id, active) {
  const r = await apiFetch(`/api/admin/plans/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (r?.ok) { toast(active ? 'Plan shown' : 'Plan hidden'); loadPlans(); } else toast('Failed', 'error');
}

// ── USERS ──
let usersList = [];
async function loadUsers() {
  const r = await apiFetch('/api/admin/users');
  if (!r) return;
  const { users } = await r.json();
  usersList = users;
  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td><strong>${escHtml(u.company_name)}</strong></td>
      <td style="color:var(--muted);font-size:0.82rem">${escHtml(u.email)}</td>
      <td><span class="badge badge-${u.role}">${u.role}</span></td>
      <td style="font-size:0.78rem;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis">${u.panel_url ? `<a href="${escHtml(u.panel_url)}" target="_blank" style="color:var(--accent);text-decoration:none" onclick="event.stopPropagation()">🔗 Open</a>` : '—'}</td>
      <td style="font-size:0.78rem;color:var(--muted)">${u.panel_username ? `<span title="User: ${escHtml(u.panel_username)}" style="color:var(--text)">✓ Set</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${u.auto_login ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:100px;font-size:.7rem;font-weight:700;background:rgba(0,229,187,.1);color:#00e5bb;border:1px solid rgba(0,229,187,.25)">⚡ ON</span>` : `<span style="color:var(--muted);font-size:.78rem">OFF</span>`}</td>
      <td style="font-size:0.82rem">${u.credits?.toLocaleString('en-IN') || 0}</td>
      <td>${boolLabel(!!u.active, 'Active', 'Inactive')}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="openUserModal(${u.id})">Edit</button>
        <button class="btn ${u.active ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleUserActive(${u.id}, ${u.active ? 0 : 1})">${u.active ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('users',${u.id},loadUsers)">Delete</button>
      </td>
    </tr>`).join('');
}

function openUserModal(id=null) {
  editingUserId = id;
  document.getElementById('userModalTitle').textContent = id ? 'Edit User' : 'Add User';
  document.getElementById('u-pwd-hint').textContent = id ? '(leave blank to keep)' : '(required)';
  if (id) {
    const u = usersList.find(x => sameId(x.id, id));
    if (u) {
      document.getElementById('u-company').value=u.company_name; document.getElementById('u-email').value=u.email;
      document.getElementById('u-password').value=''; document.getElementById('u-role').value=u.role;
      document.getElementById('u-panel').value=u.panel_url||''; document.getElementById('u-puser').value=u.panel_username||'';
      document.getElementById('u-ppass').value=u.panel_password||''; document.getElementById('u-credits').value=u.credits||0;
      document.getElementById('u-active').value = u.active ? '1' : '0';
      document.getElementById('u-autologin').checked=!!u.auto_login;
      document.getElementById('auto-login-hint').style.display=u.auto_login?'block':'none';
      updateAutoLoginBox(!!u.auto_login);
    }
  } else {
    ['u-company','u-email','u-password','u-panel','u-puser','u-ppass'].forEach(id => { document.getElementById(id).value=''; });
    document.getElementById('u-credits').value='0'; document.getElementById('u-role').value='client'; document.getElementById('u-active').value='1';
    document.getElementById('u-autologin').checked=false;
    document.getElementById('auto-login-hint').style.display='none';
    updateAutoLoginBox(false);
  }
  openModal('userModal');
}

async function saveUser() {
  const body = { company_name: document.getElementById('u-company').value, email: document.getElementById('u-email').value, role: document.getElementById('u-role').value, panel_url: document.getElementById('u-panel').value||null, panel_username: document.getElementById('u-puser').value||null, panel_password: document.getElementById('u-ppass').value||null, auto_login: document.getElementById('u-autologin').checked ? 1 : 0, credits: parseInt(document.getElementById('u-credits').value)||0, active: parseInt(document.getElementById('u-active').value) };
  const pwd = document.getElementById('u-password').value;
  if (pwd) body.password = pwd;
  if (!editingUserId && !pwd) { toast('Password required for new users','error'); return; }
  if (!body.email || !body.company_name) { toast('Email and company name required','error'); return; }
  const url = editingUserId ? `/api/admin/users/${editingUserId}` : '/api/admin/users';
  const r = await apiFetch(url, { method: editingUserId?'PUT':'POST', body: JSON.stringify(body) });
  if (r?.ok) { toast('User saved'); closeModal('userModal'); loadUsers(); } else { const d=await r.json(); toast(d.error||'Failed','error'); }
}

async function toggleUserActive(id, active) {
  const r = await apiFetch(`/api/admin/users/${id}/visibility`, { method: 'PATCH', body: JSON.stringify({ active }) });
  if (r?.ok) { toast(active ? 'User activated' : 'User deactivated'); loadUsers(); } else toast('Failed', 'error');
}


// ── LEADS ──
let currentLeadFilter = 'all';
let currentLeadSearch = '';
let currentLeadId = null;
let currentLeadStatus = 'new';

const STATUS_CONFIG = {
  new:       { label: '🆕 New',       color: '#60a5fa', bg: 'rgba(96,165,250,.12)',  border: 'rgba(96,165,250,.3)'  },
  contacted: { label: '📞 Contacted', color: '#a78bfa', bg: 'rgba(167,139,250,.12)', border: 'rgba(167,139,250,.3)' },
  qualified: { label: '✅ Qualified', color: '#34d399', bg: 'rgba(52,211,153,.12)',  border: 'rgba(52,211,153,.3)'  },
  converted: { label: '🏆 Converted', color: '#fbbf24', bg: 'rgba(251,191,36,.12)',  border: 'rgba(251,191,36,.3)'  },
  lost:      { label: '❌ Lost',      color: '#f87171', bg: 'rgba(248,113,113,.12)', border: 'rgba(248,113,113,.3)' },
};

function statusBadge(status) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:100px;font-size:.72rem;font-weight:700;background:${s.bg};color:${s.color};border:1px solid ${s.border}">${s.label}</span>`;
}

async function loadLeads() {
  const params = new URLSearchParams();
  if (currentLeadFilter !== 'all') params.set('status', currentLeadFilter);
  if (currentLeadSearch) params.set('search', currentLeadSearch);
  const r = await apiFetch('/api/admin/leads?' + params.toString());
  if (!r) return;
  const { leads, counts } = await r.json();

  // Update stat cards
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById('lc-' + k);
    if (el) el.textContent = v;
  });

  // Update sidebar badge for new leads
  const badge = document.getElementById('lead-badge');
  if (badge) {
    badge.textContent = counts.new;
    badge.style.display = counts.new > 0 ? 'inline' : 'none';
  }

  // Highlight active filter card
  ['all','new','contacted','qualified','converted','lost'].forEach(k => {
    const el = document.getElementById('ls-' + k);
    if (el) el.style.borderColor = k === currentLeadFilter ? 'var(--primary)' : 'var(--border)';
  });

  // Update filter label
  const lbl = document.getElementById('lead-filter-label');
  if (lbl) lbl.textContent = '— ' + (currentLeadFilter === 'all' ? 'All' : (STATUS_CONFIG[currentLeadFilter]?.label || currentLeadFilter));

  // Render table
  const tbody = document.getElementById('leads-tbody');
  if (!leads.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">No leads found.</td></tr>';
    return;
  }
  tbody.innerHTML = leads.map((l, i) => `
    <tr style="cursor:pointer" onclick="openLeadModal(${l.id})">
      <td style="color:var(--muted);font-size:.78rem">#${l.id}</td>
      <td><strong style="color:var(--white)">${escHtml(l.name)}</strong></td>
      <td style="color:var(--muted);font-size:.82rem">${escHtml(l.company||'—')}</td>
      <td style="font-size:.82rem"><a href="mailto:${escHtml(l.email)}" onclick="event.stopPropagation()" style="color:var(--accent);text-decoration:none">${escHtml(l.email)}</a></td>
      <td style="color:var(--muted);font-size:.82rem">${escHtml(l.phone||'—')}</td>
      <td><span class="badge" style="background:rgba(37,99,255,.1);color:#7aa8ff;border-radius:100px;padding:2px 10px;font-size:.72rem;font-weight:600">${escHtml(l.source)}</span></td>
      <td>${statusBadge(l.status)}</td>
      <td style="color:var(--muted);font-size:.78rem;white-space:nowrap">${l.created_at.substring(0,16).replace('T',' ')}</td>
      <td>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openLeadModal(${l.id})" title="View Details">👁</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteLead(${l.id})" title="Delete">🗑</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterLeads(status) {
  currentLeadFilter = status;
  loadLeads();
}

let searchTimeout;
function searchLeads(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentLeadSearch = val; loadLeads(); }, 350);
}

async function openLeadModal(id) {
  const r = await apiFetch('/api/admin/leads');
  if (!r) return;
  const { leads } = await r.json();
  const lead = leads.find(l => sameId(l.id, id));
  if (!lead) return;
  currentLeadId = id;
  currentLeadStatus = lead.status;

  document.getElementById('leadModalTitle').textContent = 'Lead — ' + lead.name;
  document.getElementById('lead-notes').value = lead.notes || '';

  document.getElementById('lead-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:18px">
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Name</div><div style="font-weight:700;color:var(--white)">${escHtml(lead.name)}</div></div>
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Company</div><div style="color:var(--text)">${escHtml(lead.company||'—')}</div></div>
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Email</div><a href="mailto:${escHtml(lead.email)}" style="color:var(--accent);text-decoration:none;font-size:.9rem">${escHtml(lead.email)}</a></div>
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Phone</div><div style="color:var(--text)">${escHtml(lead.phone||'—')}</div></div>
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Source</div><div style="color:var(--text)">${escHtml(lead.source)}</div></div>
      <div><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Received</div><div style="color:var(--text);font-size:.85rem">${lead.created_at.substring(0,16).replace('T',' ')}</div></div>
      ${lead.message ? `<div style="grid-column:span 2"><div style="font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Message</div><div style="color:var(--text);font-size:.875rem;line-height:1.6;background:rgba(255,255,255,.03);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">${escHtml(lead.message)}</div></div>` : ''}
    </div>`;

  // Status buttons
document.getElementById('lead-status-btns').innerHTML = Object.entries(STATUS_CONFIG).map(([k, s]) => `
  <button id="lsb-${k}" 
    onclick="setLeadStatus('${k}')"
    style="
      padding:7px 16px;
      border-radius:100px;
      font-size:.78rem;
      font-weight:700;
      cursor:pointer;
      border:1px solid ${s.border};
      background:${currentLeadStatus===k ? s.bg : 'transparent'};
      color:${s.color};
      font-family:DM Sans,sans-serif;
      transition:all .15s;
      outline:${currentLeadStatus===k ? '2px solid '+s.color : 'none'};
      outline-offset:2px
    ">
    ${s.label}
  </button>
`).join('');

  openModal('leadModal');
}

function setLeadStatus(status) {
  currentLeadStatus = status;
  Object.entries(STATUS_CONFIG).forEach(([k, s]) => {
    const btn = document.getElementById('lsb-' + k);
    if (btn) {
      btn.style.background = k === status ? s.bg : 'transparent';
      btn.style.outline = k === status ? '2px solid ' + s.color : 'none';
    }
  });
}

async function saveLead() {
  if (!currentLeadId) {
    toast('Lead id missing', 'error');
    return;
  }

  const notes = document.getElementById('lead-notes').value.trim();

  try {
    const r = await apiFetch('/api/admin/leads/' + currentLeadId, {
      method: 'PUT',
      body: JSON.stringify({
        status: currentLeadStatus,
        notes: notes
      })
    });

    if (!r) {
      toast('Request failed or session expired', 'error');
      return;
    }

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      toast(data.error || 'Failed to update', 'error');
      return;
    }

    toast('Lead updated');
    closeModal('leadModal');
    loadLeads();
  } catch (e) {
    console.error('saveLead error:', e);
    toast('Failed to update', 'error');
  }
}

async function deleteLead(id) {
  if (!confirm('Delete this lead permanently?')) return;
  const r = await apiFetch('/api/admin/leads/' + id, { method: 'DELETE' });
  if (r?.ok) {
    toast('Lead deleted');
    closeModal('leadModal');
    loadLeads();
  } else {
    toast('Failed to delete', 'error');
  }
}

// Load lead badge count on init
async function loadLeadBadge() {
  const r = await apiFetch('/api/admin/leads?status=new');
  if (!r) return;
  const { counts } = await r.json();
  const badge = document.getElementById('lead-badge');
  if (badge) {
    badge.textContent = counts.new;
    badge.style.display = counts.new > 0 ? 'inline' : 'none';
  }
}

// ── ACTIVITY ──
async function loadActivity() {
  const r = await apiFetch('/api/admin/activity');
  if (!r) return;
  const { logs } = await r.json();
  document.getElementById('activity-list').innerHTML = logs.length ? logs.map(a => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div><div class="activity-action">${a.action}</div><div class="activity-detail">${a.details||'—'} · by ${a.admin_email}</div></div>
      <div class="activity-time">${a.created_at.substring(0,16).replace('T',' ')}</div>
    </div>`).join('') : '<div style="color:var(--muted);padding:20px 0">No activity logged yet.</div>';
}

// ── HELPERS ──
async function deleteItem(type, id, reload) {
  if (!confirm('Delete this item?')) return;
  const r = await apiFetch(`/api/admin/${type}/${id}`, { method: 'DELETE' });
  if (r?.ok) { toast('Deleted'); reload(); } else toast('Failed to delete','error');
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function sameId(a, b) { return Number(a) === Number(b) || String(a) === String(b); }
function arrSafe(v) { return Array.isArray(v) ? v : []; }
function boolLabel(v, on='Active', off='Hidden') { return v ? `<span class=\"badge badge-active\">${on}</span>` : `<span class=\"badge badge-inactive\">${off}</span>`; }

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
});

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function arr(v) { return Array.isArray(v) ? v : []; }

// ── INIT ──
if (TOKEN) {
  apiFetch('/api/auth/me').then(async r => {
    if (!r) return;
    const { user } = await r.json();
    if (user?.role === 'admin') initAdmin(user);
  });
}
// ── AUTO LOGIN HELPERS ──
function toggleAutoLoginHint() {
  const checked = document.getElementById('u-autologin').checked;
  document.getElementById('auto-login-hint').style.display = checked ? 'block' : 'none';
  updateAutoLoginBox(checked);
}
function updateAutoLoginBox(on) {
  const box = document.getElementById('auto-login-box');
  if (!box) return;
  box.style.borderColor = on ? 'rgba(0,229,187,.4)' : 'rgba(37,99,255,.2)';
  box.style.background = on ? 'rgba(0,229,187,.06)' : 'rgba(37,99,255,.06)';
}
