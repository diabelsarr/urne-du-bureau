(function () {
'use strict';
const $app = document.getElementById('app');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n, t) => (t ? Math.round(n * 1000 / t) / 10 : 0).toLocaleString('fr-FR') + ' %';
const when = iso => { try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }); } catch (e) { return iso || ''; } };
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
const CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l12 12M16 4L4 16"/></svg>';

const S = { pub: null, adm: null, authed: false, admin: location.hash === '#admin', loadErr: false,
  step: 'code', code: '', sel: null, msg: null, busy: false, loginPw: '', loginMsg: null,
  cands: null, org: null, title: null, names: '', count: '', newCodes: null, confirm: null, copied: false, showPv: false };

async function call(path, body) {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error(j.error || 'Erreur ' + r.status); e.status = r.status; throw e; }
  return j;
}

/* ---------- résultats ---------- */
function outcome(c, r) {
  const rows = c.candidates.map(x => ({ ...x, n: r.counts[x.id] || 0 })).sort((a, b) => b.n - a.n);
  const e = rows.reduce((s, x) => s + x.n, 0);
  let text, kind;
  if (!rows.length || e === 0) { text = 'Aucun suffrage exprimé.'; kind = 'warn'; }
  else if (rows[1] && rows[1].n === rows[0].n) { text = 'Égalité entre ' + rows.filter(x => x.n === rows[0].n).map(x => x.name).join(', ') + '. Un nouveau tour est nécessaire.'; kind = 'warn'; }
  else if (rows[0].n * 2 > e) { text = rows[0].name + ' est élu(e) président(e) à la majorité absolue.'; kind = 'ok'; }
  else { text = rows[0].name + ' arrive en tête avec ' + pct(rows[0].n, e) + ' des suffrages exprimés, sans majorité absolue. Vos statuts peuvent exiger un nouveau tour.'; kind = 'warn'; }
  return { rows, e, text, kind };
}
function resultsHtml(c) {
  const r = c.results, o = outcome(c, r);
  const rows = o.rows.map((x, i) => '<li class="' + (i === 0 && o.kind === 'ok' ? 'win' : '') + '"><div class="bar-top"><span class="nm">' + esc(x.name) + '</span><span class="val">' + x.n + ' voix · ' + pct(x.n, o.e) + '</span></div><div class="track"><div class="fill" style="width:' + (o.e ? x.n / o.e * 100 : 0) + '%"></div></div></li>').join('');
  return '<div class="notice ' + (o.kind === 'ok' ? 'ok' : '') + '"><strong>' + esc(o.text) + '</strong></div><ul class="bars">' + rows + '</ul>'
    + '<dl class="stats"><div><dt>Votants</dt><dd>' + r.total + '</dd></div><div><dt>Blancs</dt><dd>' + r.blank + '</dd></div><div><dt>Exprimés</dt><dd>' + o.e + '</dd></div></dl>'
    + '<p class="fine">Clôturé le ' + esc(when(r.closedAt)) + '. Pourcentages calculés sur les suffrages exprimés (hors blancs).</p>';
}
function pvText(c) {
  const r = c.results, o = outcome(c, r);
  const L = ['PROCÈS-VERBAL DU SCRUTIN', c.org, c.title + (c.round > 1 ? ' (tour ' + c.round + ')' : ''), 'Clôturé le ' + when(r.closedAt), '',
    'Votants : ' + r.total, 'Bulletins blancs : ' + r.blank, 'Suffrages exprimés : ' + o.e, '', 'Résultats :'];
  o.rows.forEach(x => L.push('- ' + x.name + ' : ' + x.n + ' voix (' + pct(x.n, o.e) + ')'));
  L.push('', 'Conclusion : ' + o.text);
  return L.join('\n');
}

