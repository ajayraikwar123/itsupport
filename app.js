// 👉 Paste your Google Apps Script Web App URL here
const API_URL = 'https://script.google.com/macros/s/AKfycbwFKP1PUzaRVLLpOTzKNk-aOk5HD6Nm2WGfL246E8CIKFmcGhqukzO6pglQeSFxxnxGBg/exec';

const $ = s => document.querySelector(s);
let S = { token: localStorage.getItem('td_token'), user: JSON.parse(localStorage.getItem('td_user') || 'null'), tickets: [], view: 'all', mode: 'login', editId: null, centers: [] };

async function api(action, data = {}) {
  try {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: S.token, ...data }) });
    const j = await res.json();
    if (j.auth === false) logout();
    return j;
  } catch (e) { return { ok: false, error: 'Cannot reach the server. Check API_URL and your internet.' }; }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------- auth ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  S.mode = b.dataset.mode;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#login').classList.toggle('reg-on', S.mode === 'register');
  $('#authTitle').textContent = S.mode === 'login' ? 'Welcome back' : 'Create your account';
  $('#authBtn').textContent = S.mode === 'login' ? 'Sign in' : 'Create account';
  $('#authErr').textContent = '';
});
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#authBtn'); btn.disabled = true; $('#authErr').textContent = '';
  const r = await api(S.mode, { name: $('#aName').value, email: $('#aEmail').value, password: $('#aPass').value });
  btn.disabled = false;
  if (!r.ok) return $('#authErr').textContent = r.error;
  S.token = r.token; S.user = r.user;
  localStorage.setItem('td_token', r.token); localStorage.setItem('td_user', JSON.stringify(r.user));
  boot();
};
function logout() { localStorage.removeItem('td_token'); localStorage.removeItem('td_user'); S.token = null; S.user = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
$('#logout').onclick = logout;

/* ---------- app ---------- */
async function boot() {
  if (!S.token) return;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#meName').textContent = S.user.name; $('#meRole').textContent = S.user.role === 'admin' ? 'IT Support' : 'Customer';
  $('.adm').classList.toggle('hidden', S.user.role !== 'admin');
  $('#month').value = new Date().toISOString().slice(0, 7);
  await load();
}
async function load() {
  const r = await api('list');
  if (r.ok) { S.tickets = r.tickets; S.centers = r.centers || []; fillCenters(); render(); } else toast(r.error);
}
function fillCenters() {
  const opts = S.centers.map(c => `<option>${esc(c)}</option>`).join('');
  $('#tCenter').innerHTML = '<option value="">Select center…</option>' + opts;
  const f = $('#fCenter'), cur = f.value;
  f.innerHTML = '<option value="">All centers</option>' + opts; f.value = cur;
}
$('#nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.view = b.dataset.v;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  $('#viewTitle').textContent = b.textContent;
  render();
};
['#q', '#fPri', '#fCenter'].forEach(s => $(s).oninput = render);

function render() {
  const isRep = S.view === 'report';
  $('#tickets').classList.toggle('hidden', isRep); $('#report').classList.toggle('hidden', !isRep);
  if (isRep) return loadReport();
  const T = S.tickets, pend = T.filter(t => t.Status !== 'Closed').length;
  $('#stats').innerHTML = [['Total', T.length], ['Pending', pend], ['Completed', T.length - pend], ['Urgent open', T.filter(t => t.Priority === 'Urgent' && t.Status !== 'Closed').length]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  const q = $('#q').value.toLowerCase(), p = $('#fPri').value, c = $('#fCenter').value;
  const list = T.filter(t => (S.view === 'pending' ? t.Status !== 'Closed' : S.view === 'done' ? t.Status === 'Closed' : true)
    && (!p || t.Priority === p) && (!c || t.Center === c) && (!q || [t.TicketID, t.Title, t.CreatedBy, t.Center].join(' ').toLowerCase().includes(q)));
  $('#rows').innerHTML = list.length ? list.map(t => `<tr>
    <td><b>${esc(t.TicketID)}</b></td>
    <td>${esc(t.Title)}<small>${esc(t.Category)} · ${esc(t.Description)}</small></td>
    <td>${esc(t.Center) || '—'}</td>
    <td><span class="tag p-${esc(t.Priority)}">${esc(t.Priority)}</span></td>
    <td><span class="tag ${esc(t.Status).replace(/ /g,"")}">${esc(t.Status)}</span>${t.Status === 'Closed' && t.ClosedBy ? `<small>by ${esc(t.ClosedBy)}</small>` : ''}</td>
    <td>${esc(t.CreatedBy)}</td><td>${fmt(t.CreatedAt)}</td>
    <td><button class="edit" data-id="${esc(t.TicketID)}">${t.Status === 'Closed' && S.user.role !== 'admin' ? 'View' : 'Edit'}</button></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">No tickets here yet. Use “New ticket” to raise one.</td></tr>`;
}
$('#rows').onclick = e => { const b = e.target.closest('.edit'); if (b) openModal(b.dataset.id); };

/* ---------- modal ---------- */
function openModal(id) {
  S.editId = id || null;
  const t = id ? S.tickets.find(x => x.TicketID === id) : {};
  const locked = !!(id && t.Status === 'Closed' && S.user.role !== 'admin');
  $('#mTitle').textContent = id ? `${id} – ${locked ? 'Details' : 'Edit ticket'}` : 'New ticket';
  $('#tTitle').value = t.Title || ''; $('#tDesc').value = t.Description || '';
  $('#tPri').value = t.Priority || 'Medium'; $('#tCat').value = t.Category || 'General';
  $('#tStatus').value = t.Status || 'Open'; $('#tRes').value = t.Resolution || '';
  if (t.Center && ![...$('#tCenter').options].some(o => o.value === t.Center)) $('#tCenter').add(new Option(t.Center, t.Center));
  $('#tCenter').value = t.Center || ''; $('#tCenter').required = !id;
  const ci = $('#tClosed'); ci.classList.toggle('hidden', t.Status !== 'Closed');
  ci.textContent = t.Status === 'Closed' ? `Closed by ${t.ClosedBy || 'IT Support'} on ${fmt(t.ClosedAt)}` : '';
  document.querySelectorAll('#tForm input,#tForm select,#tForm textarea').forEach(el => el.disabled = locked);
  $('#saveBtn').classList.toggle('hidden', locked); $('#tErr').textContent = '';
  $('#modal').classList.remove('hidden');
}
$('#newBtn').onclick = () => openModal();
$('#cancel').onclick = () => $('#modal').classList.add('hidden');
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };
$('#tForm').onsubmit = async e => {
  e.preventDefault();
  const btn = $('#saveBtn'); btn.disabled = true;
  const d = { title: $('#tTitle').value.trim(), description: $('#tDesc').value, priority: $('#tPri').value, category: $('#tCat').value, center: $('#tCenter').value };
  if (S.user.role === 'admin') { d.status = $('#tStatus').value; d.resolution = $('#tRes').value; }
  const r = S.editId ? await api('update', { id: S.editId, ...d }) : await api('create', d);
  btn.disabled = false;
  if (!r.ok) return $('#tErr').textContent = r.error;
  $('#modal').classList.add('hidden');
  toast(S.editId ? (d.status === 'Closed' ? 'Ticket closed – email sent' : 'Ticket updated') : `Ticket ${r.id} created`);
  load();
};

/* ---------- report ---------- */
$('#month').onchange = loadReport;
$('#printBtn').onclick = () => window.print();
async function loadReport() {
  const r = await api('report', { month: $('#month').value });
  if (!r.ok) return toast(r.error);
  $('#rStats').innerHTML = [['Created', r.created], ['Closed', r.closed], ['Still pending', r.pending], ['Avg. hours to close', r.avgHours]]
    .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  const bars = o => { const m = Math.max(1, ...Object.values(o)); return Object.keys(o).length ? Object.entries(o).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div><i style="width:${v / m * 100}%"></i></div><b>${v}</b></div>`).join('') : '<p class="empty">No tickets this month.</p>'; };
  $('#rPri').innerHTML = bars(r.byPriority); $('#rCat').innerHTML = bars(r.byCategory);
  $('#rCen').innerHTML = bars(r.byCenter); $('#rAgent').innerHTML = bars(r.byAgent);
}

boot();
