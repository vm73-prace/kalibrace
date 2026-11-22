/* Evidence kalibrací – appka (vanilla JS). Výpočty jsou v calc.js, ukázková data v demo.js. */
var VERZE = 10;
var Q = new URLSearchParams(location.search);
var DEBUG = Q.get('debug') === '1';
var DEMO = Q.get('demo') === '1'; // ?demo=1 = ukázková data v paměti, bez Supabase
// Sdílený projekt „servisní záznamy“, schéma kalibrace. Publishable klíč je veřejný, data chrání RLS.
var SUPABASE_URL = 'https://pqehuuamgecmdmrdhmza.supabase.co';
var SUPABASE_KEY = 'sb_publishable_6SgwttYu1LHUrAeInwv1Qw_chrfScN7';
var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
var SCHEMA = 'kalibrace';

/* ---------- Diagnostika ---------- */
var dbgEl = document.getElementById('debug');
function log() {
  var msg = Array.prototype.map.call(arguments, function (a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ');
  if (DEBUG) { var d = document.createElement('div'); d.textContent = new Date().toLocaleTimeString('cs-CZ') + ' ' + msg; dbgEl.appendChild(d); dbgEl.scrollTop = 1e9; }
  console.log('[kal]', msg);
}
function logChyba(msg) {
  if (DEBUG) { var d = document.createElement('div'); d.className = 'e'; d.textContent = new Date().toLocaleTimeString('cs-CZ') + ' CHYBA ' + msg; dbgEl.appendChild(d); dbgEl.classList.add('chyba'); }
  console.error('[kal]', msg);
}
if (DEBUG) dbgEl.classList.add('on');
window.addEventListener('error', function (e) { logChyba(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', function (e) { logChyba(String(e.reason && e.reason.message || e.reason)); });

/* ---------- Data ---------- */
var dnes = Calc.dnesPraha();
function prazdnaData() { return { skupiny: [], pristroje: [], kalibrace: [], nastaveni: {} }; }
var S = DEMO ? demoData(dnes) : prazdnaData();
var soubory = {}; // path -> Blob (demo úložiště souborů)
var noveId = 0;
function id() { return 'n' + Date.now().toString(36) + (++noveId); }

// Rozhraní k datům: apiDemo (paměť) a apiSupabase mají stejné metody
var apiDemo = {
  ulozSkupinu: function (g) { return ulozDo(S.skupiny, g); },
  smazSkupinu: function (gid) { S.skupiny = S.skupiny.filter(function (x) { return x.id !== gid; }); return Promise.resolve(); },
  ulozPristroj: function (p) { return ulozDo(S.pristroje, p); },
  smazPristroj: function (pid) {
    S.pristroje = S.pristroje.filter(function (x) { return x.id !== pid; });
    S.kalibrace = S.kalibrace.filter(function (k) { return k.pristroj_id !== pid; });
    return Promise.resolve();
  },
  ulozKalibraci: function (k) { return ulozDo(S.kalibrace, k); },
  smazKalibraci: function (kid) { S.kalibrace = S.kalibrace.filter(function (x) { return x.id !== kid; }); return Promise.resolve(); },
  ulozNastaveni: function (n) { Object.assign(S.nastaveni, n); return Promise.resolve(S.nastaveni); },
  nahrajSoubor: function (bucket, blob) { var path = bucket + '/' + id(); soubory[path] = blob; log('nahráno', path, blob.size + ' B'); return Promise.resolve(path); },
  souborUrl: function (bucket, path) { return apiDemo.souborBlob(bucket, path).then(function (b) { return URL.createObjectURL(b); }); },
  smazSoubory: function (bucket, paths) { paths.forEach(function (x) { delete soubory[x]; }); log('smazáno', bucket, paths.join(', ')); return Promise.resolve(); },
  souborBlob: function (bucket, path) {
    if (soubory[path]) return Promise.resolve(soubory[path]);
    if (path.indexOf('demo:') === 0) return Promise.resolve(soubory[path] = demoPdf('Kalibracni protokol ' + path.slice(5)));
    return Promise.reject(new Error('Soubor nenalezen: ' + path));
  }
};
/* ---------- Supabase ---------- */
var sb = null, db = null, uzivatel = null, pristup = null;
// Výsledek dotazu Supabase: do logu status a chyba (bez tokenů), při chybě výjimka
function q(popis, dotaz) {
  return Promise.resolve(dotaz).then(function (r) {
    log('supabase', popis, (r.status != null ? String(r.status) : (r.error ? 'chyba' : 'ok')) + (r.error ? ' ' + (r.error.code || r.error.statusCode || '') + ' ' + r.error.message : ''));
    if (r.error) throw new Error(r.error.message);
    return r.data;
  });
}
function ulozSb(tabulka, o) {
  var data = Object.assign({}, o); delete data.id;
  var dotaz = o.id ? db.from(tabulka).update(data).eq('id', o.id) : db.from(tabulka).insert(data);
  return q((o.id ? 'update ' : 'insert ') + tabulka, dotaz.select().single()).then(function (row) {
    var arr = S[tabulka], i = arr.findIndex(function (x) { return x.id === row.id; });
    if (i >= 0) arr[i] = row; else arr.push(row);
    return row;
  });
}
function smazSb(tabulka, id) {
  return q('delete ' + tabulka, db.from(tabulka).delete().eq('id', id)).then(function () {
    S[tabulka] = S[tabulka].filter(function (x) { return x.id !== id; });
  });
}
var apiSupabase = {
  ulozSkupinu: function (g) { return ulozSb('skupiny', g); },
  smazSkupinu: function (gid) { return smazSb('skupiny', gid); },
  ulozPristroj: function (p) { return ulozSb('pristroje', p); },
  smazPristroj: function (pid) { // kalibrace smaže databáze kaskádou
    return smazSb('pristroje', pid).then(function () { S.kalibrace = S.kalibrace.filter(function (k) { return k.pristroj_id !== pid; }); });
  },
  ulozKalibraci: function (k) { return ulozSb('kalibrace', k); },
  smazKalibraci: function (kid) { return smazSb('kalibrace', kid); },
  ulozNastaveni: function (n) {
    return q('upsert nastaveni', db.from('nastaveni').upsert(Object.assign({ owner: uzivatel.id }, n)).select().single())
      .then(function (row) { S.nastaveni = row; return row; });
  },
  // Soubory: buckety kalibrace-fotky / kalibrace-protokoly, cesta '<uid>/<uuid>.<přípona>' (politiky Storage podle složky)
  nahrajSoubor: function (bucket, blob) {
    var path = uzivatel.id + '/' + crypto.randomUUID() + priponu(blob);
    return q('upload ' + bucket + ' ' + Math.round(blob.size / 1024) + ' kB',
      sb.storage.from(SCHEMA + '-' + bucket).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false }))
      .then(function () { return path; });
  },
  souborBlob: function (bucket, path) { return q('download ' + bucket, sb.storage.from(SCHEMA + '-' + bucket).download(path)); },
  souborUrl: function (bucket, path) { // podepsaná URL platí 10 minut
    return q('sign ' + bucket, sb.storage.from(SCHEMA + '-' + bucket).createSignedUrl(path, 600)).then(function (d) { return d.signedUrl; });
  },
  smazSoubory: function (bucket, paths) {
    paths = paths.filter(Boolean);
    return paths.length ? q('remove ' + bucket + ' ' + paths.length, sb.storage.from(SCHEMA + '-' + bucket).remove(paths)) : Promise.resolve();
  }
};
var api = DEMO ? apiDemo : apiSupabase;

// Úložiště přihlášení: kopie v paměti a zápis do localStorage odložený (Avast AntiTrack blokuje synchronní zápis
// ze skriptu z CDN); když localStorage nejde, přihlášení platí do zavření stránky.
// Smazání = null v paměti (ne delete), jinak by čtení vrátilo starou session z localStorage.
// Paměť nepřežije obnovení stránky: co nejde smazat, přepíše se prázdnou hodnotou (= žádná session), a start() ověří sezení na serveru.
var AUTH_KLIC = SCHEMA + '-auth';
var authPamet = {};
var AUTH_NEPLATNE = ['bad_jwt', 'user_not_found', 'user_banned']; // session_not_found zahodí supabase-js sám
var authStorage = {
  getItem: function (k) { if (k in authPamet) return authPamet[k]; try { return localStorage.getItem(k) || null; } catch (e) { return null; } },
  setItem: function (k, v) { authPamet[k] = v; setTimeout(function () { try { localStorage.setItem(k, v); } catch (e) { log('auth: localStorage nejde zapsat'); } }, 0); },
  removeItem: function (k) {
    authPamet[k] = null;
    setTimeout(function () {
      try { localStorage.removeItem(k); } catch (e) { log('auth: localStorage nejde smazat'); }
      try { if (localStorage.getItem(k)) localStorage.setItem(k, ''); } catch (e) { log('auth: localStorage nejde přepsat'); }
    }, 0);
  }
};
// Odhlášení jen tohoto zařízení. Povede se vždy: signOut při vypršeném tokenu a výpadku vrací chybu bez smazání session
// (až po 30 s opakování) a bez odpovědi serveru neskončí vůbec, proto se při chybě nebo po limitu session smaže tady.
var ODHLASENI_LIMIT_MS = 5000;
var odhlasovani = null; // běžící signOut; nové přihlášení na něj čeká, jinak by mu opožděný signOut session smazal
function odhlasen() {
  if (!uzivatel) return; // opožděná událost nesmí překreslit rozepsané přihlášení
  uzivatel = null; pristup = null; S = prazdnaData();
  location.hash = '#/'; render();
}
function odhlasit() {
  var smazano = false;
  function jenLokalne(duvod) {
    if (smazano) return;
    smazano = true;
    log('odhlášení offline – session smazána jen lokálně', '(' + duvod + ')');
    authStorage.removeItem(AUTH_KLIC);
    odhlasen();
  }
  var limit = setTimeout(function () { jenLokalne('server neodpověděl'); }, ODHLASENI_LIMIT_MS);
  odhlasovani = sb.auth.signOut({ scope: 'local' }).catch(function (e) { return { error: e }; }).then(function (r) {
    clearTimeout(limit);
    if (r.error) jenLokalne((r.error.status || '') + ' ' + r.error.message); else odhlasen();
    odhlasovani = null;
  });
}
// Odhlášení v jiné záložce: kopie v paměti této záložky by při obnově tokenu session zapsala zpět.
window.addEventListener('storage', function (e) {
  if (e.key !== AUTH_KLIC || e.newValue) return; // jen smazání nebo přepsání prázdnou hodnotou
  authPamet[AUTH_KLIC] = null;
  odhlasen();
});
function nactiSkript(src) {
  return new Promise(function (res, rej) {
    var el = document.createElement('script'); el.src = src; el.onload = res;
    el.onerror = function () { rej(new Error('Nepodařilo se načíst knihovnu Supabase (jsi online?)')); };
    document.head.appendChild(el);
  });
}
function nactiData() {
  return Promise.all([
    q('rpc smi', db.rpc('smi')),
    q('select skupiny', db.from('skupiny').select('*')),
    q('select pristroje', db.from('pristroje').select('*')),
    q('select kalibrace', db.from('kalibrace').select('*')),
    q('select nastaveni', db.from('nastaveni').select('*').maybeSingle())
  ]).then(function (r) {
    pristup = r[0] === true;
    S = { skupiny: r[1], pristroje: r[2], kalibrace: r[3], nastaveni: r[4] || {} };
    log('načteno', S.skupiny.length + ' skupin, ' + S.pristroje.length + ' přístrojů, ' + S.kalibrace.length + ' kalibrací');
    // Miniatury: jedna dávka podepsaných URL (1 h); chyba fotek nebrání zobrazení dat
    var fotky = S.pristroje.map(function (p) { return p.foto_path; }).filter(Boolean);
    if (!fotky.length) return;
    return q('sign fotky ' + fotky.length, sb.storage.from(SCHEMA + '-fotky').createSignedUrls(fotky, 3600)).then(function (d) {
      d.forEach(function (x) { if (x.signedUrl) fotoUrl[x.path] = x.signedUrl; });
    }, function (e) { logChyba('miniatury: ' + e.message); });
  });
}
function start() {
  if (DEMO) return render();
  app.innerHTML = '<main><h1>Kalibrace</h1><div class="empty">Načítám…</div></main>';
  nactiSkript(SUPABASE_JS).then(function () {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: authStorage, storageKey: AUTH_KLIC, persistSession: true, autoRefreshToken: true } });
    db = sb.schema(SCHEMA);
    sb.auth.onAuthStateChange(function (udalost) {
      log('auth', udalost);
      if (udalost === 'SIGNED_OUT') odhlasen();
    });
    return sb.auth.getSession();
  }).then(function (r) {
    if (!r.data.session) return r;
    // Session z localStorage může být po odhlášení (blokované mazání) – ověří se na serveru. Zahodí se jen odmítnutá, při výpadku zůstane.
    return sb.auth.getUser().then(function (u) {
      if (!u.error) return;
      log('auth: ověření sezení', (u.error.code || u.error.status || '') + ' ' + u.error.message);
      if (AUTH_NEPLATNE.indexOf(u.error.code) >= 0) return sb.auth.signOut({ scope: 'local' }); // ostatní zařízení nechat být
    }).then(function () { return sb.auth.getSession(); });
  }).then(function (r) {
    // vypršený token a výpadek: session v úložišti zůstává, přihlašovací formulář by vypadal jako odhlášení
    if (!r.data.session && r.error && r.error.name === 'AuthRetryableFetchError') throw new Error('Server přihlášení není dostupný. Přihlášení zůstává uložené, zkus to za chvíli znovu.');
    uzivatel = r.data.session ? r.data.session.user : null;
    return uzivatel ? nactiData() : null;
  }).then(render).catch(function (e) {
    logChyba(e.message);
    app.innerHTML = '<main><h1>Kalibrace</h1><div class="err" role="alert">' + h(e.message) + '</div>' +
      '<button class="btn primary" style="width:100%" onclick="location.reload()">Zkusit znovu</button></main>';
  });
}

