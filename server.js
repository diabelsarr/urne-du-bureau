'use strict';
// Plateforme de vote : serveur sans dépendance (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD.length < 8) {
  console.error('ERREUR : définissez la variable ADMIN_PASSWORD (8 caractères minimum).');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'scrutin.json');

/* ---------- stockage ---------- */
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
catch (e) {
  db = { salt: crypto.randomBytes(16).toString('hex'), org: 'Bureau', title: 'Élection du président',
         round: 1, status: 'setup', candidates: [], voters: [], ballots: [], results: null };
  save();
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- outils ---------- */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const codeHash = c => sha(db.salt + norm(c));
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
function newCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const sessions = new Map(); // token -> expiration
const fails = new Map();    // ip -> [timestamps]
function ip(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function tooMany(req) {
  const now = Date.now(), a = (fails.get(ip(req)) || []).filter(t => now - t < 10 * 60 * 1000);
  fails.set(ip(req), a);
  return a.length >= 15;
}
function fail(req) { const a = fails.get(ip(req)) || []; a.push(Date.now()); fails.set(ip(req), a); }

function tally() {
  const counts = {}; db.candidates.forEach(c => { counts[c.id] = 0; });
  let blank = 0;
  for (const b of db.ballots) { if (Object.prototype.hasOwnProperty.call(counts, b.c)) counts[b.c]++; else blank++; }
  return { counts, blank, total: db.ballots.length };
}
function publicState() {
  return { org: db.org, title: db.title, round: db.round, status: db.status,
           candidates: db.candidates, results: db.status === 'closed' ? db.results : null };
}

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 200000) { reject(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
function cookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function isAdmin(req) {
  const t = cookie(req, 'adm'), exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/state') return send(res, 200, publicState());

  let b = {};
  if (req.method === 'POST') {
    if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON requis' });
    try { b = await readBody(req); } catch (e) { return send(res, 400, { error: 'Requête invalide' }); }

    if (p === '/api/check' || p === '/api/vote') {
      if (tooMany(req)) return send(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      if (db.status !== 'open') return send(res, 409, { error: 'Le scrutin n’est pas ouvert.' });
      const h = codeHash(b.code), v = db.voters.find(x => x.h === h);
      if (!v) { fail(req); return send(res, 403, { error: 'Code inconnu. Vérifiez votre saisie.' }); }
      if (v.used) return send(res, 403, { error: 'Ce code a déjà été utilisé pour voter.' });
      if (p === '/api/check') return send(res, 200, { ok: true });
      const choice = String(b.choice || '');
      if (choice !== 'blank' && !db.candidates.some(c => c.id === choice)) return send(res, 400, { error: 'Choix invalide.' });
      v.used = true;
      // le bulletin est inséré à une position aléatoire, sans date ni code : impossible de relier vote et votant
      db.ballots.splice(crypto.randomInt(db.ballots.length + 1), 0, { c: choice });
      save();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/login') {
      if (tooMany(req)) return send(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' });
      const a = Buffer.from(sha(String(b.password || ''))), c = Buffer.from(sha(ADMIN_PASSWORD));
      if (!crypto.timingSafeEqual(a, c)) { fail(req); return send(res, 403, { error: 'Mot de passe incorrect.' }); }
      const t = crypto.randomBytes(32).toString('hex');
      sessions.set(t, Date.now() + 8 * 3600 * 1000);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, { 'Set-Cookie': `adm=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
    }
  }

  if (!p.startsWith('/api/admin/')) return send(res, 404, { error: 'Introuvable' });
  if (!isAdmin(req)) return send(res, 401, { error: 'Connexion requise' });

  if (req.method === 'GET' && p === '/api/admin/state') {
    return send(res, 200, { ...publicState(), voters: db.voters.map(v => ({ label: v.label, used: v.used })),
      turnout: db.voters.filter(v => v.used).length, ballots: db.ballots.length });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non permise' });

  switch (p) {
    case '/api/admin/logout':
      sessions.delete(cookie(req, 'adm'));
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    case '/api/admin/info':
      if (db.status !== 'setup') return send(res, 409, { error: 'Modification impossible après l’ouverture.' });
      db.org = clean(b.org, 80) || 'Bureau'; db.title = clean(b.title, 100) || 'Élection du président';
      save(); return send(res, 200, { ok: true });
    case '/api/admin/candidates': {
      if (db.status !== 'setup') return send(res, 409, { error: 'Modification impossible après l’ouverture.' });
      const list = Array.isArray(b.candidates) ? b.candidates.slice(0, 12) : [];
      db.candidates = list.map(c => ({ id: clean(c.id, 12) || 'c' + crypto.randomBytes(3).toString('hex'),
        name: clean(c.name, 60), note: clean(c.note, 90) })).filter(c => c.name);
      save(); return send(res, 200, { ok: true });
    }
    case '/api/admin/codes': {
      if (db.status === 'closed') return send(res, 409, { error: 'Le scrutin est clos.' });
      let labels = Array.isArray(b.labels) ? b.labels.map(l => clean(l, 80)).filter(Boolean) : [];
      if (!labels.length) { const n = Math.min(Math.max(parseInt(b.count, 10) || 0, 0), 500); labels = Array.from({ length: n }, (_, i) => 'Électeur ' + (db.voters.length + i + 1)); }
      labels = labels.slice(0, 500);
      const out = [];
      for (const label of labels) {
        let code, h; do { code = newCode(); h = codeHash(code); } while (db.voters.some(v => v.h === h));
        db.voters.push({ h, label, used: false }); out.push({ label, code });
      }
      save(); return send(res, 200, { codes: out });
    }
    case '/api/admin/open':
      if (db.status !== 'setup') return send(res, 409, { error: 'Déjà ouvert.' });
      if (db.candidates.length < 2) return send(res, 409, { error: 'Il faut au moins deux candidats.' });
      if (!db.voters.length) return send(res, 409, { error: 'Générez d’abord les codes de vote.' });
      db.status = 'open'; save(); return send(res, 200, { ok: true });
    case '/api/admin/close':
      if (db.status !== 'open') return send(res, 409, { error: 'Le scrutin n’est pas ouvert.' });
      db.results = { ...tally(), closedAt: new Date().toISOString() }; db.status = 'closed';
      save(); return send(res, 200, { ok: true });
    case '/api/admin/newround':
      if (db.status !== 'closed') return send(res, 409, { error: 'Clôturez d’abord le scrutin.' });
      db.round++; db.status = 'setup'; db.results = null; db.ballots = []; db.voters.forEach(v => { v.used = false; });
      save(); return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Introuvable' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => { console.error(e); send(res, 500, { error: 'Erreur serveur' }); });
  let f = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(__dirname, 'public', path.normalize(f).replace(/^(\.\.[\/\\])+/, ''));
  if (!full.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Interdit');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Introuvable');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'" });
  });
}).listen(PORT, () => console.log('Plateforme de vote prête : http://localhost:' + PORT));
