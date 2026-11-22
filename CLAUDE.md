# CLAUDE.md – Evidence kalibrací měřicích přístrojů

## Rozhodnutí z úvodních otázek (2026-11-14)

- Reálné přístroje (výrobní čísla, technici, detektory, manometry) zadá správce až v appce. Prototyp běží na ukázkových datech (`?demo=1`).
- ~~Supabase: nový projekt~~ → **změna 2026-11-14:** sdílený existující projekt **„servisní záznamy“** (ref `pqehuuamgecmdmrdhmza`, sdílí ho další appky – viz interní podklady). Nový projekt nezakládat (free limit 2 projekty).
  - **Vlastní schéma `kalibrace`** (tabulky `skupiny`, `pristroje`, `kalibrace`, `nastaveni`), ne prefix `kal_`. Granty jen pro `authenticated`, anon žádné tabulky. V appce `supabase.schema('kalibrace')`; schéma musí být v Dashboardu v *Data API → Exposed schemas*.
  - Buckety `kalibrace-protokoly` a `kalibrace-fotky` (soukromé, cesta `<uid>/<soubor>`).
  - RLS: `owner = auth.uid()` **a** `kalibrace.smi()` (aktivní profil s `'kalibrace'` v `profily.aplikace`, stejný vzor jako ostatní appky ve sdíleném projektu). Správci `'kalibrace'` přidává migrace, ostatní hodnoty zůstávají.
  - **Na tabulky, funkce a politiky ostatních appek nesahat.** Podklad: skutečný výstup `sql/000_pruzkum.sql` (2026-11-14). `profily.token_hash` patří jiné appce, kalibrace ho nepoužívá.
  - Upozorňovací skript **nepoužívá service_role**: volá `kalibrace.upozorneni_data(token)` (security definer, jen pro `anon`) s publishable klíčem a tokenem; v DB je jen SHA-256 tokenu v `kalibrace.nastaveni.token_hash`. Příjemce e-mailu se bere z `nastaveni.email_upozorneni`.
- Výchozí hodnoty: interval kalibrace **12 měsíců**, doba v laboratoři **14 dní**, předstih **30 dní**.
- Repo `vm73-prace/kalibrace` (GitHub Pages), upozornění odesílá pracovní schránka přes SMTP (`KALIBRACE_SMTP_*` v GitHub Secrets), příjemce jen v tabulce `nastaveni` (ne v repu); změna 2026-11-14, původně Gmail.

## Stav projektu (2026-11-22)

- **Kde navázat:** nasazená verze 10, čeká na ověření správcem (viz „Neověřeno“ u v10). Při nejbližší úpravě appky přidat Odhlásit na obrazovku výpadku (viz „Další krok“).
- **Verze 10 (2026-11-22), odhlášení jen tohoto zařízení, nasazeno (commit 510697f):**
  1. Odhlásit volá `signOut({ scope: 'local' })`, ostatní zařízení zůstanou přihlášená.
  2. Když `signOut` vrátí chybu nebo do **5 s** neskončí, appka smaže session sama (`authStorage.removeItem`), ukáže přihlášení a zaloguje „odhlášení offline – session smazána jen lokálně“. Limit je nutný: supabase-js při výpadku obnovu tokenu opakuje až 30 s a bez odpovědi serveru čeká bez konce.
  3. Nové přihlášení čeká na nedokončený `signOut` (`odhlasovani`), jinak by mu opožděný `signOut` session smazal. Neodebírat.
  4. Událost `storage`: smazání nebo vyprázdnění `kalibrace-auth` odhlásí i ostatní otevřené záložky. Bez toho druhá záložka po obnově tokenu zapsala session zpět.
  - Ověření při startu přes `getUser()` beze změny.
  - **Zbývající meze odhlášení (všechny ověřené proti mocku):**
    - blokované mazání i zápis **a zároveň** nedostupný server → po F5 zase přihlášený (odhlášení není kam zapsat, ani předat jiné záložce),
    - F5 nebo zavření appky během „Odhlašuji…“ (nejvýš 5 s) → zůstane přihlášený,
    - výpadek už při načtení appky → jen hláška a „Zkusit znovu“, tlačítko Odhlásit tam není (odloženo, viz Další krok),
    - po odhlášení úplně bez internetu a F5 → hláška o nenačtené knihovně (CDN) místo formuláře; session je smazaná, po připojení se ukáže přihlášení.
  - **Důsledky:** odhlášení offline nechá sezení na serveru platné (v zařízení už není). Odhlásit už neslouží k odhlášení ztraceného zařízení, to jde jen na straně Supabase. Odhlášení s výchozím rozsahem v jiné appce se stejným účtem dál ruší i sezení kalibrace.
  - Testy: Node 48/48, Python 21/21, Playwright 280/280 (18 nových v 5 profilech). Proti v9 selhalo všech 11 testů (a), (b), (c) v profilu iPhone 13 a všech 16 nových testů první sady v profilu w390; 2 testy záložek přibyly potom a selhaly i proti opravě bez události `storage`.
  - Ověřeno na Pages: `var VERZE = 10`, cache `kalibrace-v10`, soubory shodné s commitem, bez chyb JS (Chrome a emulace iPhone 13, bez přihlášení).
  - **Neověřeno:** skutečný účet a Supabase (dělá správce: přihlásit PC i iPhone → na PC Odhlásit → iPhone po znovuotevření zůstává přihlášený, PC po F5 ne), skutečný Avast AntiTrack, WebKit na iPhonu.