function vPrihlaseni() {
  app.innerHTML = '<main><h1>Kalibrace</h1><form id="frm" novalidate><div class="group">' +
    pole('E-mail', 'email', '', 'type="email" autocomplete="username" autocapitalize="none" required') +
    pole('Heslo', 'heslo', '', 'type="password" autocomplete="current-password" required') + '</div>' +
    '<div class="err" id="chyba" role="alert"></div><button class="btn primary" type="submit" style="width:100%;margin-top:16px">Přihlásit</button></form>' +
    '<footer>verze ' + VERZE + '</footer></main>';
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target), email = f.get('email').trim(), heslo = f.get('heslo');
    if (!email || !heslo) return chyba('Vyplň e-mail a heslo.');
    var btn = e.target.querySelector('button'); btn.disabled = true;
    chyba(odhlasovani ? 'Dokončuji předchozí odhlášení… Kdyby to trvalo déle než půl minuty, obnov stránku.' : '');
    Promise.resolve(odhlasovani).then(function () {
      return sb.auth.signInWithPassword({ email: email, password: heslo });
    }).then(function (r) {
      log('přihlášení', r.error ? (r.error.status + ' ' + r.error.message) : 'ok');
      if (r.error) throw new Error(/invalid login/i.test(r.error.message) ? 'Špatný e-mail nebo heslo.' : r.error.message);
      return sb.auth.getSession();
    }).then(function (r) {
      if (!r.data.session) { // bez session by dotazy šly jako anon a skončily „permission denied“
        logChyba('session se neuložila' + (r.error ? ': ' + r.error.message : ''));
        throw new Error('Prohlížeč neuložil přihlášení. Obnov stránku a zkus to znovu, případně pro tuto adresu vypni blokování sledování (např. Avast AntiTrack).');
      }
      uzivatel = r.data.session.user;
      return nactiData();
    }).then(function () { location.hash = '#/'; render(); })
      .catch(function (err) { btn.disabled = false; chyba('Přihlášení se nepovedlo: ' + err.message); });
  };
}
function vBezPristupu() {
  app.innerHTML = '<main><h1>Kalibrace</h1><div class="err" role="alert">Účet ' + h(uzivatel.email) + ' nemá přístup k appce Kalibrace. ' +
    'Požádej správce o přidání „kalibrace“ do profilu.</div><button class="btn danger" style="width:100%" data-act="odhlasit">Odhlásit</button></main>';
}
function selhalo(err) { logChyba(err.message); alertBox('Uložení selhalo: ' + err.message); }