/* ---------- vue électeur ---------- */
function pill(c) {
  const m = { setup: ['warn', 'En préparation'], open: ['ok', 'Scrutin ouvert'], closed: ['', 'Scrutin clos'] }[c.status] || ['', ''];
  return '<span class="pill ' + m[0] + '">' + (c.status === 'open' ? '<span class="dot"></span>' : '') + m[1] + '</span>';
}
function voterView(c) {
  if (c.status === 'setup') return '<section class="card"><h2>Le scrutin n’est pas encore ouvert</h2><p class="fine">L’organisateur ouvrira le vote prochainement. Cette page se met à jour toute seule.</p></section>';
  if (c.status === 'closed') return '<section class="card"><h2>Résultats</h2>' + (c.results ? resultsHtml(c) : '<p class="fine">Dépouillement en cours.</p>') + '</section>';
  const err = S.msg ? '<div class="notice err" role="alert">' + esc(S.msg) + '</div>' : '';
  if (S.step === 'done') return '<section class="card"><div class="done"><div class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><div><h2>Votre bulletin est dans l’urne</h2><p class="fine" style="margin-top:6px">Merci d’avoir voté. Les résultats s’afficheront sur cette page à la clôture du scrutin. Votre code est maintenant inutilisable.</p></div></div></section>';
  if (S.step === 'code') {
    return '<section class="card"><h2>Entrez votre code de vote</h2><p class="fine">Vous l’avez reçu de l’organisateur. Il est personnel et ne fonctionne qu’une seule fois.</p>'
      + '<div class="field"><label for="code">Code de vote</label><input class="code" id="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="XXXX-XXXX" value="' + esc(S.code) + '"></div>' + err
      + '<div class="actions"><button class="btn primary" data-act="check"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Vérification…' : 'Continuer') + '</button></div></section>';
  }
  const head = '<div class="ballot-head"><span>Bulletin de vote</span><span>' + esc(c.org) + '</span></div>';
  if (S.step === 'confirm') {
    const ch = S.sel === 'blank' ? 'Vote blanc' : (c.candidates.find(x => x.id === S.sel) || {}).name || '';
    return '<section class="ballot">' + head + '<div class="ballot-body"><p class="fine" style="padding-top:14px">Vous êtes sur le point de voter pour</p><p class="confirm-choice">' + esc(ch) + '</p>' + err
      + '<div class="actions" style="margin-top:10px"><button class="btn ghost" data-act="back"' + (S.busy ? ' disabled' : '') + '>Modifier mon choix</button><button class="btn primary" data-act="cast"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Dépôt en cours…' : 'Déposer dans l’urne') + '</button></div>'
      + '<p class="fine">Le dépôt est définitif et anonyme : votre choix ne sera pas relié à votre nom.</p></div></section>';
  }
  const opt = (id, name, note, cls) => '<label class="opt ' + cls + (S.sel === id ? ' sel' : '') + '"><input type="radio" name="choice" id="opt-' + esc(id) + '" value="' + esc(id) + '"' + (S.sel === id ? ' checked' : '') + '><span class="box" aria-hidden="true">' + CHECK + '</span><span class="opt-txt"><strong>' + esc(name) + '</strong>' + (note ? '<small>' + esc(note) + '</small>' : '') + '</span></label>';
  return '<section class="ballot">' + head + '<div class="ballot-body"><fieldset><legend>' + esc(c.title) + ' : cochez une seule case.</legend>'
    + c.candidates.map(x => opt(x.id, x.name, x.note, '')).join('') + opt('blank', 'Vote blanc', '', 'blank') + '</fieldset>' + err
    + '<div class="actions" style="margin-top:12px"><button class="btn primary" data-act="review"' + (S.sel ? '' : ' disabled') + '>Vérifier mon choix</button></div></div></section>';
}