- **Verze 9 (2026-11-22), oprava odhlášení, nasazeno (commit 8d7716a):** ve v8 se po odhlášení a F5 vracela stará session, když bylo blokované mazání z localStorage (`null` žil jen v paměti). Oprava má tři vrstvy, žádnou neodebírat:
  1. `removeItem`: v paměti `null` (platí do obnovení stránky),
  2. co nejde z localStorage smazat, přepíše se prázdnou hodnotou; `getItem` ji bere jako žádnou session (pokryje i výpadek serveru při odhlášení),
  3. `start()` ověří nalezenou session přes `getUser()`: `session_not_found` zahodí supabase-js, `bad_jwt` / `user_not_found` / `user_banned` appka (`signOut` se `scope: 'local'`). Jiná chyba (síť, 5xx, 429) při tomto ověření session nechá; vypršený token a výpadek = hláška se „Zkusit znovu“ (až po 30 s opakování v supabase-js), ne přihlašovací formulář.
  - Meze odhlášení z v9: aktuální seznam je u verze 10 (vypršený token a odhlašování všech zařízení jsou opravené).
  - Testy: Node 48/48, Python 21/21, Playwright 190/190. Nové testy proti v8: všech 6 testů mazání + F5 selhalo (v 5 profilech), proti v9 prošly. Mock: anon 401 / 42501 se zněním a `hint` podle produkce, odhlášení ruší sezení (`/user` pak 403 `session_not_found`, REST JWT dál bere).
  - Ověřeno na Pages: `VERZE = 9`, cache `kalibrace-v9`, soubory shodné s commitem, bez chyb JS (Chrome a emulace iPhone 13, bez přihlášení); odhlášení + F5 na nasazeném kódu proti mocku Supabase.
  - **Neověřeno:** odhlášení skutečným účtem se skutečným Avast AntiTrack a na iPhonu (dělá správce: přihlásit → Odhlásit → F5 → musí být přihlašovací obrazovka).
- **Verze 8 (2026-11-22), oprava přihlášení, nasazeno (commit 29a12eb):** v Chrome s Avast AntiTrack se neukládala session a dotazy šly jako anon (401 / 42501). Nově vlastní auth storage a `storageKey: 'kalibrace-auth'` (pravidlo viz Konvence), po přihlášení kontrola `getSession()` (log „session se neuložila“ + česká hláška). DB, granty a RLS beze změny. Všichni se jednou znovu přihlásí.
  - Testy: Node 48/48, Python 21/21, Playwright 105/105. Mock Supabase vrací bez JWT 401 / 42501 jako produkce; nové testy na blokovaný zápis i mazání v localStorage a na neuloženou session.
  - Ověřeno na Pages: `VERZE = 8`, cache `kalibrace-v8`, storageKey, bez chyb JS (Chrome a emulace iPhone 13, bez přihlášení).
  - **Neověřeno:** přihlášení skutečným účtem v Chrome se skutečným Avast AntiTrack a na iPhonu po změně klíče (dělá správce); souběh více záložek (každá má vlastní kopii session v paměti).
  - **Zbývá:** nahrát upravený skill `vyvoj-appky-zaklad` s tímto pravidlem (v nainstalovaném skillu zatím není); v ostatních appkách se stejným vzorem opravit `removeItem` (`null` místo `delete`).
- **2026-11-18 zadány 4 historické kalibrace ze skenů** (Testo 425, Testo 417, sonda Testo 0635 1570, ProHood PH731), všechny propadlé; +3 skupiny (Anemometr termický, Sonda Testo 0635 1570, Balometr), +4 přístroje, +4 kalibrace (SQL přes konektor, technik prázdný). PDF nahraje správce v appce (Upravit kalibraci). Poznámka: `cislo_protokolu` je NOT NULL, prázdné = `''`.
- **Převod na pracovní účet správce – uzavřen (2026-11-19):** data kalibrace (4 tabulky) i soubory (oba buckety) převedena z osobního účtu na pracovní účet správce, bez service_role; ověřeno v appce pracovním účtem (fotka i protokol se otevřou) a ručním během `kontrola.yml` s `dry_run` (Supabase 200). Osobní účet už `'kalibrace'` v `profily.aplikace` nemá a jeho složky v bucketech jsou smazané, takže rollback převodu už nejde. Podrobnosti (UUID, e-maily, SQL, skript) jen v `kalibrace-interni`. Obecný postup: README, sekce „Jak přidat / vyměnit správce“. Appka ani skript upozornění se neměnily.
- 2026-11-19: PDF protokolů nahrána u všech 4 historických kalibrací, ověřeno v DB (protokol_path + objekt v bucketu kalibrace-protokoly). Zbývá: iPhone znovu přidat na plochu z https://vm73-prace.github.io/kalibrace/ a odeslat propadlé přístroje na kalibraci.

