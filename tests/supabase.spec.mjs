// Ostrý režim (bez ?demo) proti mocku Supabase: přihlášení, CRUD, schéma kalibrace, odhlášení.
import { test, expect } from '@playwright/test';
import { mockSupabase, EMAIL, HESLO, UID, PNG } from './supabase-mock.mjs';

let chyby, ocekavane;
test.beforeEach(async ({ page }) => {
  chyby = []; ocekavane = null;
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') chyby.push(m.text()); });
});
// 400 ze špatného hesla prohlížeč hlásí jako „Failed to load resource“ – to je očekávané
test.afterEach(() => expect(chyby.filter((c) => !/Failed to load resource.*400/.test(c) && !(ocekavane && ocekavane.test(c))), 'chyby JS v konzoli').toEqual([]));

async function prihlas(page, heslo = HESLO) {
  await page.locator('#f_email').fill(EMAIL);
  await page.locator('#f_heslo').fill(heslo);
  await page.getByRole('button', { name: 'Přihlásit' }).click();
}

test('přihlášení, založení dat, obnovení stránky a odhlášení', async ({ page }) => {
  const { store, hlavicky } = await mockSupabase(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Kalibrace');
  await expect(page.locator('.banner')).toHaveCount(0); // žádný demo banner

  await prihlas(page, 'spatne');
  await expect(page.locator('#chyba')).toContainText('Špatný e-mail nebo heslo');
  await prihlas(page);
  await expect(page.locator('main .empty')).toContainText('Zatím žádné skupiny');

  // skupina → přístroj → kalibrace
  await page.goto('/#/skupiny/nova');
  await page.locator('#f_nazev').fill('Anemometry');
  await page.locator('#f_typ').selectOption('anemometr');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('a.row')).toContainText('Anemometry');

  await page.goto('/#/novy');
  await page.locator('#f_foto').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#f_model').fill('Testo 417');
  await page.locator('#f_vyrobni_cislo').fill('41700101');
  await page.locator('#f_technik').fill('Petr');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveText('BEZ KALIBRACE');
  await expect(page.locator('.hero .thumb img')).toBeVisible();
  await page.getByRole('link', { name: 'Přidat kalibraci' }).click();
  await page.locator('#f_soubor').setInputFiles({ name: 'protokol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('#f_cislo_protokolu').fill('TIS-1');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveClass(/platna/);

  expect(store.skupiny).toHaveLength(1);
  expect(store.pristroje[0]).toMatchObject({ owner: UID, vyrobni_cislo: '41700101', stav: 'aktivni', skupina_id: store.skupiny[0].id });
  expect(store.kalibrace[0]).toMatchObject({ pristroj_id: store.pristroje[0].id, cislo_protokolu: 'TIS-1' });
  expect(new Set(hlavicky)).toEqual(new Set(['kalibrace'])); // všechny dotazy jdou do schématu kalibrace

  // soubory: buckety kalibrace-*, vlastní složka, cesta uložená v řádku
  const soubory = Object.keys(store.soubory);
  const foto = soubory.find((x) => x.startsWith('kalibrace-fotky/')), protokol = soubory.find((x) => x.startsWith('kalibrace-protokoly/'));
  expect(foto).toMatch(new RegExp('^kalibrace-fotky/' + UID + '/[0-9a-f-]{36}[.]jpg$')); // zmenšeno na JPEG
  expect(protokol).toMatch(new RegExp('^kalibrace-protokoly/' + UID + '/[0-9a-f-]{36}[.]pdf$'));
  expect(store.pristroje[0].foto_path).toBe(foto.replace('kalibrace-fotky/', ''));
  expect(store.kalibrace[0].protokol_path).toBe(protokol.replace('kalibrace-protokoly/', ''));

  // Otevřít = nové okno s podepsanou URL
  const [okno] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Otevřít' }).click()]);
  await okno.waitForURL(/\/storage\/v1\/object\/sign\/kalibrace-protokoly\//);
  await okno.close();

  // obnovení s ?debug=1: relace zůstane, data se načtou ze Supabase, log má statusy bez tokenů
  await page.goto('/?debug=1');
  await expect(page.locator('#debug')).toContainText('supabase select kalibrace 200');
  await expect(page.locator('#debug')).toContainText('načteno 1 skupin, 1 přístrojů, 1 kalibrací');
  await expect(page.locator('#debug')).not.toContainText('eyJ');
  await expect(page.locator('#debug')).not.toHaveClass(/chyba/);
  await expect(page.locator('a.row[data-pristroj="41700101"] .tag')).toHaveClass(/platna/);
  await expect(page.locator('#souhrn .n')).toHaveText(['1', '0', '0']);
  await expect(page.locator('a.row[data-pristroj="41700101"] .thumb img')).toHaveAttribute('src', /\/object\/sign\/kalibrace-fotky\//);

  // nastavení se uloží (upsert) a ukazuje účet
  await page.goto('/#/nastaveni');
  await expect(page.locator('#ucet')).toHaveText(EMAIL);
  await page.locator('#f_predstih_dni_vychozi').fill('45');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('#souhrn')).toBeVisible();
  expect(store.nastaveni).toEqual([expect.objectContaining({ owner: UID, predstih_dni_vychozi: 45 })]);

  // vyřazení a smazání
  await page.locator('a.row[data-pristroj="41700101"]').click();
  await page.getByRole('button', { name: 'Vyřadit' }).click();
  await page.locator('.btn.confirm').click();
  await expect(page.locator('.hero .tag')).toHaveText('VYŘAZENO');
  expect(store.pristroje[0].stav).toBe('vyrazeno');
  await page.getByRole('button', { name: 'Smazat' }).click();
  await page.locator('.btn.confirm').click();
  await expect(page.locator('#souhrn')).toBeVisible();
  expect(store.pristroje).toHaveLength(0);
  expect(store.kalibrace).toHaveLength(0);
  await expect.poll(() => Object.keys(store.soubory)).toEqual([]); // fotka i protokol smazané

  // odhlášení
  await page.goto('/#/nastaveni');
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('účet bez kalibrace v profily.aplikace vidí jen hlášku', async ({ page }) => {
  await mockSupabase(page, { pristup: false });
  await page.goto('/');
  await prihlas(page);
  await expect(page.locator('.err')).toContainText('nemá přístup k appce Kalibrace');
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
});

test('přihlašovací obrazovka nepřetéká', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await expect(page.locator('#f_email')).toBeVisible();
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw);
  await expect(page.locator('footer')).toHaveText(/^verze \d+$/);
});

// Úložiště přihlášení
const SKUPINA = { id: '22222222-2222-4222-8222-222222222222', owner: UID, nazev: 'Anemometry', typ: 'anemometr', min_platnych: 1, poradi: 1 };
const BLOKACE = {
  'zápis nic neuloží': () => { Storage.prototype.setItem = function () {}; },
  'zápis vyhodí výjimku': () => { Storage.prototype.setItem = function () { throw new DOMException('blokováno', 'SecurityError'); }; },
  'localStorage je nedostupné': () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blokováno', 'SecurityError'); } }); }
};
for (const [popis, blokuj] of Object.entries(BLOKACE)) {
  test('blokované úložiště (' + popis + '): po přihlášení se data načtou', async ({ page }) => {
    const { store } = await mockSupabase(page);
    store.skupiny.push({ ...SKUPINA });
    await page.addInitScript(blokuj);
    await page.goto('/');
    await prihlas(page);
    await expect(page.locator('main')).toContainText('Anemometry');
    await expect(page.locator('#souhrn')).toBeVisible();
    expect(await page.evaluate(() => { try { return localStorage.getItem('kalibrace-auth'); } catch { return null; } })).toBeNull(); // blokování opravdu platilo
    // přihlášení jen v paměti: po obnovení stránky se přihlašuje znovu
    await page.reload();
    await expect(page.locator('#f_email')).toBeVisible();
  });
}

test('blokovaný jen synchronní zápis ze skriptu z CDN: přihlášení přežije obnovení', async ({ page }) => {
  const { store } = await mockSupabase(page);
  store.skupiny.push({ ...SKUPINA });
  await page.addInitScript(() => {
    const puvodni = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      if (new Error().stack.includes('cdn.jsdelivr.net')) return;
      return puvodni.apply(this, arguments);
    };
  });
  await page.goto('/');
  await prihlas(page);
  await expect(page.locator('main')).toContainText('Anemometry');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kalibrace-auth'))).toContain('access_token');
  await page.reload();
  await expect(page.locator('main')).toContainText('Anemometry');
});

test('odhlášení platí i při blokovaném mazání z localStorage', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');
  await prihlas(page);
  await expect(page.locator('main .empty')).toContainText('Zatím žádné skupiny');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kalibrace-auth'))).toContain('access_token');
  await page.evaluate(() => { Storage.prototype.removeItem = function () {}; });
  await page.evaluate(() => { location.hash = '#/nastaveni'; });
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
  expect(await page.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
});

// Odhlášení a ověření sezení při startu
// zpusob: 'tise' = volání nic neudělá, 'vyjimka' = vyhodí chybu. Platí hned i po každém obnovení stránky.
async function blokujUloziste(page, metody, zpusob = 'tise') {
  const blokuj = ({ metody, zpusob }) => metody.forEach((m) => {
    const puvodni = Storage.prototype[m];
    Storage.prototype[m] = function () {
      if (this !== window.localStorage) return puvodni.apply(this, arguments);
      if (zpusob === 'vyjimka') throw new DOMException('blokováno', 'SecurityError');
    };
  });
  await page.addInitScript(blokuj, { metody, zpusob });
  await page.evaluate(blokuj, { metody, zpusob });
}
const ulozenaSession = (page) => page.evaluate(() => localStorage.getItem('kalibrace-auth'));
async function prihlaseny(page) {
  const mock = await mockSupabase(page);
  mock.store.skupiny.push({ ...SKUPINA });
  await page.goto('/');
  await prihlas(page);
  await expect(page.locator('main')).toContainText('Anemometry');
  await expect.poll(() => ulozenaSession(page)).toContain('access_token'); // odložený zápis proběhl
  return mock;
}
async function odhlas(page) {
  await page.evaluate(() => { location.hash = '#/nastaveni'; });
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  await expect(page.locator('#f_email')).toBeVisible();
}

test('mock: anon dostane 401 / 42501 se zněním jako produkce', async ({ page }) => {
  ocekavane = /Failed to load resource.*401/;
  await mockSupabase(page);
  await page.goto('/');
  await expect(page.locator('#f_email')).toBeVisible();
  const r = await page.evaluate(async () => [await db.rpc('smi'), await db.from('skupiny').select('*')].map((x) => [x.status, x.error.code, x.error.message, x.error.hint]));
  expect(r).toEqual([
    [401, '42501', 'permission denied for function smi', null],
    [401, '42501', 'permission denied for table skupiny', 'Grant the required privileges to the current role with: GRANT SELECT ON kalibrace.skupiny TO anon;']
  ]);
});

for (const zpusob of ['tise', 'vyjimka']) {
  for (const metody of [['removeItem'], ['removeItem', 'setItem']]) {
    test(`blokované mazání (${metody.join(' + ')}, ${zpusob}): po odhlášení a obnovení je odhlášený`, async ({ page }) => {
      ocekavane = /Failed to load resource.*403/; // server odmítne zrušené sezení
      await prihlaseny(page);
      await blokujUloziste(page, metody, zpusob);
      await odhlas(page);
      await page.reload();
      await expect(page.locator('#f_email')).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Anemometry');
    });
  }
}

test('blokované mazání i zápis: po odhlášení se jde znovu přihlásit', async ({ page }) => {
  await prihlaseny(page);
  await blokujUloziste(page, ['removeItem', 'setItem']);
  await odhlas(page);
  await prihlas(page);
  await expect(page.locator('main')).toContainText('Anemometry');
});

for (const zpusob of ['tise', 'vyjimka']) {
  test(`blokované mazání (${zpusob}) a výpadek serveru při odhlášení: po obnovení je odhlášený`, async ({ page }) => {
    ocekavane = /Failed to load resource.*500|výpadek/;
    const { auth } = await prihlaseny(page);
    auth.selhani.logout = 500;
    await blokujUloziste(page, ['removeItem'], zpusob);
    await odhlas(page);
    await page.reload();
    await expect(page.locator('#f_email')).toBeVisible();
    expect(await ulozenaSession(page)).toBe(''); // přepsáno prázdnou hodnotou
  });
}

for (const porucha of [500, 503, 429, 'sit']) {
  test(`výpadek ověření při startu (${porucha}) nikoho neodhlásí`, async ({ page }) => {
    ocekavane = /Failed to load resource/;
    const { auth } = await prihlaseny(page);
    auth.selhani.user = porucha;
    await page.reload();
    await expect(page.locator('main')).toContainText('Anemometry');
    expect(await ulozenaSession(page)).toContain('access_token');
    expect(auth.odhlaseni).toEqual([]);
  });
}

test('výpadek při startu s vypršeným tokenem: nabídne opakování a přihlášení zůstane', async ({ page }) => {
  test.setTimeout(90000); // supabase-js obnovu tokenu opakuje až 30 s
  ocekavane = /Failed to load resource|Server přihlášení není dostupný/;
  const { auth } = await prihlaseny(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kalibrace-auth'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('kalibrace-auth', JSON.stringify(s));
  });
  auth.selhani.token = 503;
  await page.reload();
  await expect(page.locator('main')).not.toContainText('Načítám', { timeout: 60000 });
  await expect(page.locator('.err')).toContainText('Server přihlášení není dostupný');
  await expect(page.locator('#f_email')).toHaveCount(0);
  expect(await ulozenaSession(page)).toContain('access_token');
  delete auth.selhani.token;
  await page.getByRole('button', { name: 'Zkusit znovu' }).click();
  await expect(page.locator('main')).toContainText('Anemometry');
});

test('sezení zrušené na serveru se při startu zahodí', async ({ page }) => {
  ocekavane = /Failed to load resource.*403/;
  const { auth } = await prihlaseny(page);
  auth.sezeni.clear(); // odhlášení z jiného zařízení
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
  await expect.poll(() => ulozenaSession(page)).toBeNull();
});

for (const kod of ['bad_jwt', 'user_not_found', 'user_banned']) {
  test(`neplatná session (${kod}) se při startu zahodí jen v tomto zařízení`, async ({ page }) => {
    ocekavane = /Failed to load resource.*403/;
    const { auth } = await prihlaseny(page);
    auth.neplatna = kod;
    await page.reload();
    await expect(page.locator('#f_email')).toBeVisible();
    await expect.poll(() => ulozenaSession(page)).toBeNull();
    expect(auth.odhlaseni).toEqual(['local']);
  });
}

test('neuložená session: srozumitelná hláška, log a žádný dotaz jako anon', async ({ page }) => {
  const { hlavicky } = await mockSupabase(page);
  await page.goto('/?debug=1');
  await expect(page.locator('#f_email')).toBeVisible();
  await page.evaluate(() => { sb.auth.getSession = async () => ({ data: { session: null }, error: null }); });
  await page.locator('#f_email').fill(EMAIL);
  await page.locator('#f_heslo').fill(HESLO);
  await page.locator('#f_heslo').press('Enter'); // debug panel překrývá tlačítko
  await expect(page.locator('#chyba')).toContainText('Prohlížeč neuložil přihlášení');
  await expect(page.locator('#chyba')).not.toContainText('permission denied');
  await expect(page.locator('#debug')).toContainText('session se neuložila');
  await expect(page.getByRole('button', { name: 'Přihlásit' })).toBeEnabled();
  expect(hlavicky).toEqual([]);
  expect(chyby).toEqual(['[kal] session se neuložila']); // jediná chyba v konzoli je očekávaný záznam
  chyby.length = 0;
});

// Odhlášení jen tohoto zařízení a vždy úspěšné
const OFFLINE = 'odhlášení offline – session smazána jen lokálně';
async function vyprsTokenu(page) { // v paměti i v localStorage, stránka zůstává otevřená
  await page.evaluate(() => {
    const s = JSON.parse(authStorage.getItem('kalibrace-auth'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    authStorage.setItem('kalibrace-auth', JSON.stringify(s));
  });
  await expect.poll(async () => JSON.parse(await ulozenaSession(page)).expires_at).toBeLessThan(Date.now() / 1000);
}
const vypni = (auth, porucha) => ['token', 'logout', 'user'].forEach((x) => { auth.selhani[x] = porucha; });
function zadrz() { let pust; const ceka = new Promise((res) => { pust = res; }); return { ceka, pust }; }
async function odhlasBezServeru(page) {
  const zaznamy = [];
  page.on('console', (m) => zaznamy.push(m.text()));
  await page.evaluate(() => { location.hash = '#/nastaveni'; });
  await page.getByRole('button', { name: 'Odhlásit' }).click();
  // 40 s = déle než opakování v supabase-js (30 s): selhání testu znamená, že neodhlásí vůbec
  await expect(page.locator('#f_email')).toBeVisible({ timeout: 40000 });
  await expect.poll(() => zaznamy.filter((t) => t.includes(OFFLINE)).length).toBe(1);
}
async function zustavaOdhlaseny(page, auth) {
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
  auth.selhani = {}; // server zase běží a sezení na něm pořád platí
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Anemometry');
}

test('(a) odhlášení na jednom zařízení neodhlásí druhé', async ({ page, browser }) => {
  const server = await prihlaseny(page);
  const ctx2 = await browser.newContext();
  const druhe = await ctx2.newPage();
  await mockSupabase(druhe, { server });
  await druhe.goto('/');
  await prihlas(druhe);
  await expect(druhe.locator('main')).toContainText('Anemometry');
  await expect.poll(() => ulozenaSession(druhe)).toContain('access_token');

  await odhlas(page);
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();

  await druhe.reload();
  await expect(druhe.locator('main')).toContainText('Anemometry');
  // projde i obnova tokenu, ne jen dosud platný JWT
  expect(await druhe.evaluate(async () => (await sb.auth.refreshSession()).error)).toBeNull();
  expect(server.auth.odhlaseni).toEqual(['local']);
  await ctx2.close();
});

for (const porucha of [503, 'sit', 429, 'bez odpovědi']) {
  test(`(b) vypršený token a nedostupný server (${porucha}): odhlásí a po F5 zůstane`, async ({ page }) => {
    test.setTimeout(80000);
    ocekavane = /Failed to load resource|výpadek|Failed to fetch/;
    const { auth } = await prihlaseny(page);
    await vyprsTokenu(page);
    const z = zadrz();
    vypni(auth, porucha === 'bez odpovědi' ? z.ceka : porucha);
    await odhlasBezServeru(page);
    await expect.poll(() => ulozenaSession(page)).toBeNull();
    await zustavaOdhlaseny(page, auth);
    z.pust();
  });
}

for (const zpusob of ['tise', 'vyjimka']) {
  for (const porucha of [503, 'sit']) {
    test(`(c) vypršený token, nedostupný server (${porucha}) a blokované mazání (${zpusob}): po F5 odhlášený`, async ({ page }) => {
      test.setTimeout(80000);
      ocekavane = /Failed to load resource|výpadek|Failed to fetch/;
      const { auth } = await prihlaseny(page);
      await vyprsTokenu(page);
      vypni(auth, porucha);
      await blokujUloziste(page, ['removeItem'], zpusob);
      await odhlasBezServeru(page);
      await expect.poll(() => ulozenaSession(page)).toBe(''); // přepsáno prázdnou hodnotou
      await zustavaOdhlaseny(page, auth);
    });
  }
}

for (const porucha of [500, 'sit', 'bez odpovědi']) {
  test(`platný token a nedostupný server (${porucha}): odhlásí a zapíše to do logu`, async ({ page }) => {
    test.setTimeout(80000);
    ocekavane = /Failed to load resource/;
    const { auth } = await prihlaseny(page);
    const z = zadrz();
    vypni(auth, porucha === 'bez odpovědi' ? z.ceka : porucha);
    await odhlasBezServeru(page);
    await zustavaOdhlaseny(page, auth);
    z.pust();
  });
}

test('odhlášení offline je vidět v debug panelu', async ({ page }) => {
  ocekavane = /Failed to load resource/;
  const { auth } = await prihlaseny(page);
  await page.goto('/?debug=1#/nastaveni');
  await expect(page.locator('#ucet')).toHaveText(EMAIL);
  auth.selhani.logout = 'sit';
  await page.getByRole('button', { name: 'Odhlásit' }).dispatchEvent('click'); // debug panel překrývá tlačítko
  await expect(page.locator('#f_email')).toBeVisible();
  await expect(page.locator('#debug')).toContainText(OFFLINE);
});

test('obnova tokenu doběhne až po odhlášení: session se nevrátí', async ({ page }) => {
  test.setTimeout(80000);
  const { auth } = await prihlaseny(page);
  await vyprsTokenu(page);
  const z = zadrz();
  auth.selhani.token = z.ceka;
  await odhlasBezServeru(page);
  const odpoved = page.waitForResponse(/\/auth\/v1\/token/);
  z.pust();
  await odpoved;
  expect(await page.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
  delete auth.selhani.token;
  await page.reload();
  await expect(page.locator('#f_email')).toBeVisible();
});

for (const sluzba of ['token', 'logout']) {
  test(`nové přihlášení počká na nedokončené odhlášení (${sluzba}) a to ho nesmaže`, async ({ page }) => {
    test.setTimeout(80000);
    const { auth } = await prihlaseny(page);
    if (sluzba === 'token') await vyprsTokenu(page);
    const z = zadrz();
    auth.selhani[sluzba] = z.ceka;
    await odhlasBezServeru(page);
    delete auth.selhani[sluzba]; // další požadavky už server vyřídí hned
    await prihlas(page);
    await page.waitForTimeout(500); // čas, ve kterém by nové přihlášení předběhlo staré odhlášení
    z.pust();
    await expect(page.locator('main')).toContainText('Anemometry');
    await page.waitForTimeout(300); // doběhne staré odhlášení i odložený zápis
    await page.reload();
    await expect(page.locator('main')).toContainText('Anemometry');
  });
}

for (const [popis, blokace] of [['', null], [' a blokovaném mazání', ['removeItem']]]) {
  test(`(b) druhá záložka po odhlášení offline${popis} session nevrátí`, async ({ page, context }) => {
    test.setTimeout(80000);
    ocekavane = /Failed to load resource/;
    const { auth } = await prihlaseny(page);
    const zalozka = await context.newPage();
    await zalozka.goto('/');
    await expect(zalozka.locator('main')).toContainText('Anemometry');
    await vyprsTokenu(zalozka); // má session i ve své paměti, jako po obnově tokenu
    await vyprsTokenu(page);
    vypni(auth, 'sit');
    if (blokace) await blokujUloziste(page, blokace);
    await odhlasBezServeru(page);
    await expect(zalozka.locator('#f_email')).toBeVisible();
    auth.selhani = {};
    expect(await zalozka.evaluate(async () => (await sb.auth.getSession()).data.session)).toBeNull();
    await page.reload();
    await expect(page.locator('#f_email')).toBeVisible();
  });
}