function ulozDo(arr, o) {
  if (!o.id) { o.id = id(); o.owner = 'demo'; o.created_at = new Date().toISOString(); arr.push(o); }
  else { var i = arr.findIndex(function (x) { return x.id === o.id; }); arr[i] = Object.assign(arr[i], o); o = arr[i]; }
  log('uloženo', o.id);
  return Promise.resolve(o);
}

/* ---------- Pomocné ---------- */
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(sel) { return document.querySelector(sel); }
function najdi(arr, x) { return arr.find(function (o) { return o.id === x; }); }
function kalibraceOf(pid) { return S.kalibrace.filter(function (k) { return k.pristroj_id === pid; }); }
function plusDni(iso, n) { return new Date((Calc.denCislo(iso) + n) * 86400000).toISOString().slice(0, 10); }
function dniText(n) { return n === 1 ? '1 den' : (n >= 2 && n <= 4 ? n + ' dny' : n + ' dní'); }
function nazevPristroje(p) {
  var v = (p.vyrobce || '').trim(), m = (p.model || '').trim();
  // Výrobce se nezopakuje, když jím model už začíná („Testo“ + „Testo 417“ → „Testo 417“)
  if (v && m.toLowerCase().indexOf(v.toLowerCase()) === 0 && (m.length === v.length || m.charAt(v.length) === ' ')) v = '';
  return [v, m].filter(Boolean).join(' ') || 'Přístroj';
}
function lsGet(k, d) { try { var v = localStorage.getItem('kal_' + k); return v === null ? d : v; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('kal_' + k, v); } catch (e) { /* bez úložiště */ } }

var IKONY = {
  anemometr: '<circle cx="12" cy="12" r="9.5"/><path d="M12 12c0-3 1-6 3.5-6.5M12 12c2.6 1.5 4.6 3.8 3.8 6.2M12 12c-2.6 1.5-5.6 1.8-7.3 0"/><circle cx="12" cy="12" r="1.4"/>',
  balometr: '<path d="M3 4h18l-6 9v5H9v-5z"/><path d="M9 21h6"/>',
  detektor_uniku: '<rect x="7" y="9" width="10" height="13" rx="2"/><path d="M12 9V2"/><path d="M10 13h4"/><circle cx="12" cy="17.5" r="1.5"/>',
  dif_manometr: '<path d="M6.5 18a7.5 7.5 0 1 1 11 0"/><path d="M12 13l3.5-4"/><circle cx="12" cy="13" r="1.2"/><path d="M9 21v-2M15 21v-2"/>',
  jiny: '<path d="M14.5 3.5a5 5 0 0 0 6 6l-10 10a2.1 2.1 0 0 1-3-3l10-10"/><path d="M14.5 3.5l3 3"/>'
};
var TYPY = { anemometr: 'Anemometr', balometr: 'Balometr', detektor_uniku: 'Detektor úniků', dif_manometr: 'Diferenční manometr', jiny: 'Jiný' };
function ikona(typ) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IKONY[typ] || IKONY.jiny) + '</svg>'; }
var fotoUrl = {}; // foto_path -> object URL
function thumb(p, g) {
  var u = p.foto_path && fotoUrl[p.foto_path];
  return u ? '<div class="thumb"><img src="' + h(u) + '" alt=""></div>' : '<div class="thumb" data-typ="' + h((g && g.typ) || 'jiny') + '">' + ikona(g && g.typ) + '</div>';
}
var GEAR = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ---------- Výpočet celého přehledu ---------- */
function spocitej() {
  var vse = [];
  var skupiny = S.skupiny.slice().sort(function (a, b) { return (a.poradi || 0) - (b.poradi || 0); }).map(function (g) {
    var items = S.pristroje.filter(function (p) { return p.skupina_id === g.id; }).map(function (p) {
      return { pristroj: p, s: Calc.stavPristroje(p, kalibraceOf(p.id), dnes, S.nastaveni) };
    });
    var gs = Calc.stavSkupiny(g, items);
    items.forEach(function (x) { x.tlumeny = Calc.jeTlumeny(x.s, gs.stav); x.g = g; x.gs = gs; x.jedinyKus = gs.aktivnich <= 1; vse.push(x); });
    items.sort(Calc.porovnejNalehavost);
    return { g: g, gs: gs, items: items };
  });
  return { skupiny: skupiny, vse: vse };
}