- **Čištění repa a přesun do `vm73-prace` hotové (2026-11-18, domácí PC, kroky 1–4):**
  - **Krok 3 hotový:** repo převedené do organizace → **`vm73-prace/kalibrace`** (veřejné), Pages **https://vm73-prace.github.io/kalibrace/** (stará adresa `vm73.github.io/kalibrace` vrací 404), všech 7 secrets `KALIBRACE_*` se přeneslo, workflows `kontrola.yml` a `keepalive.yml` aktivní, ruční běh `kontrola.yml` s `dry_run` zelený. Odkazy v README, CLAUDE.md, `scripts/kontrola.py` (odkaz do appky v e-mailu) a `sql/001_init.sql` (komentář schématu; v DB zůstává starý komentář, migrace se znovu nespouštěla) přepsané; `ZADANI.md` záměrně beze změny. **Verze 7**, cache `kalibrace-v7`. Testy 48/21/75 OK.
  - **iPhone: appku je potřeba znovu přidat na plochu** z nové adresy (starou ikonu smazat, stará adresa už nefunguje).
  - **Supabase Redirect URLs:** prázdné, kalibrace je nepotřebuje (přihlášení heslem); přidat `https://vm73-prace.github.io/kalibrace/**` až při zavedení obnovy hesla e-mailem. V Supabase se při přesunu nic neměnilo.
  - **Pracovní PC:** `git remote set-url origin https://github.com/vm73-prace/kalibrace.git`, `git fetch`, `git reset --hard origin/main` (historie byla přepsaná, starý `main` nejde sloučit). Od 2026-11-19 je na pracovním PC čerstvý klon obou rep (`C:\Projekty\kalibrace`, `C:\Projekty\kalibrace-interni`). Interní podklady: `git clone https://github.com/vm73-prace/kalibrace-interni.git C:\Projekty\kalibrace-interni`.
  - **Pravidlo: interní údaje (SMTP host, UUID správce, názvy ostatních appek ve sdíleném Supabase, náklady) jen v `kalibrace-interni`**, nikdy ve veřejném repu, commitech ani logech Actions.
  - **Interní údaje jen v privátním repu `vm73-prace/kalibrace-interni`** (lokálně `C:\Projekty\kalibrace-interni`: INTERNI.md, NAKLADY.md, `sql/lokalni/`, `kalibrace-historie.bundle` = plná historie do 18. 11. 2026, 19 commitů + větev `rozpracovano`).
  - **Krok 2 hotový (2026-11-18):** historie zkrácená na 1 kořenový commit (force push `main`), větev `rozpracovano` smazaná (její poznámka převzatá níže), `git log --all -S` pro SMTP host i UUID = 0.
  - Krok 1 (shrnutí): SMTP host a UUID správce jsou pryč ze stromu (`<UUID_SPRAVCE>` v `sql/001_init.sql`, `001_rollback.sql`, `sql/README.md`; test dosazuje fiktivní `11111111-…`). `sql/lokalni/` je v `.gitignore`. Názvy ostatních appek v Supabase jsou nahrazené neutrálním textem (v testu `app1–3`, bucket `app1-fotky`), „Vladan“ → „správce“, technik v demu „Tomáš“. `ZADANI.md` zůstává (u druhé pracovní appky není v interním repu). Testy 48/21/75 OK.
- **Pauza (2026-11-17), kde navázat** (převzato z větve `rozpracovano`): nasazená verze 6, ověřená na iPhonu. Zbývá: (1) správce na iPhonu přidá kalibraci s PDF nebo fotkou protokolu a vyzkouší **Otevřít** a **Sdílet protokol** (kritérium MVP „do 10 s“); (2) **Přidat na plochu** (start bez lišty Safari, ikona visačky); (3) pořadí skupin v sekci Skupiny (prázdné „Detektory úniku chladiva“ jsou nad anemometry – jen data, ne kód); (4) později výměna SMTP za firemní účet (4 secrets, README); (5) v2 podle „Mimo rozsah v1“. Při potížích `?debug=1` a log.

