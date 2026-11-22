// Mock Supabase pro Playwright: auth (heslo), PostgREST pro schéma kalibrace (v paměti), supabase-js z node_modules.
// Testy tak nesahají na síť ani na produkční data.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const UMD = readFileSync(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
export const UID = '0e1d2c3b-4a59-4687-9786-a5b4c3d2e1f0';
export const EMAIL = 'tester@example.com';
export const HESLO = 'spravne-heslo';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function session() {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, session_id: 's1' }) + '.podpis';
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'obnova', user };
}

export async function mockSupabase(page, { pristup = true } = {}) {
  const store = { skupiny: [], pristroje: [], kalibrace: [], nastaveni: [], soubory: {} }; // soubory: 'bucket/cesta' -> velikost
  const hlavicky = []; // hodnoty Accept-Profile / Content-Profile všech REST dotazů
  const ctx = page.context(); // i pro nová okna (Otevřít protokol)
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@*/**', (r) => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await ctx.route('https://pqehuuamgecmdmrdhmza.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), m = req.method(), h = req.headers();
    const json = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname === '/auth/v1/token') {
      const b = req.postDataJSON();
      if (b.password !== HESLO) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, session());
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/auth/v1/user') return json(200, session().user);

    // Storage: upload, podepsané URL (jedna i dávka), stažení, mazání
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const zbytek = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      const obsah = (klic) => klic.endsWith('.pdf') ? { body: '%PDF-1.4 test', contentType: 'application/pdf' } : { body: PNG, contentType: 'image/png' };
      const soubor = (klic) => store.soubory[klic] ? route.fulfill({ status: 200, headers: CORS, ...obsah(klic) }) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      if (zbytek.startsWith('sign/')) {
        const cil = zbytek.slice(5);
        if (m === 'GET') return soubor(cil);
        const b = req.postDataJSON();
        if (b.paths) return json(200, b.paths.map((p) => ({ path: p, signedURL: `/object/sign/${cil}/${p}?token=t`, error: store.soubory[cil + '/' + p] ? null : 'not found' })));
        if (!store.soubory[cil]) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        return json(200, { signedURL: `/object/sign/${cil}?token=t` });
      }
      if (m === 'POST') { store.soubory[zbytek] = (req.postDataBuffer() || []).length; return json(200, { Id: randomUUID(), Key: zbytek }); }
      if (m === 'GET') return soubor(zbytek);
      if (m === 'DELETE') { for (const p of req.postDataJSON().prefixes) delete store.soubory[zbytek + '/' + p]; return json(200, []); }
    }

    const cesta = url.pathname.replace('/rest/v1/', '');
    hlavicky.push(m === 'GET' ? h['accept-profile'] : h['content-profile']);
    // jako produkce: bez JWT přihlášeného (jen publishable klíč) je to anon a ten nemá žádná práva
    if (!(h.authorization || '').startsWith('Bearer eyJ')) return json(401, { code: '42501', message: 'permission denied for ' + cesta });
    if (cesta === 'rpc/smi') return json(200, pristup);
    const t = store[cesta];
    if (!t) return json(404, { code: 'PGRST205', message: 'neznámá tabulka ' + cesta });
    const jeden = (h.accept || '').includes('vnd.pgrst.object');
    const vrat = (rows, status = 200) => (jeden ? (rows.length === 1 ? json(status, rows[0]) : json(406, { code: 'PGRST116', message: 'počet řádků ' + rows.length })) : json(status, rows));
    const idEq = (url.searchParams.get('id') || '').replace('eq.', '');
    const klic = cesta === 'nastaveni' ? 'owner' : 'id';

    if (m === 'GET') return vrat(t);
    if (m === 'POST') {
      const b = req.postDataJSON(), radky = Array.isArray(b) ? b : [b];
      const vysledek = radky.map((r) => {
        const stary = cesta === 'nastaveni' && t.find((x) => x.owner === (r.owner || UID));
        if (stary) return Object.assign(stary, r); // upsert
        const novy = { ...(cesta === 'nastaveni' ? {} : { id: randomUUID() }), owner: UID, created_at: new Date().toISOString(), ...r };
        t.push(novy); return novy;
      });
      return vrat(vysledek, 201);
    }
    if (m === 'PATCH') { const r = t.find((x) => x[klic] === idEq); Object.assign(r, req.postDataJSON()); return vrat([r]); }
    if (m === 'DELETE') {
      store[cesta] = t.filter((x) => x.id !== idEq);
      if (cesta === 'pristroje') store.kalibrace = store.kalibrace.filter((k) => k.pristroj_id !== idEq);
      return route.fulfill({ status: 204, headers: CORS });
    }
    return json(405, { message: 'metoda ' + m });
  });
  return { store, hlavicky };
}