/* ---------- Obrazovky ---------- */
var app = document.getElementById('app');
function bar(levy, pravy) { return '<div class="bar">' + (levy || '') + '<span class="spacer"></span>' + (pravy || '') + '</div>'; }
function zpet(href, text) { return '<a class="btn-text" href="' + href + '">‹ ' + (text || 'Zpět') + '</a>'; }
var banner = DEMO ? '<div class="banner">Ukázkový režim – data jsou smyšlená a změny se po obnovení stránky ztratí.</div>' : '';

// Štítek verzálkami + doplňující text vedle („PLATNÁ zbývá 143 dní“)
var STITEK = { platna: 'PLATNÁ', brzy: 'BRZY', propadla: 'PROPADLÁ', bez: 'BEZ KALIBRACE', na_kalibraci: 'NA KALIBRACI', vyrazeno: 'VYŘAZENO' };
function tagHtml(x) {
  var st = x.s.stav, txt = st === 'propadla' ? x.s.text.replace(/^propadlá /, '') : st === 'na_kalibraci' ? x.s.text.replace(/^na kalibraci ?/, '')
    : st === 'bez' || st === 'vyrazeno' ? '' : x.s.text;
  return '<div class="stav"><span class="tag ' + (x.tlumeny ? 'tlumeny' : st) + '" data-stav="' + st + '">' + STITEK[st] + '</span>' +
    (txt ? '<span class="txt">' + h(txt) + '</span>' : '') + '</div>';
}

function hlavickaSkupiny(G) {
  var gs = G.gs, t;
  if (gs.stav === 'prazdna') return '<div class="ghead" data-skupina-stav="prazdna"><span class="dot prazdna"></span><div><div class="t">Bez přístrojů</div></div></div>';
  if (gs.stav === 'zelena') t = 'V pořádku';
  else if (gs.stav === 'oranzova') t = 'Brzy vyprší – ' + (gs.zbyva === 0 ? 'dnes' : 'za ' + dniText(gs.zbyva));
  else t = gs.min === 1 ? 'Bez platné kalibrace' : 'Platné jen ' + gs.platnych + ' z ' + gs.min + ' potřebných';
  var sub = '<div class="sub">platné ' + gs.platnych + ' z ' + gs.aktivnich + ' · potřeba ' + gs.min + '</div>';
  var kdo = gs.dalsi ? 'SN ' + h(gs.dalsi.vyrobni_cislo) + (gs.dalsi.technik ? ' – ' + h(gs.dalsi.technik) : '') : '';
  var next = gs.vyzva === 'posli' ? '<div class="next">Pošli na kalibraci: <b>' + kdo + '</b></div>'
    : gs.vyzva === 'na_rade' ? '<div class="next narade">Na řadě: ' + kdo + (gs.odeslat_do ? ' · odeslat do ' + Calc.formatDatum(gs.odeslat_do) : '') + '</div>' : '';
  return '<div class="ghead" data-skupina-stav="' + gs.stav + '"><span class="dot ' + gs.stav + '"></span><div><div class="t">' + t + '</div>' + sub + next + '</div></div>';
}

function radekPristroje(x) {
  var p = x.pristroj;
  // Skupina o 1 kusu nemá hlavičku – výzva k odeslání je přímo u přístroje
  var posli = x.jedinyKus && x.gs.vyzva === 'posli' && x.gs.dalsi === p ? '<div class="next">Pošli na kalibraci</div>' : '';
  var sub = ['SN ' + p.vyrobni_cislo, p.technik].filter(Boolean);
  if (p.stav === 'na_kalibraci' && p.ocekavany_navrat) sub.push('návrat ' + Calc.formatDatumKratce(p.ocekavany_navrat));
  return '<a class="row' + (x.tlumeny ? ' tlumeny' : '') + '" href="#/p/' + p.id + '" data-pristroj="' + h(p.vyrobni_cislo) + '">' + thumb(p, x.g) +
    '<div class="info"><div class="t">' + h(nazevPristroje(p)) + '</div><div class="sub">' + h(sub.join(' · ')) + '</div>' + tagHtml(x) + posli + '</div></a>';
}

function vPrehled() {
  var D = spocitej();
  var filtr = lsGet('filtr', 'vse'), vyrazene = lsGet('vyrazene', '0') === '1';
  var sm = Calc.souhrnSkupin(D.skupiny.map(function (G) { return G.gs; }));
  var html = bar('<a class="btn-text" href="#/skupiny">Skupiny</a>',
    '<a class="btn-text" href="#/nastaveni" aria-label="Nastavení">' + GEAR + '</a>');
  html += '<main><h1>Kalibrace</h1><a class="btn primary btn-novy" href="#/novy">+ Nový přístroj</a>' + banner;
  var stat = function (k, l) { return '<div class="' + k + (sm[k] ? '' : ' nula') + '"><div class="l">' + l + '</div><div class="n">' + sm[k] + '</div></div>'; };
  html += '<div class="stats" id="souhrn" aria-label="Stav skupin">' + stat('ok', 'V POŘÁDKU') + stat('brzy', 'BRZY') + stat('nedostatek', 'NEDOSTATEK') + '</div>';
  html += '<div class="seg" role="group"><button data-act="filtr" data-v="vse" aria-pressed="' + (filtr === 'vse') + '">Vše</button>' +
    '<button data-act="filtr" data-v="problemy" aria-pressed="' + (filtr === 'problemy') + '">Jen problémy</button></div>';
  html += '<label class="toggle-row"><input type="checkbox" data-act="vyrazene"' + (vyrazene ? ' checked' : '') + '> Zobrazit vyřazené</label>';
  var nic = true;
  D.skupiny.forEach(function (G) {
    var items = G.items.filter(function (x) { return vyrazene || x.s.stav !== 'vyrazeno'; });
    if (filtr === 'problemy') {
      if (G.gs.stav === 'zelena' || G.gs.stav === 'prazdna') return;
      items = items.filter(function (x) { return x.s.stav !== 'platna' && !x.tlumeny && x.s.stav !== 'vyrazeno'; });
    }
    nic = false;
    html += '<h2>' + h(G.g.nazev) + '</h2><section class="group" data-skupina="' + h(G.g.nazev) + '" data-skupina-stav="' + G.gs.stav + '">' + (G.gs.aktivnich > 1 || G.gs.stav === 'prazdna' ? hlavickaSkupiny(G) : '') +
      (items.length ? items.map(radekPristroje).join('') : '<div class="empty"><a href="#/novy?g=' + G.g.id + '">Přidat přístroj</a></div>') + '</section>';
  });
  if (nic) html += '<div class="empty">' + (filtr === 'problemy' ? 'Žádné problémy – vše v pořádku. ✓' : 'Zatím žádné skupiny. <a href="#/skupiny/nova">Založit skupinu</a>') + '</div>';
  html += '<footer>verze ' + VERZE + (DEMO ? ' · demo' : '') + ' · dnes ' + Calc.formatDatum(dnes) + '</footer></main>';
  app.innerHTML = html;
}