- **Verze 6 (2026-11-16), nasazeno:** (1) název přístroje bez zopakovaného výrobce, když jím model začíná (celé slovo, bez ohledu na velikost písmen: „Testo“ + „Testo 417“ → „Testo 417“; „Testo“ + „417“ beze změny) – `nazevPristroje` v `app.js`, platí i pro název souboru protokolu. (2) Přepínač Vše / Jen problémy: vybraná volba `--seg-on` (světlý #fff, tmavý #636366 jako Servis), dřív v tmavém režimu tmavší než lišta. Testy: Node 48/48, Python 21/21, Playwright 75/75 (nové testy na název a barvu přepínače).
- **Ověřeno na iPhonu (2026-11-16, správce, verze 5 a 6, tmavý režim):** přihlášení skutečným účtem na Pages, data ze Supabase, nahraná fotka přístroje se zobrazuje, štítky, souhrn a pilulky čitelné; v6: název „Testo 417“ bez zopakovaného výrobce, vybraná volba přepínače zřetelná, detail přístroje bez protokolu (bez plného modrého tlačítka, Vyřadit tlumeně červené). Zbývá ověřit protokol Otevřít/Sdílet a Přidat na plochu.
- **Vzhled v5 (2026-11-16), schválená varianta B, nasazeno:** sladěno s appkami Servis a Kancelář. Paleta iOS jako Servis (`--blue #007aff`, `--green #34c759`, `--orange #ff9500`, `--red #ff3b30`, `--indigo #5856d6` + tmavé varianty). Pro malý text a výplně s bílým písmem se ve světlém režimu používají čitelné odstíny (`--*-t`, `--fill-*`: #248a3d, #b25000, #d70015, #0062cc, #6c6c70; kontrast 4,4–5,8:1), v tmavém systémové barvy. Štítky stavu malé, vyplněné, bílé verzálky (PLATNÁ, BRZY, PROPADLÁ, BEZ KALIBRACE, NA KALIBRACI, VYŘAZENO; tlumený kus šedě) a vedle text (`.stav .txt`), umístěné pod výrobním číslem. Souhrn = statistický řádek `#souhrn` (V POŘÁDKU / BRZY / NEDOSTATEK, nula šedě). Plné modré tlačítko „+ Nový přístroj“ (malé „+“ v liště zrušené). Akce jako pilulky: plná modrá jen hlavní akce („Sdílet protokol“, „Vráceno – zadat kalibraci“), ostatní světle modré, Vyřadit světle červené. „Pošli na kalibraci“ oranžově. Ikony v barevných dlaždicích podle typu (`.thumb[data-typ]`: anemometr modrá, balometr indigo, detektor #008299, manometr #8944ab, jiný šedá; zelená, oranžová a červená jen pro stav). Testy: Node 48/48, Python 21/21, Playwright 65/65 (test verze v patičce bez napevno zapsaného čísla).
- **Etapa 7 hotová (2026-11-14), MVP nasazené:** GitHub Pages zapnuté (`main`, kořen, `.nojekyll`, HTTPS) → https://vm73-prace.github.io/kalibrace/. Naostro ověřeno v Chrome s emulací iPhone 13: verze 4, přihlašovací obrazovka, service worker `sw.js`, manifest + ikony 200, demo, bez přetečení, bez chyb JS a HTTP 4xx; CORS ze Supabase z originu Pages funguje (auth settings 200, registrace vypnuté, anon na data 401). `README.md` dokončený (používání, diagnostika, nasazení, upozornění, secrets jen názvy, výměna SMTP = 4 secrets, testy, limity). **Neověřeno:** přihlášení skutečným účtem na Pages a na fyzickém iPhonu (Přidat na plochu, fotka z fotoaparátu, Otevřít/Sdílet protokol) – dělá správce.
- **Etapa 6 hotová v kódu (2026-11-14):** `scripts/kontrola.py` (jen stdlib + `tzdata` z `requirements.txt`) načte data přes `kalibrace.upozorneni_data` (publishable key + `KALIBRACE_NOTIFY_TOKEN`, žádný service_role), počítá stejně jako calc.js, posílá z pracovní schránky přes SMTP (`KALIBRACE_SMTP_*`, port 465 = SSL, jinak STARTTLS), příjemce jen z `nastaveni.email_upozorneni` (prázdný = chyba). `--dry-run` a log v Actions bez výrobních čísel, jmen a e-mailů (repo je veřejné); `--nahled soubor` jen lokálně. Workflow `.github/workflows/kontrola.yml` (cron 5:00 UTC, ruční běh s `dry_run` výchozí true, log jako artefakt při chybě). SMTP pracovní schránky: pracovní SMTP server (viz interní podklady), port 587, STARTTLS + AUTH LOGIN (Exchange). Skript se nikdy nepřihlásí bez úspěšného STARTTLS a ověřuje certifikát i jméno serveru (`ssl.create_default_context`; pozor, `starttls` bez `context` v Pythonu certifikát neověřuje). Testy: Python 19/19 (`tests/test_kontrola.py`: případy z `cases.json` vč. `upozorneni`, celý běh s falešným Supabase a SMTP, bezpečnost SMTP proti lokálnímu serveru s TLS a certifikáty z openssl). Secrets nastavené (SMTP zatím dočasně Gmail, firemní účet (server viz interní podklady) vymění správce po dodání od IT: přepsat **4 secrets** `KALIBRACE_SMTP_HOST`, `KALIBRACE_SMTP_PORT` (465 Gmail SSL → 587 Exchange STARTTLS), `KALIBRACE_SMTP_USER`, `KALIBRACE_SMTP_PASSWORD`; postup v README). Hash tokenu uložený v `kalibrace.nastaveni`. 2026-11-14 naostro ověřeno: běh s `dry_run` (Supabase 200, správně žádný důvod) a s `test_email` (zkušební e-mail odeslán). Ruční běh: vstupy `dry_run` a `test_email` (má přednost).
- **Etapa 5 hotová v kódu (verze 4, 2026-11-14), migrace `kalibrace_002` spuštěná a ověřená:** fotky (zmenšené na 400 px JPEG) a protokoly (PDF/JPG/PNG/HEIC do 10 MB) do bucketů `kalibrace-fotky` / `kalibrace-protokoly`, cesta `<uid>/<uuid>.<přípona>`. Otevřít = podepsaná URL (10 min), Sdílet = soubor stažený dopředu + `navigator.share`, miniatury = dávka podepsaných URL (1 h). Při náhradě nebo smazání se starý soubor maže (chyba jen do logu). Prázdná skupina a volba „každý kus platný“ (`sql/002_vsechny_platne.sql`, spuštěno přes konektor jako `kalibrace_002`). Testy: Node 48/48, Playwright 65/65 (mock Storage v `tests/supabase-mock.mjs`). Naostro na iPhonu zatím neověřeno.
- **Etapa 4 hotová (verze 3, 2026-11-14):** bez `?demo=1` appka běží proti Supabase (supabase-js 2.118.0 z jsDelivr, načítá se jen mimo demo): přihlášení e-mailem a heslem, kontrola `rpc smi`, CRUD skupin, přístrojů, kalibrací a nastavení přes `sb.schema('kalibrace')`, odhlášení. Pole pro fotku a protokol jsou mimo demo skrytá (etapa 5). Exposed schemas obsahuje `kalibrace` (ověřeno přes REST: anon dostane 401). Testy: Node 39/39, Playwright 55/55 (ostrý režim proti mocku `tests/supabase-mock.mjs`). Naostro přihlášení zatím ověřuje správce.
- **Etapa 3 hotová (2026-11-14):** `sql/001_init.sql` spuštěná ve „servisní záznamy“ přes Supabase konektor jako migrace `kalibrace_001_init` a ověřená dotazem (RLS, práva, buckety, politiky ostatních appek beze změny). Rollback: `sql/001_rollback.sql` (ověřený jen lokálně). 
- **Pravidlo pro migrace:** `alter default privileges in schema … revoke execute … from public` v Postgresu nefunguje (výchozí práva po schématech jdou jen přidávat) a globální varianta by změnila celý sdílený projekt. Každá migrace proto končí `revoke execute on all functions in schema kalibrace from public` a kontrolou, že žádná funkce není spustitelná pro PUBLIC. Mazání ze `storage.buckets` / `storage.objects` blokuje trigger `protect_delete` (povolí `set local storage.allow_delete_query = 'true'`).
- **Ikona:** vybraná **B** (visačka zvětšená o 10 %), sada vygenerovaná (`node icons/render.mjs B`).
- **Vzhled:** (barvy a štítky viz v5 výše) schválený s úpravami (2026-11-14): zelená skupina jen šedé „Na řadě: SN … · odeslat do <datum>“ (skryté, když je kus na kalibraci), „Pošli na kalibraci“ jen u oranžové/červené; souhrn po skupinách; skupina o 1 kusu bez hlavičky (výzva u přístroje); lišta na šířku obsahu.
- **Datový model:** oproti návrhu navíc složené cizí klíče `(skupina_id, owner)` a `(pristroj_id, owner)` (data nejdou provázat napříč uživateli); cesta v Storage je `<uid>/<soubor>`.
- **Git:** repo https://github.com/vm73-prace/kalibrace (veřejné), větev `main`. GitHub Pages zapnuté (push do `main` = nasazení).
- **Další krok (s nejbližší úpravou appky, ne samostatně; rozhodnutí správce 2026-11-22):** tlačítko **Odhlásit** na obrazovce výpadku se „Zkusit znovu“ (`catch` ve `start()`). Při tom pozor (zjištěno čtením kódu):
  - když se nenačte knihovna, je `sb` null → session smazat přímo přes `authStorage.removeItem(AUTH_KLIC)`, ne `signOut`,
  - při vypršeném tokenu nebo bez knihovny je tam `uzivatel` null a `odhlasen()` hned skončí → obrazovku po odhlášení překreslit zvlášť; přihlašovací formulář bez `sb` nefunguje,
  - testy: výpadek REST, vypršený token a výpadek, nenačtená knihovna; po obnovení serveru a F5 musí zůstat odhlášený.
- **Další kroky správce:** správce ověří na iPhonu (přidat na plochu, přihlášení, zadat reálné přístroje, fotka, protokol Otevřít/Sdílet) a pošle výsledek; později výměna SMTP za firemní účet (4 secrets, README). Pak v2 podle „Mimo rozsah v1“.
- **Poznámky k testům:** Playwright běží v nainstalovaném Google Chrome (`channel: 'chrome'`), iPhone 13 je emulace viewportu v Chromiu, ne WebKit. Verze `@playwright/test` 1.65.1.
- **Režimy:** `?demo=1` = `apiDemo` (data v paměti), jinak `apiSupabase`; obě mají stejné metody. V e2e testech s `?debug=1` debug panel překrývá spodní tlačítka, proto se tam kliká jen bez debug režimu.

## Konvence pro všechny appky správce (2026-11-14)

Jeden **slug** všude (zde `kalibrace`):

| Co | Tvar | Kalibrace |
| --- | --- | --- |
| GitHub repo | `<slug>` | `vm73-prace/kalibrace` |
| Schéma v DB | `<slug>` (+ `comment on schema`) | `kalibrace` |
| Hodnota v `public.profily.aplikace` | `<slug>` | `'kalibrace'` |
| Storage buckety | `<slug>-<obsah>` | `kalibrace-protokoly`, `kalibrace-fotky` |
| Edge Functions | `<slug>-<účel>` | (zatím žádné) |
| Secrets | `<SLUG>_<SLUŽBA>_<CO>` | `KALIBRACE_SUPABASE_URL`, `KALIBRACE_SUPABASE_PUBLISHABLE_KEY`, `KALIBRACE_NOTIFY_TOKEN`, `KALIBRACE_SMTP_HOST`, `KALIBRACE_SMTP_PORT`, `KALIBRACE_SMTP_USER`, `KALIBRACE_SMTP_PASSWORD` |

**Přihlášení Supabase – pravidlo pro všechny appky (2026-11-22):** `createClient` vždy s vlastním auth storage (kopie v paměti + zápis do localStorage odložený přes `setTimeout`, čtení nejdřív z paměti, vše v try/catch) a vlastním `storageKey: '<slug>-auth'`, `persistSession: true`, `autoRefreshToken: true`. Důvody: appky sdílejí origin `vm73-prace.github.io` (s výchozím klíčem by si session přepisovaly) a Avast AntiTrack blokuje synchronní zápis ze skriptu z CDN. `removeItem` zapíše do paměti `null`, ne `delete`, a co z localStorage nejde smazat, přepíše prázdnou hodnotou; `getItem` ji bere jako žádnou session (jinak se po odhlášení nebo F5 vrátí stará session z localStorage). Odhlásit = `signOut({ scope: 'local' })`; při chybě nebo po 5 s smazat session lokálně, nové přihlášení nechat počkat na nedokončený `signOut` a událostí `storage` odhlásit ostatní záložky. Při startu ověřit uloženou session přes `getUser()`: odmítnutou zahodit, při výpadku sítě nebo serveru nechat. Po přihlášení ověřit `getSession()` ještě před prvním dotazem. Vzor: `authPamet` / `authStorage` / `odhlasit` v `app.js`.

## Struktura projektu

- `README.md`: přehled a e-mailová upozornění (plný návod v etapě 7)
- `index.html`, `app.css`, `app.js`: appka (vanilla, bez build kroku)
- `calc.js`: čisté výpočty mezi `// <calc>` … `// </calc>` (prohlížeč i Node)
- `demo.js`: ukázková data pro `?demo=1`
- `manifest.json`, `sw.js`, `icon-*.png`: PWA
- `ZADANI.md`: původní zadání (s vyznačenými změnami)
- `sql/`: `000_pruzkum.sql` (jen čtení, průzkum sdíleného projektu), `001_init.sql` + `002_vsechny_platne.sql` (migrace), `001_rollback.sql` + `002_rollback.sql` (návrat), `README.md` (návod k Supabase)
- `scripts/kontrola.py` + `requirements.txt` (tzdata), `.github/workflows/kontrola.yml`: e-mailová upozornění
- `tests/`: `cases.json` (společné případy pro Node i Python), `calc.test.mjs` (Node), `sql.test.mjs` (migrace na PGlite), `e2e.spec.mjs` (Playwright, demo), `supabase.spec.mjs` + `supabase-mock.mjs` (Playwright, ostrý režim proti mocku), `test_kontrola.py` (Python, skript upozornění)
- `icons/`: zdrojová SVG ikon a skript, který z nich generuje PNG
- Testy: `npm test` (Node + Python + Playwright); Python potřebuje `pip install -r requirements.txt`

## Role a pravidla práce

Jsi zkušený vývojář mobilních webových appek. Stavíš appku pro správce, servisního technika a vedoucího HVAC servisu (Windows, PowerShell, GitHub účet `VM73`, appky hostuje na GitHub Pages).

Pravidla:

1. **Nejdřív otázky, pak kód.** Před začátkem polož jedno kolo otázek (max 4, u každé doporučená volba první) jen na to, co v tomto zadání chybí (viz „Otázky na začátek“). U drobných oprav se neptej, napiš předpoklady.
2. **Každou práci začni blokem „Zadání:“** (2–4 řádky včetně kritéria hotovo).
3. **Jednoduchost:** nejmenší řešení, které splní zadání. Žádné funkce do zásoby, žádné frameworky navíc.
4. **Chirurgické změny:** měň jen to, co úkol vyžaduje. Velké soubory edituj cílenými záměnami, ne přepisem.
5. **Diagnostika od první verze** (debug režim, logy, verze), viz níže.
6. **Ověřitelný cíl:** před prací stanov, jak se pozná hotovo, a iteruj, dokud to neplatí. Po každé změně spusť celou sadu testů.
7. **Dopad na kredity a limity:** u každé úpravy zvaž a v souhrnu oznam dopad na Claude (tokeny), GitHub (Actions minuty, Pages), Supabase (DB, Storage, free tier) a e-mail. Když se nic nemění, napiš „bez dopadu“.
8. Komunikuj česky, stručně, v číslovaných krocích. U nasazení uveď **přesné PowerShell příkazy** (s `try/catch`, který vypíše status i tělo chyby) a řekni, kam kliknout v GitHubu a Supabase.
9. Tajné klíče (service\_role, hesla, app password) **nikdy** do kódu appky ani do repa, jen do GitHub Secrets / `.env` (v `.gitignore`).

## Zadání

Jednoduchá evidence měřicích přístrojů HVAC servisu. Hlídá platnost kalibrací, ukazuje ji semaforem, posílá e-mailová upozornění s nastavitelným předstihem a ukládá kalibrační protokoly (PDF), aby šly okamžitě doložit zákazníkovi nebo instituci.

**Hotovo (MVP)** = na iPhonu i PC na první pohled vidím, které přístroje a skupiny mají platnou kalibraci a kolik zbývá; protokol otevřu nebo pošlu do 10 s; před koncem platnosti mi přijde e-mail; všechny testy projdou.

## Uživatel a prostředí

- Zatím jediný uživatel: správce. Více uživatelů a role zatím ne, ale datový model má sloupec `owner`, aby šlo později rozšířit.
- Mobilní webová appka (PWA) přidaná na plochu iPhonu, použitelná i na PC v prohlížeči. Šířky od 320 px.
- Hosting: GitHub Pages, repo `vm73-prace/kalibrace` (název potvrdit). Všechny soubory appky v **kořeni** repa.

## Přístroje, které evidujeme

| Skupina | Přístroj | Počet | Pravidlo |
| --- | --- | --- | --- |
| Anemometr – lopatkový | Testo 417 | 3 ks | Stačí, aby **1 ks** měl platnou kalibraci. Kalibrace se protáčí: příště se kalibruje kus s nejstarší kalibrací. Rozlišení podle výrobního čísla a jména technika. |
| Balometr (flow hood) | Airflow ProHood PH731 – basic | 1 ks | Sleduje se platnost kalibrace. |
| Detektory úniků chladiva | dle zadání správce | ? | Platnost je důležitá, sleduje se u každého kusu. |
| Diferenční manometry | dle zadání správce | ? | Sleduje se u každého kusu. |

Přístroje i skupiny musí jít přidávat, upravovat a vyřazovat podle potřeby. Model nesmí být napevno udělaný jen pro anemometry.

## Klíčový koncept: skupina zastupitelných přístrojů

- Každý přístroj patří do **skupiny** s parametrem `min_platnych` (výchozí 1). Skupina o jednom kusu je běžný případ.
- **Stav skupiny:**
  - zelená = počet kusů se zelenou kalibrací ≥ `min_platnych`
  - oranžová = platné kusy existují, ale bez nich by skupina do okna upozornění spadla pod minimum (nejlepší kus brzy vyprší)
  - červená = platných kusů < `min_platnych`
- **„Další na kalibraci“:** aktivní kus skupiny (ne vyřazený, ne právě na kalibraci) s nejstarší nebo chybějící platností. Zobrazit v hlavičce skupiny („Pošli na kalibraci: SN 12345678 – Petr“).
- Okno upozornění počítá s dobou, kdy je přístroj v laboratoři: nový kus musí odejít včas, aby se vrátil dřív, než vyprší ten stávající.
- Propadlý kus ve skupině, která je zelená, se zobrazí šedě nebo tlumeně, ne alarmující červenou.
- **Skupina bez aktivních přístrojů** (jen vyřazené nebo žádné): stav `prazdna`, šedá tečka a „bez přístrojů“; nepočítá se do souhrnu ani do upozornění. Kus na kalibraci je aktivní.
- **„Každý kus musí mít platnou kalibraci“** (`skupiny.vsechny_platne`, výchozí false): min. platných = počet aktivních kusů (bez vyřazených); kus na kalibraci se počítá jako neplatný. Ve formuláři se pole min. platných skryje.

## Výpočet stavu přístroje

Z poslední kalibrace (`platnost_do`, včetně toho dne) a dneška (časová zóna Europe/Prague):

- `zbyva_dni = platnost_do − dnes`
- `okno = predstih_dni + doba_v_lab_dni` (předstih z přístroje, jinak výchozí z nastavení, výchozí 30; doba v laboratoři výchozí 14)
- 🟢 **platná**: `zbyva_dni > okno`
- 🟠 **brzy vyprší**: `0 ≤ zbyva_dni ≤ okno`
- 🔴 **propadlá / bez kalibrace**: `zbyva_dni < 0` nebo žádná kalibrace
- 🔵 **na kalibraci**: stav `na_kalibraci` (zobrazit datum odeslání a očekávaný návrat; po návratu se zadá nová kalibrace a stav se vrátí na aktivní)
- ⚪ **vyřazeno**: v přehledu skryté (přepínač „Zobrazit vyřazené“)

Čisté výpočty (stav přístroje, stav skupiny, další na kalibraci, texty „zbývá 143 dní“ / „propadlá před 12 dny“) dej do samostatného modulu označeného `// <calc>` … `// </calc>`, aby šel testovat v Node. Stejnou logiku použij v Python skriptu pro upozornění a pokryj obojí testy se stejnými případy.

## Stack a architektura

- **Frontend:** vanilla HTML/CSS/JS bez build kroku (Supabase JS z CDN, verze napevno). PWA: `manifest.json`, `sw.js` s verzovanou cache (cachovat jen shell appky, data a PDF ne).
- **Supabase:**
  - Auth: e-mail + heslo, registrace v Supabase vypnuté, uživatele založí správce ručně.
  - Postgres: schéma **`kalibrace`** s tabulkami níže, **RLS na všech tabulkách** (`owner = auth.uid()` a `kalibrace.smi()`).
  - Storage: privátní buckety `kalibrace-protokoly` (PDF / JPG, max 10 MB) a `kalibrace-fotky` (miniatury). Přístup přes podepsané URL, cesta `<uid>/<soubor>`.
  - Do appky jen publishable / anon klíč.
  - Free tier: Supabase povoluje 2 aktivní projekty → sdílený projekt „servisní záznamy“.
- **Upozornění:** GitHub Actions workflow (denní cron) spustí Python skript, který přes Supabase REST zavolá security definer funkci (publishable key + vlastní token v GitHub Secrets, **ne service\_role**), dostane jen data kalibrací, spočítá stavy a pošle e-mail z **pracovní schránky přes SMTP** (údaje jen v GitHub Secrets `KALIBRACE_SMTP_*`; pravidlo „appka připravená k předání“ – žádný osobní Gmail). Denní dotaz zároveň brání automatickému pozastavení Supabase projektu kvůli nečinnosti.

## Datový model (návrh, uprav jen s odůvodněním)

Tabulky jsou ve schématu `kalibrace` (`kalibrace.skupiny` …). `nastaveni` má navíc `token_hash` (SHA-256 tokenu skriptu upozornění).


- `skupiny`: `id`, `owner`, `nazev`, `typ` (anemometr, balometr, detektor\_uniku, dif\_manometr, jiny), `min_platnych` int default 1, `vsechny_platne` bool default false (migrace 002), `poradi`, `created_at`
- `pristroje`: `id`, `owner`, `skupina_id`, `vyrobce`, `model`, `vyrobni_cislo` (unikátní v rámci ownera), `technik`, `interval_mesicu` default 12, `doba_v_lab_dni` default 14, `predstih_dni` null = výchozí, `stav` (aktivni / na\_kalibraci / vyrazeno), `odeslano_dne`, `ocekavany_navrat`, `foto_path`, `poznamka`, `created_at`
- `kalibrace`: `id`, `owner`, `pristroj_id`, `datum_kalibrace`, `platnost_do` (předvyplnit = datum + interval, ale editovatelné podle protokolu), `laborator`, `cislo_protokolu`, `protokol_path`, `cena` (volitelně), `poznamka`, `created_at`
- `nastaveni`: `owner` (PK), `email_upozorneni`, `predstih_dni_vychozi` default 30

SQL dodej jako migraci `sql/001_init.sql` (tabulky, indexy, RLS, storage politiky). Ověř ji, ideálně na lokálním Postgresu se stubem `auth.uid()`.

## Obrazovky

1. **Přehled** (výchozí)
   - Nahoře souhrn: „5 v pořádku · 1 brzy · 0 propadlé“.
   - Sekce podle skupin, v hlavičce stav skupiny a „Další na kalibraci“.
   - Karta přístroje: **miniatura** (fotka, jinak výchozí ikona podle typu), model, výrobní číslo, technik, **barevný štítek** se stavem a textem („zbývá 143 dní“, „propadlá před 12 dny“, „na kalibraci od 3. 11.“).
   - Řazení podle naléhavosti, filtr Vše / Jen problémy.
2. **Detail přístroje:** údaje, aktuální protokol (tlačítka **Otevřít** a **Sdílet**), historie kalibrací, akce Přidat kalibraci / Odeslat na kalibraci / Upravit / Vyřadit. Mazání jen u vyřazených, potvrzení dvojím klepnutím.
3. **Formulář přístroje:** včetně fotky z fotoaparátu (`<input type=file accept=image/* capture>`). Fotku před nahráním zmenši v prohlížeči (cca 400 px, JPEG).
4. **Formulář kalibrace:** datum, platnost (předvyplněná), laboratoř, číslo protokolu, soubor PDF nebo foto protokolu.
5. **Skupiny:** přidat, upravit, nastavit `min_platnych` a pořadí.
6. **Nastavení:** e-mail pro upozornění, výchozí předstih, „Přihlášen jako“, odhlásit, číslo verze.

**Sdílení protokolu:** stáhni PDF z podepsané URL a předej ho přes `navigator.share({ files: [...] })` (iOS nabídka sdílení: Mail, WhatsApp…). Když to prohlížeč neumí, otevři ho v nové záložce.

**Vzhled iOS:** SF Pro font stack, velké nadpisy, seskupené seznamy, světlý i tmavý režim přes CSS proměnné, navigace nahoře (ne spodní lišta s plovoucím tlačítkem). Data česky (`14. 11. 2026`).

## Upozornění e-mailem

- Workflow `.github/workflows/kontrola.yml`: cron denně v 6:00 pražského času (v UTC zohledni letní čas, stačí 5:00 UTC) + `workflow_dispatch` se vstupem `dry_run` (jen vypíše, co by poslal).
- Skript `scripts/kontrola.py` je **bezstavový**. E-mail pošle, když:
  - některý přístroj nebo skupina má právě `zbyva_dni` rovno `okno`, 14, 7, 1 nebo 0, **nebo**
  - je pondělí a existuje cokoli oranžového nebo červeného (týdenní souhrn).
- Obsah e-mailu: předmět „Kalibrace: 1 brzy vyprší, 0 propadlé“; v těle seznam podle skupin, u skupin „Pošli na kalibraci: …“ a odkaz do appky.
- U kusů v zelené skupině se propadlost nehlásí (rotace je záměrná), hlásí se stav skupiny.
- Prázdné skupiny (bez aktivních přístrojů) se nehlásí vůbec.
- Secrets: `KALIBRACE_SUPABASE_URL`, `KALIBRACE_SUPABASE_PUBLISHABLE_KEY`, `KALIBRACE_NOTIFY_TOKEN` (token pro `kalibrace.upozorneni_data`, ne service\_role), `KALIBRACE_SMTP_HOST`, `KALIBRACE_SMTP_PORT`, `KALIBRACE_SMTP_USER`, `KALIBRACE_SMTP_PASSWORD` (pracovní schránka, ne osobní Gmail). Příjemce z `kalibrace.nastaveni.email_upozorneni`.

## Diagnostika (od první verze)

- `?debug=1` zapne panel s logem a chybami JS (červený rámeček), včetně odpovědí Supabase (status a chyba, bez tokenů).
- V patičce a v Nastavení viditelné „verze N“. Při každé změně ji zvyš, stejně jako verzi cache v `sw.js`.
- Python skript: logy s časem do stdout; při chybě nahrát log jako artefakt (`actions/upload-artifact`, `if: failure()`).
- Při chybě nejdřív požádej o skutečný výstup (log, screenshot, konzole), teprve pak oprav. Když přístup selže dvakrát, změň ho a řekni proč.

## Testy

- **Node:** unit testy modulu `<calc>` na pevném „dnes“ (např. 2026-11-14): platná, hranice okna, den vypršení (0), propadlá, bez kalibrace, na kalibraci; skupina 3× Testo s jedním platným → zelená; skupina, kde jediný platný vyprší za 20 dní → oranžová; volba „Další na kalibraci“.
- **Python:** stejné případy pro výpočet stavu + test pravidla „kdy poslat e-mail“ (prahové dny, pondělí).
- **Playwright:** `iPhone 13`, `Pixel 7`, šířky 320 / 390 / 1280, v demo režimu (`?demo=1` s realistickými ukázkovými daty bez Supabase): přehled se vykreslí, barvy štítků sedí, přidání přístroje a kalibrace funguje, nic nepřetéká.
- Po každé změně celá sada. Když test selže, nejdřív zkontroluj, jestli není chyba v testu, a řekni to otevřeně.

## Ikona (s prvním prototypem)

- Pošli 3 návrhy A/B/C v jednom náhledu a zeptej se na výběr. Rodinná barva pracovních appek: přechod **#4a8fd4 → #2c5f94**, bílý jednoduchý symbol na 60–75 % plochy, bez textu, čitelný v 60 px.
- Návrhy motivu: A) ciferník měřidla s fajfkou, B) štítek / visačka s fajfkou, C) kalendář s ručičkou měřidla.
- Sada: `icon-1024.png`, `icon-512.png` (+ maskable), `icon-192.png`, `apple-touch-icon.png` (180), `favicon-32.png`; manifest, `apple-touch-icon`, `theme-color`.