/* ---------- vue organisateur ---------- */
function csv(codes) { return 'Nom;Code\n' + codes.map(c => '"' + c.label.replace(/"/g, '""') + '";' + c.code).join('\n'); }
function adminView() {
  if (!S.authed) {
    return '<header class="top"><p class="eyebrow">Espace organisateur</p><h1>Connexion</h1></header><section class="card"><div class="field"><label for="pw">Mot de passe organisateur</label><input type="password" id="pw" autocomplete="current-password" value="' + esc(S.loginPw) + '"></div>'
      + (S.loginMsg ? '<div class="notice err" role="alert">' + esc(S.loginMsg) + '</div>' : '') + '<div class="actions"><button class="btn primary" data-act="login">Se connecter</button><a class="btn ghost" href="#" data-act="tovote" style="text-decoration:none;display:inline-flex;align-items:center">Retour au vote</a></div></section>';
  }
  const a = S.adm; if (!a) return '<p class="fine">Chargement…</p>';
  const setup = a.status === 'setup';
  if (S.cands === null) S.cands = a.candidates.map(x => ({ ...x }));
  const err = S.msg ? '<div class="notice err" role="alert">' + esc(S.msg) + '</div>' : '';
  let h = '<header class="top"><p class="eyebrow">Espace organisateur</p><h1>' + esc(a.title) + '</h1>' + pill(a) + '</header>'
    + '<div class="actions noprint"><a class="btn small ghost" href="#" data-act="tovote" style="text-decoration:none">Voir la page des électeurs</a><button class="btn small ghost" data-act="logout">Se déconnecter</button></div>' + err;
  h += '<section class="card"><h2>Le scrutin</h2><div class="grid2"><div class="field"><label for="f-org">Organisation</label><input type="text" id="f-org" maxlength="80" value="' + esc(S.org != null ? S.org : a.org) + '"' + (setup ? '' : ' disabled') + '></div>'
    + '<div class="field"><label for="f-title">Intitulé</label><input type="text" id="f-title" maxlength="100" value="' + esc(S.title != null ? S.title : a.title) + '"' + (setup ? '' : ' disabled') + '></div></div>'
    + (setup ? '<div class="actions"><button class="btn" data-act="saveinfo">Enregistrer</button></div>' : '') + '</section>';
  h += '<section class="card"><h2>Candidats</h2>' + (S.cands.map((x, i) => '<div class="cand"><span class="mono">' + esc(initials(x.name)) + '</span><span class="grow"><strong>' + esc(x.name) + '</strong>' + (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span>' + (setup ? '<button class="btn small ghost" data-act="rm" data-i="' + i + '">Retirer</button>' : '') + '</div>').join('') || '<p class="fine">Aucun candidat. Ajoutez-en au moins deux.</p>')
    + (setup ? '<div class="grid2"><div class="field"><label for="f-cname">Nom du candidat</label><input type="text" id="f-cname" maxlength="60" autocomplete="off"></div><div class="field"><label for="f-cnote">Précision (facultatif)</label><input type="text" id="f-cnote" maxlength="90" autocomplete="off"></div></div><div class="actions"><button class="btn" data-act="addcand">Ajouter le candidat</button></div>' : '') + '</section>';
  if (S.newCodes) {
    h += '<section class="card"><h2>Codes générés</h2><div class="notice"><strong>Notez-les maintenant.</strong> Pour des raisons de sécurité, les codes ne sont affichés qu’une seule fois et ne peuvent pas être retrouvés. Transmettez chaque code à son électeur par un canal privé.</div>'
      + '<div class="tablewrap"><table><thead><tr><th>Nom</th><th>Code</th></tr></thead><tbody>' + S.newCodes.map(c => '<tr><td>' + esc(c.label) + '</td><td class="code">' + esc(c.code) + '</td></tr>').join('') + '</tbody></table></div>'
      + '<div class="actions noprint"><button class="btn" data-act="dlcsv">Télécharger (CSV)</button><button class="btn" data-act="print">Imprimer</button><button class="btn ghost" data-act="hidecodes">J’ai tout noté, masquer</button></div></section>';
  }
  if (a.status !== 'closed') {
    h += '<section class="card"><h2>Électeurs et codes</h2><p class="fine">Collez la liste des électeurs (un nom par ligne) : un code unique est généré pour chacun. Ou indiquez simplement un nombre de codes anonymes.</p>'
      + '<div class="field"><label for="f-names">Noms (un par ligne)</label><textarea id="f-names">' + esc(S.names) + '</textarea></div><div class="field"><label for="f-count">ou nombre de codes anonymes</label><input type="number" id="f-count" min="0" max="500" value="' + esc(S.count) + '" style="max-width:160px"></div>'
      + '<div class="actions"><button class="btn" data-act="gen">Générer les codes</button></div>'
      + '<p class="fine">' + a.voters.length + ' code(s) existant(s).</p></section>';
  }
  if (setup) {
    h += '<section class="card"><h2>Ouverture du vote</h2><p class="fine">Partagez ensuite l’adresse de ce site (sans <code>#admin</code>) avec les électeurs, en plus de leur code personnel.</p><div class="actions"><button class="btn primary" data-act="open"' + (a.candidates.length < 2 || !a.voters.length ? ' disabled' : '') + '>Ouvrir le scrutin</button></div>'
      + (a.candidates.length < 2 ? '<p class="fine">Enregistrez au moins deux candidats (ils sont enregistrés à chaque ajout).</p>' : '') + (!a.voters.length ? '<p class="fine">Générez les codes de vote avant d’ouvrir.</p>' : '') + '</section>';
  } else if (a.status === 'open') {
    h += '<section class="card"><h2>Scrutin en cours</h2><dl class="stats"><div><dt>Ont voté</dt><dd>' + a.turnout + ' / ' + a.voters.length + '</dd></div></dl>'
      + '<div><h3>Liste d’émargement</h3><p class="fine" style="margin:4px 0 10px">Qui a voté ou non. Les choix ne sont enregistrés nulle part avec les noms.</p><div class="tablewrap"><table><tbody>' + a.voters.map(v => '<tr><td>' + esc(v.label) + '</td><td><span class="tag ' + (v.used ? 'ok' : '') + '">' + (v.used ? 'A voté' : 'N’a pas voté') + '</span></td></tr>').join('') + '</tbody></table></div></div>'
      + (S.confirm === 'close' ? '<div class="notice"><strong>Clôturer maintenant ?</strong> Plus aucun bulletin ne sera accepté et les résultats seront publiés pour tous.</div><div class="actions"><button class="btn ghost" data-act="cancel">Annuler</button><button class="btn danger" data-act="close">Clôturer et dépouiller</button></div>' : '<div class="actions"><button class="btn primary" data-act="askclose">Clôturer et dépouiller</button></div>') + '</section>';
  } else {
    h += '<section class="card"><h2>Résultats</h2>' + resultsHtml(a) + '<div class="actions noprint"><button class="btn" data-act="copypv">' + (S.copied ? 'Procès-verbal copié ✓' : 'Copier le procès-verbal') + '</button></div>' + (S.showPv ? '<textarea id="pv" readonly style="min-height:200px">' + esc(pvText(a)) + '</textarea>' : '')
      + '<hr style="border:0;border-top:1px solid var(--line);width:100%">'
      + (S.confirm === 'new' ? '<div class="notice"><strong>Préparer un nouveau tour ?</strong> Les candidats et les codes sont conservés ; les bulletins et résultats sont effacés et chaque code redevient utilisable.</div><div class="actions"><button class="btn ghost" data-act="cancel">Annuler</button><button class="btn primary" data-act="newround">Préparer le tour ' + (a.round + 1) + '</button></div>' : '<div class="actions noprint"><button class="btn" data-act="asknew">Préparer un nouveau tour (égalité, second tour)</button></div>') + '</section>';
  }
  return h;
}

function render() {
  const el = document.activeElement, f = el && el.id ? { id: el.id, s: el.selectionStart, e: el.selectionEnd } : null;
  let html;
  if (S.admin) html = adminView();
  else if (!S.pub) html = '<header class="top"><p class="eyebrow">Élection</p><h1>' + (S.loadErr ? 'Connexion impossible' : 'Chargement…') + '</h1></header>' + (S.loadErr ? '<section class="card"><p>Le serveur ne répond pas. Vérifiez votre connexion puis rechargez la page.</p></section>' : '');
  else html = '<header class="top"><p class="eyebrow">' + esc(S.pub.org) + ' · Élection' + (S.pub.round > 1 ? ' · Tour ' + S.pub.round : '') + '</p><h1>' + esc(S.pub.title) + '</h1>' + pill(S.pub) + '</header>' + voterView(S.pub) + '<p class="fine noprint"><a href="#admin" style="color:var(--muted)">Espace organisateur</a></p>';
  $app.innerHTML = html;
  if (f) { const n = document.getElementById(f.id); if (n) { n.focus(); try { if (f.s != null) n.setSelectionRange(f.s, f.e); } catch (e) {} } }
}

/* ---------- données ---------- */
async function loadPub() {
  try {
    const p = await call('/api/state');
    const changed = JSON.stringify(p) !== JSON.stringify(S.pub);
    S.pub = p; S.loadErr = false;
    if (S.step !== 'code' && p.status !== 'open') { S.step = p.status === 'open' ? S.step : 'code'; }
    if (changed && !S.admin) render();
  } catch (e) { S.loadErr = true; if (!S.pub) render(); }
}
async function loadAdm() {
  try {
    const a = await call('/api/admin/state');
    const changed = JSON.stringify(a) !== JSON.stringify(S.adm);
    S.adm = a; S.authed = true;
    if (changed || !$app.innerHTML) render();
  } catch (e) { if (e.status === 401) { S.authed = false; S.adm = null; render(); } }
}
async function admPost(path, body, after) {
  S.msg = null;
  try { const r = await call(path, body || {}); if (after) after(r); S.confirm = null; await loadAdm(); render(); return true; }
  catch (e) { S.msg = e.message; render(); return false; }
}
function readDrafts() {
  const g = id => document.getElementById(id);
  if (g('f-org')) S.org = g('f-org').value;
  if (g('f-title')) S.title = g('f-title').value;
  if (g('f-names')) S.names = g('f-names').value;
  if (g('f-count')) S.count = g('f-count').value;
}

async function onAct(act, el, ev) {
  if (ev) ev.preventDefault();
  readDrafts();
  const a = S.adm;
  switch (act) {
    case 'tovote': S.admin = false; location.hash = ''; render(); break;
    case 'check':
      S.busy = true; S.msg = null; render();
      try { await call('/api/check', { code: S.code }); S.step = 'choose'; }
      catch (e) { S.msg = e.message; }
      S.busy = false; render(); break;
    case 'review': if (S.sel) { S.step = 'confirm'; S.msg = null; render(); } break;
    case 'back': S.step = 'choose'; S.msg = null; render(); break;
    case 'cast':
      S.busy = true; S.msg = null; render();
      try { await call('/api/vote', { code: S.code, choice: S.sel }); S.step = 'done'; S.code = ''; S.sel = null; }
      catch (e) { S.msg = e.message; S.step = 'choose'; }
      S.busy = false; render(); break;
    case 'login':
      S.loginPw = document.getElementById('pw').value; S.loginMsg = null;
      try { await call('/api/admin/login', { password: S.loginPw }); S.loginPw = ''; S.cands = null; await loadAdm(); render(); }
      catch (e) { S.loginMsg = e.message; render(); } break;
    case 'logout': try { await call('/api/admin/logout', {}); } catch (e) {} S.authed = false; S.adm = null; render(); break;
    case 'saveinfo': admPost('/api/admin/info', { org: S.org != null ? S.org : a.org, title: S.title != null ? S.title : a.title }, () => { S.org = null; S.title = null; }); break;
    case 'addcand': {
      const name = document.getElementById('f-cname').value.trim(), note = document.getElementById('f-cnote').value.trim();
      if (!name) { S.msg = 'Saisissez le nom du candidat.'; render(); break; }
      if (S.cands.some(x => x.name.toLowerCase() === name.toLowerCase())) { S.msg = 'Ce candidat figure déjà dans la liste.'; render(); break; }
      const next = [...S.cands, { id: 'c' + Math.random().toString(36).slice(2, 8), name, note }];
      if (await admPost('/api/admin/candidates', { candidates: next }, () => { S.cands = next; })) { const i = document.getElementById('f-cname'); if (i) i.focus(); }
      break; }
    case 'rm': { const next = S.cands.filter((_, i) => i !== +el.dataset.i); admPost('/api/admin/candidates', { candidates: next }, () => { S.cands = next; }); break; }
    case 'gen': {
      const labels = S.names.split('\n').map(x => x.trim()).filter(Boolean);
      if (!labels.length && !(parseInt(S.count, 10) > 0)) { S.msg = 'Indiquez des noms ou un nombre de codes.'; render(); break; }
      admPost('/api/admin/codes', labels.length ? { labels } : { count: parseInt(S.count, 10) }, r => { S.newCodes = [...(S.newCodes || []), ...r.codes]; S.names = ''; S.count = ''; }); break; }
    case 'dlcsv': {
      const blob = new Blob(['﻿' + csv(S.newCodes)], { type: 'text/csv;charset=utf-8' });
      const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = 'codes-de-vote.csv'; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); break; }
    case 'print': window.print(); break;
    case 'hidecodes': S.newCodes = null; render(); break;
    case 'open': admPost('/api/admin/open'); break;
    case 'askclose': S.confirm = 'close'; render(); break;
    case 'cancel': S.confirm = null; render(); break;
    case 'close': admPost('/api/admin/close'); break;
    case 'asknew': S.confirm = 'new'; render(); break;
    case 'newround': admPost('/api/admin/newround', {}, () => { S.copied = false; S.showPv = false; }); break;
    case 'copypv': {
      try { await navigator.clipboard.writeText(pvText(a)); S.copied = true; S.showPv = false; } catch (e) { S.showPv = true; S.copied = false; }
      render(); if (S.showPv) { const p = document.getElementById('pv'); if (p) { p.focus(); p.select(); } } break; }
  }
}
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && !el.disabled) onAct(el.dataset.act, el, e); });
document.addEventListener('input', e => { if (e.target.id === 'code') { S.code = e.target.value.toUpperCase(); } });
document.addEventListener('change', e => { if (e.target.name === 'choice') { S.sel = e.target.value; render(); } });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const id = e.target.id;
  if (id === 'code') { e.preventDefault(); onAct('check', e.target); }
  else if (id === 'pw') { e.preventDefault(); onAct('login', e.target); }
  else if (id === 'f-cname' || id === 'f-cnote') { e.preventDefault(); onAct('addcand', e.target); }
});
window.addEventListener('hashchange', () => { S.admin = location.hash === '#admin'; S.msg = null; if (S.admin) { loadAdm(); } render(); });

if (S.admin) loadAdm().then(() => render());
loadPub().then(() => { if (!S.admin) render(); });
setInterval(() => { if (S.admin) { if (S.authed) loadAdm(); } else loadPub(); }, 8000);
})();
