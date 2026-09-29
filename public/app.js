const $ = (s, root = document) => root.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>', inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>', link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 1)"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>' };
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const stateLabels = { QUEUED: 'กำลังคัดกรอง', AWAITING_ANWC: 'รอ ANWC ตรวจสอบ', AWAITING_NHSO: 'ส่งต่อ NHSO', IN_PROGRESS_NHSO: 'NHSO กำลังแก้ไข', CLOSED: 'ปิดเคสแล้ว' };
const actionLabels = { ALERT_RECEIVED: 'รับ Alert เข้าระบบ', ALERT_UPDATED: 'ได้รับข้อมูลใหม่', TRIAGE_COMPLETED: 'คัดกรองเสร็จแล้ว', DEMO_CLOSED: 'ปิดเคสตัวอย่าง', DEMO_HANDOFF: 'ส่งต่อเคสตัวอย่าง', DELIVERED: 'ส่งข้อมูลสำเร็จ', JOB_FAILED: 'งานไม่สำเร็จ', DELIVERY_UNCERTAIN: 'ต้องตรวจผลการส่ง', JOB_RETRIED: 'ลองส่งใหม่', ZOHO_STATUS_SYNCED: 'รับสถานะจาก Zoho' };
let config, cases = [], audit = [], jobs = [], page = 'overview', query = '', level = '', status = '';
let currentCase;
const badge = s => `<span class="badge ${s || 'UNKNOWN'}">${s || 'รอประเมิน'}</span>`;
const time = value => new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 4500); }
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Prasittichoke': '1', ...options.headers } });
  const data = await res.json();
  if (res.status === 401) { login(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ');
  return data;
}
const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });
function login() {
  config = null;
  $('#case-dialog').close();
  $('#app').innerHTML = `<main class="login"><form class="login-card" id="login-form"><div class="brand"><img src="/mark.svg" alt=""><div><strong>ประสิทธิโชค</strong><small>PRASITTICHOKE</small></div></div><h1>เข้าสู่ SOC workspace</h1><p class="subtext">ตรวจสอบเคสและติดตามการคัดกรอง</p><label for="password" class="subtext">รหัสผ่านผู้ดูแล</label><input id="password" name="password" type="password" required autocomplete="current-password" placeholder="รหัสผ่าน"><p class="error" id="login-error"></p><button class="btn primary">เข้าสู่ระบบ ${icon('arrow')}</button></form></main>`;
  $('#login-form').onsubmit = async e => {
    e.preventDefault(); const password = $('#password').value;
    try { await post('/login', { password }); await load(); } catch (error) { $('#login-error').textContent = error.message; }
  };
}
async function load() {
  try {
    const results = await Promise.all([api('/config'), api('/cases'), api('/audit'), api('/jobs')]);
    [config, cases, audit, jobs] = results;
    render();
  } catch (e) { if (config) toast(e.message); }
}
function render() {
  const names = { overview: 'ภาพรวม', cases: 'คิวเคส', rules: 'กฎการคัดกรอง', integrations: 'การเชื่อมต่อ', audit: 'ประวัติการทำงาน' };
  const nav = [['overview', 'grid'], ['cases', 'inbox'], ['rules', 'shield'], ['integrations', 'link'], ['audit', 'clock']];
  const waiting = cases.filter(c => c.state === 'AWAITING_ANWC').length;
  $('#app').innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><img src="/mark.svg" alt=""><div><strong>ประสิทธิโชค</strong><small>PRASITTICHOKE</small></div></div><div class="nav-label">WORKSPACE</div><nav class="nav" aria-label="เมนูหลัก">${nav.map(([key, i]) => `<button data-page="${key}" class="${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>${icon(i)}${names[key]}${key === 'cases' ? `<span class="count">${waiting}</span>` : ''}</button>`).join('')}</nav><div class="side-bottom"><div class="side-note"><strong>${icon('shield')} Human in the loop</strong>ทุกเคสผ่านการพิจารณาของ ANWC ก่อนปิดหรือส่งต่อ</div><div class="identity"><div class="avatar">AN</div><div><strong>SOC Engineer</strong><small>ANWC · Operations</small></div></div></div></aside><div class="main"><header class="topbar"><div class="crumb">Workspace <span>/</span> <b>${names[page]}</b></div><div class="top-actions"><span>ANWC → NHSO</span><span class="mode"><i class="dot"></i>${config.mode === 'demo' ? 'Demo workspace' : 'Live workspace'}</span>${config.authenticated ? '<button class="btn ghost" id="logout">ออกจากระบบ</button>' : ''}</div></header><main class="content" id="content"></main></div></div>`;
  $('.nav').onclick = e => { const b = e.target.closest('[data-page]'); if (b) { page = b.dataset.page; render(); } };
  if ($('#logout')) $('#logout').onclick = async () => { await post('/logout'); login(); };
  const content = $('#content');
  if (page === 'overview' || page === 'cases') content.innerHTML = dashboard(page === 'overview');
  else if (page === 'rules') content.innerHTML = rulesPage();
  else if (page === 'integrations') content.innerHTML = integrationsPage();
  else content.innerHTML = auditPage();
  bind();
}
function heading(eyebrow, title, subtitle, controls = '') {
  return `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtext">${subtitle}</p></div><div class="button-row">${controls}</div></div>`;
}
function dashboard(overview) {
  const waiting = cases.filter(c => c.state === 'AWAITING_ANWC').length;
  const urgent = cases.filter(c => c.state !== 'CLOSED' && ['HIGH', 'CRITICAL'].includes(c.decision?.severity || c.analysis?.recommendedSeverity || c.alert.sourceSeverity)).length;
  const nhso = cases.filter(c => ['AWAITING_NHSO', 'IN_PROGRESS_NHSO'].includes(c.state)).length;
  const closed = cases.filter(c => c.state === 'CLOSED').length;
  return heading('SECURITY OPERATIONS', overview ? 'ทุกเคส อยู่ในการดูแล' : 'คิวเคสของคุณ', 'คัดกรองอย่างมีหลักฐาน · ตัดสินใจโดย ANWC · ส่งต่อ NHSO อย่างชัดเจน',
    `<button class="btn" id="refresh">${icon('refresh')}รีเฟรช</button>${config.mode === 'demo' ? `<button class="btn primary" id="new-alert">${icon('plus')}ทดลองรับ Alert</button>` : ''}`) +
    (config.mode === 'demo' ? `<div class="banner"><span><strong>พื้นที่ทดลอง</strong> · ข้อมูลตัวอย่าง ไม่มีการส่งข้อความหรือเปลี่ยนเคสจริงใน Zoho Desk</span><button class="btn ghost" id="seed">โหลดเคสตัวอย่าง ${icon('arrow')}</button></div>` : '') +
    (overview ? `<section class="stats" aria-label="สรุปเคส">${[[waiting, 'รอ ANWC ตรวจสอบ', 'inbox', 'รอการยืนยันจากเจ้าหน้าที่', ''], [urgent, 'ต้องตรวจเร่งด่วน', 'alert', 'High และ Critical ที่ยังเปิดอยู่', 'urgent'], [nhso, 'อยู่ระหว่างส่งต่อ / แก้ไข', 'arrow', 'เคสที่อยู่ในความดูแล NHSO', ''], [closed, 'ปิดเคสแล้ว', 'check', 'จากข้อมูลล่าสุดในระบบ', '']].map(([n, title, i, desc, cls]) => `<article class="stat ${cls}"><div class="stat-head">${title}<span class="stat-icon">${icon(i)}</span></div><div class="stat-value">${String(n).padStart(2, '0')}</div><small>${desc}</small></article>`).join('')}</section><div class="workflow"><span class="flow-label">CASE WORKFLOW</span><div class="flow-step"><span>1</span>Tripwire</div><div class="flow-arrow">→</div><div class="flow-step"><span>2</span>Rules + LLM</div><div class="flow-arrow">→</div><div class="flow-step"><span>3</span>ANWC review</div><div class="flow-arrow">→</div><div class="flow-step"><span>4</span>ปิดเคส / ส่งต่อ NHSO</div></div>` : '') +
    `<section class="panel"><div class="panel-head"><div><h2>เคสล่าสุด <span class="pill">${cases.length} เคส</span></h2><p>ระดับที่ระบบเสนอจะแสดงแยกจากผลยืนยันของเจ้าหน้าที่</p></div><span class="refresh-time">อัปเดต ${time(new Date())}</span></div><div class="filters"><div class="search">${icon('search')}<input id="search" aria-label="ค้นหาเคส" placeholder="ค้นหา Ticket, asset หรือรายละเอียด…" value="${escape(query)}"></div><select id="severity-filter" aria-label="กรองระดับ"><option value="">ทุกระดับ</option>${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => `<option ${level === s ? 'selected' : ''} value="${s}">${s === 'UNKNOWN' ? 'รอประเมิน' : s}</option>`).join('')}</select><select id="state-filter" aria-label="กรองสถานะ"><option value="">ทุกสถานะ</option>${Object.entries(stateLabels).map(([v, label]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div id="case-table">${caseTable()}</div></section>` +
    (overview ? `<div class="bottom-grid"><section class="panel"><div class="panel-head"><h2>ช่องทางการทำงาน</h2><button class="btn ghost" data-goto="integrations">ดูการเชื่อมต่อ ${icon('arrow')}</button></div><div class="compact-content">${config.integrations.filter(i => i.id !== 'llm').map(i => `<div class="connection-row"><span class="connection-name"><span class="connection-symbol">${i.name[0]}</span>${i.name}</span><span class="pill">${connectionLabel(i)}</span></div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>ความเคลื่อนไหวล่าสุด</h2><button class="btn ghost" data-goto="audit">ทั้งหมด ${icon('arrow')}</button></div><div class="compact-content">${audit.slice(0, 3).map(a => `<div class="activity"><span class="activity-dot"></span><div>${escape(actionLabels[a.action] || a.action)} <span class="muted">· ${escape(a.case_id)}</span><small>${time(a.created_at)} · ${escape(a.actor)}</small></div></div>`).join('') || '<p class="subtext">ยังไม่มีกิจกรรม เริ่มจากโหลดเคสตัวอย่าง</p>'}</div></section></div>` : '') +
    `<footer class="footer"><span>ประสิทธิโชค · SOC triage workspace</span><span>Zoho Desk คือช่องทางตอบเคสหลัก</span></footer>`;
}
function caseTable() {
  const list = cases.filter(c => (!query || `${c.id} ${c.alert.title} ${c.alert.asset}`.toLowerCase().includes(query.toLowerCase())) && (!level || (c.analysis?.recommendedSeverity || 'UNKNOWN') === level) && (!status || c.state === status));
  if (!list.length) return `<div class="empty"><strong>${cases.length ? 'ไม่พบเคสที่ตรงกับตัวกรอง' : 'พร้อมรับเคสแรก'}</strong>${cases.length ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'โหลดเคสตัวอย่างเพื่อทดลอง workflow หรือเชื่อมต่อ Zoho Desk'}</div>`;
  return `<div class="table-scroll"><table><thead><tr><th>เคส / รายละเอียด</th><th>ASSET</th><th>ระดับที่เสนอ</th><th>สถานะ</th><th>รับเข้า</th><th></th></tr></thead><tbody>${list.map(c => `<tr><td><button class="case-title" data-case="${escape(c.id)}">${escape(c.alert.title)}</button><div class="case-id">#${escape(c.id)} · ${escape(c.analysis?.changeSource || 'กำลังประมวลผล')}${c.decision ? ` · ยืนยัน ${escape(c.decision.severity)}` : ''}</div></td><td class="asset">${escape(c.alert.asset)}<small>${escape(c.alert.system)}</small></td><td>${badge(c.analysis?.recommendedSeverity)}</td><td><span class="state ${c.state}">${escape(stateLabels[c.state])}</span></td><td class="case-id">${time(c.created_at)}</td><td><button class="btn ghost" data-case="${escape(c.id)}" aria-label="เปิดเคส ${escape(c.id)}">${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>แสดง ${list.length} จาก ${cases.length} เคส · สูงสุด 500 เคสล่าสุด</span><span>ทุกการตัดสินใจมีประวัติย้อนหลัง</span></div>`;
}
function connectionLabel(i) { return config.mode === 'demo' ? 'โหมดสาธิต' : !i.configured ? 'ยังไม่ตั้งค่า' : i.enabled ? 'ตั้งค่าแล้ว · ยังไม่ยืนยันการเชื่อมต่อ' : 'ยังไม่เปิดใช้งาน'; }
function integrationsPage() {
  const variables = { zoho: 'ZOHO_ORG_ID · ZOHO_CLIENT_ID · ZOHO_CLIENT_SECRET · ZOHO_REFRESH_TOKEN · ZOHO_TICKET_URL_PREFIX · ZOHO_WRITE_ENABLED', llm: 'LLM_ENDPOINT · LLM_API_KEY · LLM_MODEL · LLM_ENABLED', discord: 'DISCORD_WEBHOOK_URL · NOTIFICATIONS_ENABLED', telegram: 'TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · NOTIFICATIONS_ENABLED' };
  return heading('CONNECTED WORKSPACE', 'เชื่อมงานไว้ในที่เดียว', 'ตั้งค่า credentials บนเซิร์ฟเวอร์ แล้ว restart เพื่อเริ่มใช้งาน') + `<div class="banner"><span>ANWC ตอบและจัดการเคสผ่าน Zoho Desk App / Web · Discord และ Telegram ใช้แจ้งเตือนเท่านั้น</span></div><div class="card-grid">${config.integrations.map(i => `<article class="panel integration-card"><div class="button-row"><span class="connection-symbol">${i.name[0]}</span><h2>${i.name}</h2></div><p>${i.description}</p><span class="pill">${connectionLabel(i)}</span><code>${variables[i.id]}</code></article>`).join('')}</div><section class="panel"><div class="panel-head"><div><h2>งานส่งข้อมูล</h2><p>ส่ง private note และ notification แยกกัน · ถ้าไม่ทราบผลการส่ง ให้ตรวจปลายทางก่อน</p></div></div><div class="table-scroll"><table><thead><tr><th>Ticket</th><th>ช่องทาง</th><th>สถานะ</th><th>รายละเอียด</th><th></th></tr></thead><tbody>${jobs.filter(j => j.kind !== 'analyze').map(j => `<tr><td>${escape(j.case_id)}</td><td>${escape(j.kind)}</td><td>${escape(j.state)}</td><td>${escape(j.error || '—')}</td><td>${j.state === 'failed' ? `<button class="btn" data-retry="${j.id}">ลองใหม่</button>` : ''}</td></tr>`).join('')}</tbody></table>${jobs.filter(j => j.kind !== 'analyze').length ? '' : '<div class="empty">ยังไม่มีงานส่งข้อมูลภายนอก</div>'}</div></section>`;
}
function rulesPage() { return heading('TRIAGE POLICY', 'ชัดเจน ตรวจสอบได้', 'กฎเวอร์ชัน 1.0.0 · เปลี่ยนผ่านโค้ดและตรวจสอบก่อน deploy') + `<section class="panel"><div class="panel-head"><h2>กฎหลักในการคัดกรอง</h2><span class="pill">${config.rules.length} rules</span></div><div class="rules-list">${config.rules.map(r => `<div class="rule"><span class="rule-id">${r.id}</span><div><strong>${r.title}</strong><p>${r.description}</p></div></div>`).join('')}</div></section><div class="banner"><span><strong>SYSTEM ไม่ได้แปลว่า Low</strong> · ต้นเหตุ การอนุมัติ และระดับความรุนแรงเป็นคนละข้อมูลกัน กฎอัตโนมัติชุดแรกเป็น baseline สำหรับให้ SOC ทดสอบก่อนใช้งานจริง</span></div>`; }
function auditPage() { return heading('AUDIT TRAIL', 'ทุกขั้นตอน มีที่มา', 'ประวัติการรับข้อมูล วิเคราะห์ และยืนยันผล · 200 รายการล่าสุด', `<button id="refresh" class="btn">${icon('refresh')}รีเฟรช</button>`) + `<section class="panel"><div class="table-scroll"><table><thead><tr><th>เวลา</th><th>Ticket</th><th>กิจกรรม</th><th>ผู้ดำเนินการ</th><th>รายละเอียด</th></tr></thead><tbody>${audit.map(a => `<tr><td>${time(a.created_at)}</td><td>${escape(a.case_id)}</td><td>${escape(actionLabels[a.action] || a.action)}</td><td>${escape(a.actor)}</td><td class="audit-detail">${escape(a.detail)}</td></tr>`).join('')}</tbody></table>${!audit.length ? '<div class="empty">ยังไม่มีประวัติการทำงาน</div>' : ''}</div></section>`; }
function bind() {
  $('#content').onclick = async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    try {
      if (btn.dataset.case) await openCase(btn.dataset.case);
      if (btn.dataset.goto) { page = btn.dataset.goto; render(); }
      if (btn.dataset.retry) { await post(`/jobs/${btn.dataset.retry}/retry`); toast('เพิ่มงานเข้าคิวแล้ว'); await load(); }
      if (btn.id === 'refresh') await load();
      if (btn.id === 'seed') { btn.disabled = true; await post('/demo/seed'); toast('เพิ่มเคสตัวอย่างแล้ว กำลังคัดกรอง'); await load(); }
      if (btn.id === 'new-alert') intake();
    } catch (error) { toast(error.message); btn.disabled = false; }
  };
  if ($('#search')) $('#search').oninput = e => { query = e.target.value; $('#case-table').innerHTML = caseTable(); };
  if ($('#severity-filter')) $('#severity-filter').onchange = e => { level = e.target.value; $('#case-table').innerHTML = caseTable(); };
  if ($('#state-filter')) $('#state-filter').onchange = e => { status = e.target.value; $('#case-table').innerHTML = caseTable(); };
}
async function openCase(id) {
  const c = await api(`/cases/${encodeURIComponent(id)}`); currentCase = c;
  const a = c.analysis;
  const dialog = $('#case-dialog');
  dialog.innerHTML = `<div class="dialog-top"><div><div class="eyebrow">#${escape(c.id)} · REVISION ${c.revision}</div><h2>${escape(c.alert.title)}</h2></div><button class="btn ghost" data-close aria-label="ปิดรายละเอียด">${icon('close')}</button></div><div class="dialog-body"><div class="detail-grid"><div><small>ระดับจาก Tripwire</small>${badge(c.alert.sourceSeverity)}</div><div><small>ระดับที่ระบบเสนอ</small>${badge(a?.recommendedSeverity)}</div><div><small>ANWC ยืนยัน</small>${c.decision ? badge(c.decision.severity) : '<strong>ยังไม่ยืนยัน</strong>'}</div><div><small>Asset</small><strong>${escape(c.alert.asset)}</strong></div><div><small>ต้นเหตุ / การอนุมัติ</small><strong>${escape(a ? `${a.changeSource} / ${a.authorization}` : 'กำลังประมวลผล')}</strong></div><div><small>สถานะ</small><strong>${stateLabels[c.state]}</strong></div></div>${a ? `<section class="detail-section"><h3>ผลคัดกรองเบื้องต้น <span class="pill">${escape(a.engine)}</span></h3><p>${escape(a.summary)}</p>${a.missingEvidence.length ? `<div class="notice">ยังต้องตรวจสอบ:<ul>${a.missingEvidence.map(x => `<li>${escape(x)}</li>`).join('')}</ul></div>` : ''}<div class="case-id">กฎ ${escape(a.matchedRuleIds.join(', '))} · หลักฐาน ${escape(a.evidenceRefs.join(', ') || 'ยังไม่มี')} · rules ${a.ruleVersion} / prompt ${a.promptVersion}</div></section>` : '<p class="notice">กำลังคัดกรอง กรุณาปิดและเปิดเคสอีกครั้งเพื่อดูผล</p>'}<section class="detail-section"><h3>หลักฐานการเปลี่ยนแปลง · ${escape(c.alert.path || 'ไม่ได้ระบุ path')}</h3><pre>${escape(c.alert.diff || 'ยังไม่มีรายละเอียด diff')}</pre></section>${a ? `<section class="detail-section"><h3>ร่างคำตอบ · รอ ANWC ตรวจแก้</h3><pre class="draft">${escape(a.replyDraft)}</pre><button class="btn" id="copy-draft">คัดลอกร่างคำตอบ</button></section>${a.incidentDraft ? `<section class="detail-section"><h3>Incident report · Draft</h3><pre>${escape(a.incidentDraft)}</pre></section>` : ''}` : ''}${c.ticketUrl ? `<a class="btn primary" href="${escape(c.ticketUrl)}" target="_blank" rel="noopener noreferrer">เปิดเคสใน Zoho Desk ${icon('external')}</a>` : ''}${config.mode === 'live' ? `<p class="notice">ยืนยันผล ตอบ และส่งต่อผ่าน Zoho Desk · สถานะที่แสดงมาจาก integration ล่าสุด${!c.ticketUrl ? ' · ยังไม่ได้ตั้งค่าลิงก์ของ Zoho tenant' : ''}</p>` : c.state === 'AWAITING_ANWC' ? `<form class="review-box" id="decision-form"><h3>ทดลองตัดสินใจในฐานะ ANWC</h3><p class="notice">การกระทำนี้เปลี่ยนเฉพาะเคสตัวอย่าง ไม่ได้ตอบหรือส่งต่อใน Zoho จริง</p><label>ระดับที่ยืนยัน<select name="severity" required><option value="">เลือกระดับ</option>${['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(s => `<option value="${s}">${s}</option>`).join('')}</select></label><label>เหตุผลและหลักฐานที่ตรวจสอบ<textarea name="reason" rows="3" required minlength="10" maxlength="3000" placeholder="ระบุเหตุผลอย่างน้อย 10 ตัวอักษร"></textarea></label><button class="btn primary">ยืนยันผลตัวอย่าง ${icon('check')}</button></form>` : ''}<section class="detail-section"><h3>ประวัติของเคส</h3>${c.audit.map(x => `<div class="activity"><span class="activity-dot"></span><div>${escape(actionLabels[x.action] || x.action)}<small>${time(x.created_at)} · ${escape(x.actor)}</small></div></div>`).join('')}</section></div>`;
  $('[data-close]', dialog).onclick = () => dialog.close();
  if ($('#copy-draft')) $('#copy-draft').onclick = async () => { try { await navigator.clipboard.writeText(a.replyDraft); toast('คัดลอกร่างคำตอบแล้ว'); } catch { toast('คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอก'); } };
  if ($('#decision-form')) $('#decision-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target; const button = $('button', form); button.disabled = true;
    try { await post(`/cases/${encodeURIComponent(c.id)}/decision`, { revision: c.revision, severity: form.elements.severity.value, reason: form.elements.reason.value }); dialog.close(); toast('บันทึกผลตัวอย่างแล้ว'); await load(); }
    catch (error) { toast(error.message); button.disabled = false; }
  };
  if (!dialog.open) dialog.showModal();
}
function intake() {
  const dialog = $('#intake-dialog');
  dialog.innerHTML = `<div class="dialog-top"><div><div class="eyebrow">DEMO INTAKE</div><h2>ทดลองรับ Alert</h2></div><button class="btn ghost" data-close aria-label="ปิดฟอร์ม">${icon('close')}</button></div><form class="intake-form" id="intake-form"><p class="subtext">ลองวางรายละเอียดการเปลี่ยนแปลงเพื่อดูผลคัดกรอง ไม่ส่งข้อมูลออกจากเครื่องในโหมดสาธิต</p><div class="form-grid"><label>ชื่อเคส<input name="title" required maxlength="250" placeholder="Configuration changed"></label><label>Asset<input name="asset" required maxlength="150" placeholder="web-prod-01"></label><label>ประเภทระบบ<select name="system">${['Linux', 'Oracle', 'Web', 'Palo Alto', 'F5', 'Other'].map(s => `<option>${s}</option>`).join('')}</select></label><label>ระดับจาก Tripwire<select name="sourceSeverity">${['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(s => `<option ${s === 'MEDIUM' ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div><label>Path / Object<input name="path" maxlength="1000" placeholder="/etc/ssh/sshd_config"></label><label>รายละเอียด diff<textarea name="diff" rows="6" maxlength="30000" placeholder="- ค่าเดิม&#10;+ ค่าใหม่"></textarea></label><p class="notice">เคสที่สร้างจากฟอร์มนี้ถือว่ายังมีบริบทไม่ครบ ต้องให้ ANWC ตรวจสอบเพิ่มเติม</p><button class="btn primary">เพิ่มเข้าคิวคัดกรอง ${icon('arrow')}</button></form>`;
  $('[data-close]', dialog).onclick = () => dialog.close();
  $('#intake-form').onsubmit = async e => {
    e.preventDefault(); const form = e.target; const b = $('button', form); b.disabled = true;
    try { const values = Object.fromEntries(new FormData(form)); const id = crypto.randomUUID(); await post('/demo/alerts', { ...values, eventId: id, ticketId: `DEMO-${id.slice(0, 8)}`, revision: 1, occurredAt: new Date().toISOString(), evidenceComplete: false }); dialog.close(); toast('รับ Alert แล้ว กำลังคัดกรอง'); await load(); }
    catch (error) { toast(error.message); b.disabled = false; }
  };
  dialog.showModal();
}
await load();
setInterval(async () => {
  if (!config || document.hidden || $('#case-dialog').open || $('#intake-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  await load();
}, 10000);