## Postup po etapách

1. Otázky na začátek → blok „Zadání:“.
2. **Prototyp** v demo režimu s ukázkovými daty (3× Testo 417 s rotací, ProHood, 2 detektory, 1 manometr) + 3 ikony → správce schválí vzhled.
3. SQL migrace + RLS + storage politiky + návod krok za krokem v Supabase.
4. Napojení appky: přihlášení, CRUD skupin, přístrojů a kalibrací.
5. Fotky a PDF (nahrání, otevření, sdílení).
6. E-mailová upozornění (workflow + skript + test přes `dry_run`).
7. Nasazení na GitHub Pages, `README.md` s návodem a PowerShell příkazy, `CLAUDE.md` v repu.

Každou etapu ukonči souhrnem: co appka teď umí, co nahrát a v jakém pořadí, jak ověřit (verze, `?debug=1`), stav ikony a dopad na limity.

## Otázky na začátek (jen tyto, jedno kolo)

1. Výrobní čísla a technici pro 3× Testo 417 a ProHood a seznam detektorů úniků a diferenčních manometrů (model, výrobní číslo). Případně je zadám až v appce.
2. Nový Supabase projekt, nebo existující s prefixem `kal_`? (Doporučeno: nový, pokud je volný slot.)
3. Výchozí interval kalibrace a doba v laboratoři (doporučeno 12 měsíců a 14 dní, u každého kusu jde změnit).
4. Název repa a e-mail pro upozornění (doporučeno `kalibrace`; odesílá se z pracovní schránky přes SMTP, ne z osobního Gmailu).

## Mimo rozsah v1 (v2 a dál)

QR štítky na přístroje s odkazem na detail a protokol; ZIP export všech platných protokolů; CSV export pro Excel (středník, UTF-8 BOM); více uživatelů a role; push notifikace; export do kalendáře (.ics); evidence předání přístroje mezi techniky.

Nápady: Formulář Přidat kalibraci předvyplňuje laboratoř z poslední kalibrace jiného přístroje – zvážit předvyplnění z vlastní historie přístroje.

## Odhad dopadu na kredity a limity

- **Supabase free tier:** DB v řádu kB, PDF a fotky v desítkách MB z 1 GB. Bez Edge Functions. Bez dopadu na placení.
- **GitHub:** Pages zdarma; Actions zhruba 1 min denně, tj. asi 30 min měsíčně (veřejné repo zdarma, soukromé z 2000 min free).
- **SMTP pracovní schránky:** pár e-mailů týdně, bez dopadu.
- **OpenAI / Anthropic API:** nepoužívá se.
- **Claude Code:** hlavní spotřeba při stavbě prototypu a testech. Šetřit cílenými editacemi místo přepisů souborů.
