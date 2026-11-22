// Ostrý režim (bez ?demo) proti mocku Supabase: přihlášení, CRUD, schéma kalibrace, odhlášení.
import { test, expect } from '@playwright/test';
import { mockSupabase, EMAIL, HESLO, UID, PNG } from './supabase-mock.mjs';

let chyby;
test.beforeEach(async ({ page }) => {
  chyby = [];
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') chyby.push(m.text()); });
});
// 400 ze špatného hesla prohlížeč hlásí jako „Failed to load resource“ – to je očekávané
test.afterEach(() => expect(chyby.filter((c) => !/Failed to load resource.*400/.test(c)), 'chyby JS v konzoli').toEqual([]));

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