var predpripraveno = null; // { path, url, cas, blob } – připraveno dopředu, aby Otevřít/Sdílet fungovalo hned (iOS vyžaduje gesto)
function vDetail(pid) {
  var p = najdi(S.pristroje, pid);
  if (!p) return nenalezeno();
  var g = najdi(S.skupiny, p.skupina_id);
  var D = spocitej(), x = D.vse.find(function (i) { return i.pristroj.id === pid; });
  var kal = kalibraceOf(pid).sort(function (a, b) { return a.datum_kalibrace < b.datum_kalibrace ? 1 : -1; });
  var akt = Calc.posledniKalibrace(kal);
  var html = bar(zpet('#/', 'Přehled'), '<a class="btn-text" href="#/p/' + pid + '/upravit">Upravit</a>');
  html += '<main><div class="hero">' + thumb(p, g) + '<div><h1>' + h(nazevPristroje(p)) + '</h1>' + tagHtml(x) + '</div></div>';
  var predstih = p.predstih_dni != null ? p.predstih_dni + ' dní' : 'výchozí (' + (S.nastaveni.predstih_dni_vychozi || 30) + ' dní)';
  var kv = [['Skupina', g ? g.nazev : '–'], ['Výrobní číslo', p.vyrobni_cislo], ['Technik', p.technik || '–'],
    ['Platnost do', akt ? Calc.formatDatum(akt.platnost_do) : '–'], ['Interval', p.interval_mesicu + ' měsíců'],
    ['Doba v laboratoři', p.doba_v_lab_dni + ' dní'], ['Předstih upozornění', predstih]];
  if (p.stav === 'na_kalibraci') kv.push(['Odesláno', Calc.formatDatum(p.odeslano_dne)], ['Očekávaný návrat', Calc.formatDatum(p.ocekavany_navrat)]);
  if (p.poznamka) kv.push(['Poznámka', p.poznamka]);
  html += '<div class="group" style="margin-top:12px">' + kv.map(function (r) { return '<div class="kv"><span>' + h(r[0]) + '</span><span>' + h(r[1]) + '</span></div>'; }).join('') + '</div>';

  html += '<h2>Aktuální protokol</h2>';
  if (akt && akt.protokol_path) {
    html += '<div class="group"><div class="kv"><span>' + h(akt.laborator || 'Protokol') + '</span><span>' + h(akt.cislo_protokolu || '') + '</span></div></div>' +
      '<div class="actions"><button class="btn" data-act="otevrit" data-path="' + h(akt.protokol_path) + '">Otevřít</button>' +
      '<button class="btn primary" data-act="sdilet" data-path="' + h(akt.protokol_path) + '" data-nazev="' + h(nazevSouboru(p, akt)) + '">Sdílet protokol</button></div>';
  } else html += '<div class="group"><div class="empty">Protokol není nahraný</div></div>';

  html += '<div class="actions" style="margin-top:20px">';
  if (p.stav === 'aktivni') html += '<a class="btn" href="#/p/' + pid + '/kalibrace">Přidat kalibraci</a><a class="btn" href="#/p/' + pid + '/odeslat">Odeslat na kalibraci</a>';
  if (p.stav === 'na_kalibraci') html += '<a class="btn primary full" href="#/p/' + pid + '/kalibrace">Vráceno – zadat kalibraci</a><button class="btn full" data-act="zrusitOdeslani" data-id="' + pid + '">Zrušit odeslání</button>';
  if (p.stav === 'vyrazeno') html += '<button class="btn" data-act="obnovit" data-id="' + pid + '">Obnovit</button><button class="btn danger" data-act="smazatPristroj" data-id="' + pid + '" data-confirm="Opravdu smazat?">Smazat</button>';
  else html += '<button class="btn danger full" data-act="vyradit" data-id="' + pid + '" data-confirm="Klepni znovu pro vyřazení">Vyřadit</button>';
  html += '</div>';

  html += '<h2>Historie kalibrací</h2><div class="group">' + (kal.length ? kal.map(function (k) {
    return '<a class="row" href="#/p/' + pid + '/kalibrace/' + k.id + '"><div class="info"><div class="t">' + Calc.formatDatum(k.datum_kalibrace) + ' → ' + Calc.formatDatum(k.platnost_do) +
      '</div><div class="sub">' + h([k.laborator, k.cislo_protokolu].filter(Boolean).join(' · ') || '–') + (k.protokol_path ? ' · 📄' : '') + '</div></div><span class="chev">›</span></a>';
  }).join('') : '<div class="empty">Zatím žádná kalibrace</div>') + '</div></main>';
  app.innerHTML = html;
  predpripraveno = null;
  if (akt && akt.protokol_path) {
    var path = akt.protokol_path;
    var pp = predpripraveno = { path: path };
    api.souborUrl('protokoly', path).then(function (u) { pp.url = u; pp.cas = Date.now(); }, function (e) { logChyba(e.message); });
    api.souborBlob('protokoly', path).then(function (b) { pp.blob = b; log('protokol připraven', Math.round(b.size / 1024) + ' kB'); }, function (e) { logChyba(e.message); });
  }
}
function nazevSouboru(p, k) {
  return ('Kalibrace_' + nazevPristroje(p) + '_SN' + p.vyrobni_cislo + '_' + k.platnost_do).replace(/[^\w.-]+/g, '_');
}

function pole(label, name, value, attrs) {
  return '<div class="field"><label for="f_' + name + '">' + label + '</label><input id="f_' + name + '" name="' + name + '" value="' + h(value) + '" ' + (attrs || '') + '></div>';
}
function formular(titul, zpetHref, obsah, extra) {
  return bar(zpet(zpetHref, 'Zrušit'), '<button class="btn-text" form="frm" type="submit" style="font-weight:600">Uložit</button>') +
    '<main><h1>' + titul + '</h1><form id="frm" novalidate>' + obsah + '<div class="err" id="chyba" role="alert"></div>' +
    '<button class="btn primary" type="submit" style="width:100%;margin-top:16px">Uložit</button></form>' + (extra || '') + '</main>';
}

