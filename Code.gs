/**
 * TicketDesk backend – Google Apps Script
 * 1. Open your Google Sheet > Extensions > Apps Script, paste this file.
 * 2. Run setup() once (authorize). It creates the "Tickets" and "Users" sheets
 *    and a first admin: admin@example.com / admin123  (change it!)
 * 3. Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
 * 4. Copy the Web app URL into API_URL in app.js.
 */
const HEAD = ['TicketID','Title','Description','Priority','Category','Status','CreatedBy','Email','CreatedAt','UpdatedAt','ClosedAt','Resolution','Center','ClosedBy'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let t = ss.getSheetByName('Tickets') || ss.insertSheet('Tickets');
  if (!t.getLastRow()) t.appendRow(HEAD);
  else { // upgrade an older sheet: add any missing columns (Center, ClosedBy)
    const have = t.getRange(1, 1, 1, t.getLastColumn()).getValues()[0];
    HEAD.forEach(h => { if (have.indexOf(h) < 0) t.getRange(1, t.getLastColumn() + 1).setValue(h); });
  }
  let u = ss.getSheetByName('Users') || ss.insertSheet('Users');
  if (!u.getLastRow()) {
    u.appendRow(['Name','Email','PasswordHash','Role']);
    u.appendRow(['Admin','admin@example.com',hash_('admin123'),'admin']);
  }
  // Centers list: edit this sheet to add / rename your centers (one per row)
  let c = ss.getSheetByName('Centers') || ss.insertSheet('Centers');
  if (!c.getLastRow()) {
    c.appendRow(['Center']);
    ['Main Center', 'Center 2', 'Center 3'].forEach(n => c.appendRow([n]));
  }
}

const hash_ = p => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, p));
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const sheet_ = n => SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n);

function doGet() { return out_({ ok: true, msg: 'TicketDesk API running' }); }

function doPost(e) {
  try {
    const r = JSON.parse(e.postData.contents);
    if (r.action === 'login') return out_(login_(r));
    if (r.action === 'register') return out_(register_(r));
    const user = JSON.parse(CacheService.getScriptCache().get(r.token) || 'null');
    if (!user) return out_({ ok: false, error: 'Session expired. Please sign in again.', auth: false });
    switch (r.action) {
      case 'list':   return out_({ ok: true, tickets: list_(user), centers: centers_() });
      case 'create': return out_(create_(user, r));
      case 'update': return out_(update_(user, r));
      case 'report': return out_(report_(user, r.month));
    }
    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}

function session_(u) {
  const token = Utilities.getUuid();
  const user = { name: u.Name, email: u.Email, role: u.Role };
  CacheService.getScriptCache().put(token, JSON.stringify(user), 21600);
  return { ok: true, token, user };
}
function users_() { return rows_(sheet_('Users')); }
function rows_(sh) {
  const v = sh.getDataRange().getValues(), h = v.shift();
  return v.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] instanceof Date ? r[i].toISOString() : r[i]])));
}
function login_(r) {
  const u = users_().find(x => String(x.Email).toLowerCase() === String(r.email).toLowerCase().trim());
  if (!u || u.PasswordHash !== hash_(r.password)) return { ok: false, error: 'Wrong email or password.' };
  return session_(u);
}
function register_(r) {
  if (!r.name || !r.email || !r.password || r.password.length < 6) return { ok: false, error: 'Fill all fields (password 6+ characters).' };
  if (users_().some(x => String(x.Email).toLowerCase() === r.email.toLowerCase().trim())) return { ok: false, error: 'This email is already registered.' };
  const u = { Name: r.name.trim(), Email: r.email.trim(), Role: 'user' };
  sheet_('Users').appendRow([u.Name, u.Email, hash_(r.password), 'user']);
  return session_(u);
}
function centers_() {
  const sh = sheet_('Centers');
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).map(r => String(r[0]).trim()).filter(Boolean);
}
function list_(user) {
  const all = rows_(sheet_('Tickets'));
  const mine = user.role === 'admin' ? all : all.filter(t => String(t.Email).toLowerCase() === user.email.toLowerCase());
  return mine.reverse();
}
function create_(user, r) {
  if (!r.title) return { ok: false, error: 'Title is required.' };
  if (!r.center) return { ok: false, error: 'Please select a center.' };
  const sh = sheet_('Tickets'), now = new Date().toISOString();
  const id = 'TK-' + String(sh.getLastRow()).padStart(4, '0');
  sh.appendRow([id, r.title, r.description || '', r.priority || 'Medium', r.category || 'General', 'Open', user.name, user.email, now, now, '', '', r.center, '']);
  return { ok: true, id };
}
function update_(user, r) {
  const sh = sheet_('Tickets'), v = sh.getDataRange().getValues();
  const i = v.findIndex(x => x[0] === r.id);
  if (i < 1) return { ok: false, error: 'Ticket not found.' };
  const row = v[i]; while (row.length < HEAD.length) row.push('');
  const isAdmin = user.role === 'admin';
  if (!isAdmin && String(row[7]).toLowerCase() !== user.email.toLowerCase()) return { ok: false, error: 'Not allowed.' };
  if (!isAdmin && row[5] === 'Closed') return { ok: false, error: 'Closed tickets cannot be edited.' };
  const wasClosed = row[5] === 'Closed', now = new Date().toISOString();
  row[1] = r.title ?? row[1]; row[2] = r.description ?? row[2];
  row[3] = r.priority ?? row[3]; row[4] = r.category ?? row[4];
  if (r.center) row[12] = r.center;
  if (isAdmin) { row[5] = r.status ?? row[5]; row[11] = r.resolution ?? row[11]; }
  row[9] = now;
  if (row[5] === 'Closed' && !wasClosed) { row[10] = now; row[13] = user.name; } // who closed it
  if (row[5] !== 'Closed') { row[10] = ''; row[13] = ''; }
  sh.getRange(i + 1, 1, 1, HEAD.length).setValues([row]);
  if (row[5] === 'Closed' && !wasClosed) sendClosedMail_(row);
  return { ok: true };
}
function sendClosedMail_(row) {
  MailApp.sendEmail({
    to: row[7],
    subject: `[${row[0]}] Your ticket has been closed`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#0e1b2c">Hi ${row[6]}, your ticket is closed ✅</h2>
      <p><b>${row[0]}</b> – ${row[1]}<br><b>Center:</b> ${row[12] || '—'}</p>
      <p><b>Resolution:</b><br>${row[11] || 'Resolved by our support team.'}</p>
      <p><b>Resolved by:</b> ${row[13] || 'Support team'}</p>
      <p>If the problem continues, reply to this email or create a new ticket.</p></div>`
  });
}
function report_(user, month) {
  const t = list_(user), m = month || new Date().toISOString().slice(0, 7);
  const created = t.filter(x => String(x.CreatedAt).startsWith(m));
  const closed = t.filter(x => String(x.ClosedAt).startsWith(m));
  const count = (arr, k) => arr.reduce((a, x) => (a[x[k] || 'Not set'] = (a[x[k] || 'Not set'] || 0) + 1, a), {});
  const hrs = closed.map(x => (new Date(x.ClosedAt) - new Date(x.CreatedAt)) / 36e5);
  return { ok: true, month: m, created: created.length, closed: closed.length,
    pending: created.filter(x => x.Status !== 'Closed').length,
    avgHours: hrs.length ? +(hrs.reduce((a, b) => a + b, 0) / hrs.length).toFixed(1) : 0,
    byPriority: count(created, 'Priority'), byCategory: count(created, 'Category'),
    byCenter: count(created, 'Center'), byAgent: count(closed, 'ClosedBy') };
}