function vFormPristroj(pid) {
  var p = pid ? najdi(S.pristroje, pid) : null;
  if (pid && !p) return nenalezeno();
  if (!S.skupiny.length) { app.innerHTML = bar(zpet('#/')) + '<main><h1>Nový přístroj</h1><div class="empty">Nejdřív založ skupinu. <a href="#/skupiny/nova">Založit skupinu</a></div></main>'; return; }
  var gq = new URLSearchParams(location.hash.split('?')[1] || '').get('g');
  var v = p || { skupina_id: gq || S.skupiny[0].id, interval_mesicu: Calc.VYCHOZI.interval_mesicu, doba_v_lab_dni: Calc.VYCHOZI.doba_v_lab_dni };
  var opts = S.skupiny.map(function (g) { return '<option value="' + g.id + '"' + (g.id === v.skupina_id ? ' selected' : '') + '>' + h(g.nazev) + '</option>'; }).join('');
  var obsah = '<div class="group"><div class="field"><label for="f_skupina_id">Skupina</label><select id="f_skupina_id" name="skupina_id">' + opts + '</select></div>' +
    pole('Výrobce', 'vyrobce', v.vyrobce) + pole('Model *', 'model', v.model, 'required') +
    pole('Výrobní číslo *', 'vyrobni_cislo', v.vyrobni_cislo, 'required autocapitalize="characters"') + pole('Technik', 'technik', v.technik) + '</div>' +
    '<h2>Kalibrace</h2><div class="group">' + pole('Interval (měsíce)', 'interval_mesicu', v.interval_mesicu, 'type="number" inputmode="numeric" min="1" max="120"') +
    pole('Doba v laboratoři (dny)', 'doba_v_lab_dni', v.doba_v_lab_dni, 'type="number" inputmode="numeric" min="0" max="180"') +
    pole('Předstih (dny)', 'predstih_dni', v.predstih_dni, 'type="number" inputmode="numeric" min="0" max="365" placeholder="výchozí ' + (S.nastaveni.predstih_dni_vychozi || 30) + '"') + '</div>' +
    '<p class="hint">Upozornění přijde v předstihu + době v laboratoři, aby se kus vrátil dřív, než vyprší.</p>' +
    '<h2>Fotka a poznámka</h2><div class="group"><div class="field"><label for="f_foto">Fotka</label><input id="f_foto" name="foto" type="file" accept="image/*" capture="environment"></div>' +
    '<div class="field"><label for="f_poznamka">Poznámka</label><textarea id="f_poznamka" name="poznamka">' + h(v.poznamka) + '</textarea></div></div>';
  app.innerHTML = formular(p ? 'Upravit přístroj' : 'Nový přístroj', p ? '#/p/' + pid : '#/', obsah);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target), cislo = function (n) { var x = f.get(n); return x === '' ? null : Number(x); };
    var o = { id: pid || undefined, skupina_id: f.get('skupina_id'), vyrobce: f.get('vyrobce').trim(), model: f.get('model').trim(),
      vyrobni_cislo: f.get('vyrobni_cislo').trim(), technik: f.get('technik').trim(), interval_mesicu: cislo('interval_mesicu') || 12,
      doba_v_lab_dni: cislo('doba_v_lab_dni') == null ? 14 : cislo('doba_v_lab_dni'), predstih_dni: cislo('predstih_dni'), poznamka: f.get('poznamka').trim() };
    if (!o.model || !o.vyrobni_cislo) return chyba('Vyplň model a výrobní číslo.');
    if (S.pristroje.some(function (x) { return x.vyrobni_cislo === o.vyrobni_cislo && x.id !== pid; })) return chyba('Přístroj s tímto výrobním číslem už existuje.');
    if (!pid) o.stav = 'aktivni';
    var foto = f.get('foto'), stara = p && p.foto_path;
    (foto && foto.size ? zmensiFoto(foto).then(function (b) {
      return api.nahrajSoubor('fotky', b).then(function (path) { o.foto_path = path; fotoUrl[path] = URL.createObjectURL(b); });
    }) : Promise.resolve())
      .then(function () { return api.ulozPristroj(o); })
      .then(function (ulozeny) {
        if (o.foto_path && stara) api.smazSoubory('fotky', [stara]).catch(function (e) { logChyba('stará fotka: ' + e.message); });
        location.hash = '#/p/' + ulozeny.id;
      })
      .catch(function (err) { chyba('Uložení selhalo: ' + err.message); logChyba(err.message); });
  };
}

// Zmenší fotku na max. 400 px (JPEG) – šetří Storage i data
function zmensiFoto(file) {
  return new Promise(function (res, rej) {
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, 400 / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(function (b) { b ? res(b) : rej(new Error('Fotku nejde zmenšit')); }, 'image/jpeg', 0.8);
    };
    img.onerror = function () { rej(new Error('Soubor není obrázek')); };
    img.src = u;
  });
}

function vFormKalibrace(pid, kid) {
  var p = najdi(S.pristroje, pid);
  var k = kid ? najdi(S.kalibrace, kid) : null;
  if (!p || (kid && !k)) return nenalezeno();
  var datum = k ? k.datum_kalibrace : dnes;
  var labs = Array.from(new Set(S.kalibrace.map(function (x) { return x.laborator; }).filter(Boolean)));
  var obsah = '<p class="souhrn">' + h(nazevPristroje(p)) + ' · SN ' + h(p.vyrobni_cislo) + '</p><div class="group">' +
    pole('Datum kalibrace', 'datum_kalibrace', datum, 'type="date" required') +
    pole('Platnost do', 'platnost_do', k ? k.platnost_do : Calc.pridejMesice(datum, p.interval_mesicu), 'type="date" required') +
    pole('Laboratoř', 'laborator', k ? k.laborator : (labs[0] || ''), 'list="labs"') + '<datalist id="labs">' + labs.map(function (l) { return '<option value="' + h(l) + '">'; }).join('') + '</datalist>' +
    pole('Číslo protokolu', 'cislo_protokolu', k && k.cislo_protokolu) +
    pole('Cena (Kč)', 'cena', k && k.cena, 'type="number" inputmode="decimal" min="0" step="any"') + '</div>' +
    '<p class="hint">Platnost se předvyplní podle intervalu (' + p.interval_mesicu + ' měs.), uprav ji podle protokolu.</p>' +
    '<h2>Protokol</h2><div class="group"><div class="field"><label for="f_soubor">PDF nebo foto</label><input id="f_soubor" name="soubor" type="file" accept="application/pdf,image/*"></div>' +
    (k && k.protokol_path ? '<div class="kv"><span>Nahraný soubor</span><span><button type="button" class="btn-text" data-act="otevrit" data-path="' + h(k.protokol_path) + '">Otevřít</button></span></div>' : '') +
    '<div class="field"><label for="f_poznamka">Poznámka</label><textarea id="f_poznamka" name="poznamka">' + h(k && k.poznamka) + '</textarea></div></div>';
  var extra = k ? '<div class="actions"><button class="btn danger full" data-act="smazatKalibraci" data-id="' + k.id + '" data-pid="' + pid + '" data-confirm="Klepni znovu pro smazání">Smazat kalibraci</button></div>' : '';
  app.innerHTML = formular(k ? 'Upravit kalibraci' : 'Nová kalibrace', '#/p/' + pid, obsah, extra);
  var platnostRucne = !!k;
  $('#f_platnost_do').oninput = function () { platnostRucne = true; };
  $('#f_datum_kalibrace').oninput = function () { if (!platnostRucne && this.value) $('#f_platnost_do').value = Calc.pridejMesice(this.value, p.interval_mesicu); };
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    var o = { id: kid || undefined, pristroj_id: pid, datum_kalibrace: f.get('datum_kalibrace'), platnost_do: f.get('platnost_do'),
      laborator: f.get('laborator').trim(), cislo_protokolu: f.get('cislo_protokolu').trim(), cena: f.get('cena') === '' ? null : Number(f.get('cena')), poznamka: f.get('poznamka').trim() };
    if (!o.datum_kalibrace || !o.platnost_do) return chyba('Vyplň datum kalibrace a platnost.');
    if (o.platnost_do < o.datum_kalibrace) return chyba('Platnost nemůže končit před datem kalibrace.');
    var soubor = f.get('soubor');
    if (soubor && soubor.size > 10 * 1024 * 1024) return chyba('Soubor je větší než 10 MB.');
    var stary = k && k.protokol_path;
    (soubor && soubor.size ? api.nahrajSoubor('protokoly', soubor).then(function (path) { o.protokol_path = path; }) : Promise.resolve())
      .then(function () { return api.ulozKalibraci(o); })
      .then(function () { if (o.protokol_path && stary) api.smazSoubory('protokoly', [stary]).catch(function (e) { logChyba('starý protokol: ' + e.message); }); })
      .then(function () { return p.stav === 'na_kalibraci' && !kid ? api.ulozPristroj({ id: pid, stav: 'aktivni', odeslano_dne: null, ocekavany_navrat: null }) : null; })
      .then(function () { location.hash = '#/p/' + pid; })
      .catch(function (err) { chyba('Uložení selhalo: ' + err.message); logChyba(err.message); });
  };
}

function vOdeslat(pid) {
  var p = najdi(S.pristroje, pid);
  if (!p) return nenalezeno();
  var obsah = '<p class="souhrn">' + h(nazevPristroje(p)) + ' · SN ' + h(p.vyrobni_cislo) + '</p><div class="group">' +
    pole('Odesláno dne', 'odeslano_dne', dnes, 'type="date" required') +
    pole('Očekávaný návrat', 'ocekavany_navrat', plusDni(dnes, p.doba_v_lab_dni), 'type="date"') + '</div>';
  app.innerHTML = formular('Odeslat na kalibraci', '#/p/' + pid, obsah);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    if (!f.get('odeslano_dne')) return chyba('Vyplň datum odeslání.');
    api.ulozPristroj({ id: pid, stav: 'na_kalibraci', odeslano_dne: f.get('odeslano_dne'), ocekavany_navrat: f.get('ocekavany_navrat') || null })
      .then(function () { location.hash = '#/p/' + pid; }, function (err) { chyba('Uložení selhalo: ' + err.message); logChyba(err.message); });
  };
}

function vSkupiny() {
  var D = spocitej();
  var html = bar(zpet('#/', 'Přehled'), '<a class="btn-text" href="#/skupiny/nova">+ Nová</a>') + '<main><h1>Skupiny</h1>';
  html += '<p class="hint" style="margin:0 0 12px">Skupina je zelená, když má aspoň „min. platných“ kusů s platnou kalibrací. Kusy ve skupině se navzájem zastupují.</p>';
  html += '<div class="group">' + (D.skupiny.length ? D.skupiny.map(function (G) {
    return '<a class="row" href="#/skupiny/' + G.g.id + '"><div class="thumb" data-typ="' + h(G.g.typ || 'jiny') + '">' + ikona(G.g.typ) + '</div><div class="info"><div class="t">' + h(G.g.nazev) +
      '</div><div class="sub">' + h(TYPY[G.g.typ] || G.g.typ) + ' · ' + (G.gs.stav === 'prazdna' ? 'bez přístrojů' : G.gs.aktivnich + ' ks') +
      ' · ' + (G.g.vsechny_platne ? 'každý kus platný' : 'min. platných ' + G.gs.min) + ' · pořadí ' + (G.g.poradi || 0) + '</div></div><span class="dot ' + G.gs.stav + '" style="width:12px;height:12px;border-radius:50%;flex:none"></span></a>';
  }).join('') : '<div class="empty">Zatím žádné skupiny</div>') + '</div></main>';
  app.innerHTML = html;
}

function vFormSkupina(gid) {
  var g = gid ? najdi(S.skupiny, gid) : null;
  if (gid && !g) return nenalezeno();
  var v = g || { typ: 'jiny', min_platnych: 1, poradi: S.skupiny.reduce(function (m, x) { return Math.max(m, x.poradi || 0); }, 0) + 1 };
  var pocet = g ? S.pristroje.filter(function (p) { return p.skupina_id === gid; }).length : 0;
  var opts = Object.keys(TYPY).map(function (t) { return '<option value="' + t + '"' + (t === v.typ ? ' selected' : '') + '>' + TYPY[t] + '</option>'; }).join('');
  var obsah = '<div class="group">' + pole('Název *', 'nazev', v.nazev, 'required') +
    '<div class="field"><label for="f_typ">Typ</label><select id="f_typ" name="typ">' + opts + '</select></div>' +
    '<div class="field check"><label for="f_vsechny_platne">Každý kus musí mít platnou kalibraci</label><input type="checkbox" id="f_vsechny_platne" name="vsechny_platne"' + (v.vsechny_platne ? ' checked' : '') + '></div>' +
    '<div id="pole_min"' + (v.vsechny_platne ? ' hidden' : '') + '>' + pole('Min. platných', 'min_platnych', v.min_platnych, 'type="number" inputmode="numeric" min="1" max="50"') + '</div>' +
    pole('Pořadí', 'poradi', v.poradi, 'type="number" inputmode="numeric"') + '</div>' +
    '<p class="hint">Min. platných 1 = stačí jeden platný kus (rotace). „Každý kus“ = platné musí být všechny aktivní kusy, kus na kalibraci se počítá jako neplatný.</p>';
  var extra = g ? '<div class="actions">' + (pocet ? '<p class="hint full">Skupinu jde smazat, až v ní nebudou žádné přístroje (' + pocet + ' ks).</p>'
    : '<button class="btn danger full" data-act="smazatSkupinu" data-id="' + gid + '" data-confirm="Klepni znovu pro smazání">Smazat skupinu</button>') + '</div>' : '';
  app.innerHTML = formular(g ? 'Upravit skupinu' : 'Nová skupina', '#/skupiny', obsah, extra);
  $('#f_vsechny_platne').onchange = function () { $('#pole_min').hidden = this.checked; };
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    var o = { id: gid || undefined, nazev: f.get('nazev').trim(), typ: f.get('typ'), min_platnych: Math.max(1, Number(f.get('min_platnych')) || 1), vsechny_platne: f.get('vsechny_platne') === 'on', poradi: Number(f.get('poradi')) || 0 };
    if (!o.nazev) return chyba('Vyplň název skupiny.');
    api.ulozSkupinu(o).then(function () { location.hash = '#/skupiny'; }, function (err) { chyba('Uložení selhalo: ' + err.message); logChyba(err.message); });
  };
}

function vNastaveni() {
  var n = S.nastaveni;
  var obsah = '<h2>Upozornění</h2><div class="group">' + pole('E-mail', 'email_upozorneni', n.email_upozorneni, 'type="email" autocomplete="email"') +
    pole('Výchozí předstih (dny)', 'predstih_dni_vychozi', n.predstih_dni_vychozi, 'type="number" inputmode="numeric" min="0" max="365"') + '</div>' +
    '<p class="hint">E-mail přijde, když přístroji nebo skupině zbývá právě (předstih + doba v laboratoři), 14, 7, 1 nebo 0 dní, a každé pondělí souhrn problémů.</p>';
  var extra = '<h2>Účet</h2><div class="group"><div class="kv"><span>Přihlášen jako</span><span id="ucet">' + (DEMO ? 'ukázkový režim' : h(uzivatel.email)) + '</span></div>' +
    '<div class="kv"><span>Verze</span><span id="verze">verze ' + VERZE + '</span></div></div>' +
    '<div class="actions"><button class="btn danger full" data-act="odhlasit"' + (DEMO ? ' disabled' : '') + '>Odhlásit</button></div>' +
    '<p class="hint">Diagnostika: přidej k adrese <code>?debug=1</code>.</p>';
  app.innerHTML = formular('Nastavení', '#/', obsah, extra);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target);
    api.ulozNastaveni({ email_upozorneni: f.get('email_upozorneni').trim(), predstih_dni_vychozi: Number(f.get('predstih_dni_vychozi')) || 0 })
      .then(function () { location.hash = '#/'; }, function (err) { chyba('Uložení selhalo: ' + err.message); logChyba(err.message); });
  };
}

function nenalezeno() { app.innerHTML = bar(zpet('#/', 'Přehled')) + '<main><h1>Nenalezeno</h1><div class="empty">Záznam neexistuje.</div></main>'; }
function chyba(t) { $('#chyba').textContent = t; log('validace:', t); }

/* ---------- Akce (delegované klepnutí) ---------- */
var AKCE = {
  filtr: function (b) { lsSet('filtr', b.dataset.v); render(); },
  vyrazene: function (b) { lsSet('vyrazene', b.checked ? '1' : '0'); render(); },
  vyradit: function (b) { api.ulozPristroj({ id: b.dataset.id, stav: 'vyrazeno' }).then(render, selhalo); },
  obnovit: function (b) { api.ulozPristroj({ id: b.dataset.id, stav: 'aktivni' }).then(render, selhalo); },
  zrusitOdeslani: function (b) { api.ulozPristroj({ id: b.dataset.id, stav: 'aktivni', odeslano_dne: null, ocekavany_navrat: null }).then(render, selhalo); },
  smazatPristroj: function (b) {
    var p = najdi(S.pristroje, b.dataset.id), protokoly = kalibraceOf(b.dataset.id).map(function (k) { return k.protokol_path; });
    api.smazPristroj(b.dataset.id).then(function () {
      smazSouboryPotichu('fotky', [p.foto_path]); smazSouboryPotichu('protokoly', protokoly);
      location.hash = '#/';
    }, selhalo);
  },
  smazatKalibraci: function (b) {
    var k = najdi(S.kalibrace, b.dataset.id);
    api.smazKalibraci(b.dataset.id).then(function () { smazSouboryPotichu('protokoly', [k.protokol_path]); location.hash = '#/p/' + b.dataset.pid; }, selhalo);
  },
  smazatSkupinu: function (b) { api.smazSkupinu(b.dataset.id).then(function () { location.hash = '#/skupiny'; }, selhalo); },
  otevrit: function (b) { otevritSoubor(b.dataset.path); },
  sdilet: function (b) { sdilet(b.dataset.path, b.dataset.nazev); },
  odhlasit: function (b) { if (odhlasovani) return; b.disabled = true; b.textContent = 'Odhlašuji…'; odhlasit(); }
};
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (b.type === 'checkbox') return;
  e.preventDefault();
  if (b.dataset.confirm && !b.classList.contains('confirm')) { // potvrzení dvojím klepnutím
    var puvodni = b.textContent;
    b.classList.add('confirm'); b.textContent = b.dataset.confirm;
    setTimeout(function () { b.classList.remove('confirm'); b.textContent = puvodni; }, 3000);
    return;
  }
  log('akce', b.dataset.act);
  AKCE[b.dataset.act](b);
});
document.addEventListener('change', function (e) { if (e.target.dataset.act === 'vyrazene') AKCE.vyrazene(e.target); });

function smazSouboryPotichu(bucket, paths) { // soubor navíc ve Storage nevadí, chyba se jen zaloguje
  paths = paths.filter(Boolean);
  if (paths.length) api.smazSoubory(bucket, paths).catch(function (e) { logChyba('mazání souborů: ' + e.message); });
}
function priponu(blob) { return /pdf/.test(blob.type) ? '.pdf' : /png/.test(blob.type) ? '.png' : /heic/.test(blob.type) ? '.heic' : '.jpg'; }
function otevritSoubor(path) {
  var pp = predpripraveno;
  if (pp && pp.path === path && pp.url && Date.now() - pp.cas < 540000) { window.open(pp.url, '_blank'); return; }
  var w = window.open('', '_blank'); // otevřít hned v gestu, jinak to iOS zablokuje
  api.souborUrl('protokoly', path).then(function (u) { if (w) w.location = u; else location.href = u; })
    .catch(function (e) { if (w) w.close(); logChyba(e.message); alertBox('Protokol nejde otevřít: ' + e.message); });
}
function sdilet(path, nazev) {
  var hotovo = function (b) {
    var file = new File([b], nazev + priponu(b), { type: b.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: nazev }).catch(function (e) { if (e.name !== 'AbortError') logChyba('share: ' + e.message); });
    } else { log('share nepodporováno – otevírám'); window.open(URL.createObjectURL(b), '_blank'); }
  };
  if (predpripraveno && predpripraveno.path === path && predpripraveno.blob) return hotovo(predpripraveno.blob);
  api.souborBlob('protokoly', path).then(hotovo).catch(function (e) { logChyba(e.message); alertBox('Protokol nejde sdílet: ' + e.message); });
}
function alertBox(t) { var el = document.querySelector('main'); if (el) { var d = document.createElement('div'); d.className = 'err'; d.textContent = t; el.prepend(d); } }

/* ---------- Router ---------- */
function render() {
  var cesta = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  log('route', cesta.join('/') || 'prehled');
  try {
    if (!DEMO && !uzivatel) vPrihlaseni();
    else if (!DEMO && !pristup) vBezPristupu();
    else if (cesta[0] === 'p' && cesta[2] === 'upravit') vFormPristroj(cesta[1]);
    else if (cesta[0] === 'p' && cesta[2] === 'kalibrace') vFormKalibrace(cesta[1], cesta[3]);
    else if (cesta[0] === 'p' && cesta[2] === 'odeslat') vOdeslat(cesta[1]);
    else if (cesta[0] === 'p') vDetail(cesta[1]);
    else if (cesta[0] === 'novy') vFormPristroj(null);
    else if (cesta[0] === 'skupiny' && cesta[1] === 'nova') vFormSkupina(null);
    else if (cesta[0] === 'skupiny' && cesta[1]) vFormSkupina(cesta[1]);
    else if (cesta[0] === 'skupiny') vSkupiny();
    else if (cesta[0] === 'nastaveni') vNastaveni();
    else vPrehled();
  } catch (e) { logChyba(e.stack || e.message); app.innerHTML = '<main><h1>Chyba</h1><div class="err">' + h(e.message) + '</div></main>'; }
}
window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
log('start verze ' + VERZE + ', dnes ' + dnes + (DEMO ? ', demo' : ', schéma ' + SCHEMA));
start();

if ('serviceWorker' in navigator && !DEBUG) {
  navigator.serviceWorker.register('sw.js').then(function () { log('sw registrován'); }, function (e) { logChyba('sw: ' + e.message); });
}
