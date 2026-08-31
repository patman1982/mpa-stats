# MPA – Challenge Everything · Pokerstatistik

Öffentliche, mobil-optimierte Pokerstatistik für deine Runde.
**Kostenlos gehostet** (nur die Domain kostet), Daten liegen sicher in **Google Sheets**.

- **Öffentliche Seite** (`index.html`): Ranglisten (aktuelles Jahr + ewige Tabelle), Verlaufskurven, Rekorde, Hall of Fame, Form & Quoten, Teilnahme, Locations und ~15 „Auszeichnungen".
- **Admin-Seite** (`admin.html`): Abend eintragen mit einfachem Passwort. Rechnet live (Buy-Ins + End-Chips → Ergebnis) und prüft die Bilanz.
- **Backend** (`apps-script/Code.gs`): Google Apps Script. Das Google Sheet ist Datenbank **und** Backup in einem.

---

## Wie „Updates" funktionieren (wichtig)

Es gibt zwei verschiedene Arten von Update:

1. **Neuer Pokerabend → sofort live.** Du trägst auf `admin.html` einen Abend ein → er landet im Google Sheet → die Statistik-Seite lädt die Daten **live aus dem Sheet**. GitHub ist dabei nicht beteiligt. Wer die Seite neu lädt, sieht sofort die neue Statistik. **Keine Wartezeit.**
2. **Design/Code ändern → GitHub deployt automatisch.** Nur wenn am Website-Code selbst etwas geändert wird, veröffentlicht GitHub Pages nach einem `git push` in ~1 Minute automatisch neu.

Kurz: **Die Zahlen kommen aus dem Sheet und aktualisieren sich von allein.** GitHub hostet nur die Optik + Logik.

```
  admin.html ──POST(Passwort)──►  Apps Script  ──►  Google Sheet  (DB + Backup)
                                       ▲                  │
  index.html  ◄────────GET(JSON)───────┴──────────────────┘
   (GitHub Pages, öffentlich)          liest live
```

---

## Teil A – Backend einrichten (einmalig, ~10 Min)

1. **Neues Google Sheet** anlegen (z. B. „MPA Poker DB") auf demselben Google-Konzo, dem das alte Sheet gehört.
2. Im Sheet: **Erweiterungen → Apps Script**.
3. Den gesamten Inhalt von [`apps-script/Code.gs`](apps-script/Code.gs) in die Datei `Code.gs` kopieren (vorhandenen Beispielcode ersetzen).
4. **Passwort setzen:** Links auf das Zahnrad **Projekteinstellungen → Skripteigenschaften → Eigenschaft hinzufügen**:
   - Name: `ADMIN_PASSWORD`
   - Wert: *dein Wunschpasswort*
5. Oben die Funktion **`setup`** auswählen und **Ausführen**. Beim ersten Mal Google-Berechtigungen erlauben (dein eigenes Konto). → Legt die Tabs `Games`, `Results`, `LegacyTotals`, `Champions`, `Players`, `Meta` an.
6. Funktion **`migrate`** auswählen und **Ausführen**. → Holt die Historie aus dem alten Sheet:
   - Jahres-Summen 2018–2025 + Stammspieler-Markierung aus dem Tab `alltime`
   - Rekord-/Sieger-Block (Hall of Fame)
   - Abend-Details 2023–2026 aus den Jahres-Tabs
   > Die ID des alten Sheets steht in `Code.gs` oben (`OLD_SHEET_ID`). Sie ist bereits eingetragen.
7. **Als Web-App bereitstellen:** oben rechts **Bereitstellen → Neue Bereitstellung → Typ „Web-App"**:
   - Beschreibung: beliebig
   - **Ausführen als:** *Ich*
   - **Zugriff:** *Jeder*
   - **Bereitstellen** → die **Web-App-URL** kopieren (endet auf `/exec`).
8. Diese URL in [`assets/config.js`](assets/config.js) bei `API_URL` eintragen (die Platzhalter-Zeile ersetzen).

> **Kontrolle:** Öffne die kopierte `/exec`-URL im Browser – du solltest JSON sehen (`{"ok":true,...}`). Danach zeigt die Website echte Daten.

---

## Teil B – Website veröffentlichen (GitHub Pages)

1. Auf GitHub ein **neues Repository** anlegen, z. B. `mpa-poker` (public).
2. Den Inhalt dieses Ordners hochladen/pushen (siehe „Pushen" unten). `index.html` muss im Wurzelverzeichnis liegen (ist es).
3. Im Repo: **Settings → Pages → Source: „Deploy from a branch" → Branch `main` / `/root` → Save**.
4. Nach ~1 Minute ist die Seite unter `https://<dein-user>.github.io/mpa-poker/` erreichbar.

### Pushen (falls das Repo noch nicht verbunden ist)
```bash
git init
git add .
git commit -m "MPA Poker Statistik"
git branch -M main
git remote add origin https://github.com/<dein-user>/mpa-poker.git
git push -u origin main
```

---

## Teil C – Eigene Domain (optional)

1. Domain kaufen (z. B. bei Namecheap, Cloudflare, GoDaddy …).
2. Im Repo **Settings → Pages → Custom domain**: deine Domain eintragen → Save. (Legt eine `CNAME`-Datei an.)
3. Beim Domain-Anbieter DNS setzen:
   - **Apex-Domain** (`deinedomain.tld`): vier `A`-Records auf `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
   - **oder www-Subdomain**: ein `CNAME` auf `<dein-user>.github.io`.
4. „Enforce HTTPS" aktivieren (sobald verfügbar).

---

## Täglicher Gebrauch – Abend eintragen

1. `…/admin.html` am Handy öffnen.
2. **Passwort** eingeben (wird lokal am Gerät gemerkt).
3. **Datum**, **Gastgeber/Ort**, ggf. Buy-In/Chips anpassen (Standard 5 € / 10.000 Chips).
4. Pro Spieler **Buy-Ins** und **End-Chips** eintragen. Das **Ergebnis** wird live berechnet:
   `Ergebnis = End-Chips × (Buy-In ÷ Chips pro Buy-In) − Buy-Ins × Buy-In`
5. Die **Bilanz-Leiste** zeigt „✓ Bilanz stimmt", wenn die Summe der End-Chips zur Anzahl Buy-Ins passt (Nullsummenspiel). Weicht sie ab → End-Chips prüfen.
6. **Speichern** → landet im Sheet, Statistik ist sofort aktuell.

Spieler nicht in der Liste? Unten per „+ Hinzufügen" ergänzen.

---

## Gut zu wissen

- **Backup:** Alle Daten stehen jederzeit im Google Sheet (Tabs `Games`, `Results`). Du kannst dort auch manuell korrigieren.
- **Passwort ändern:** In den Apps-Script-Skripteigenschaften `ADMIN_PASSWORD` anpassen. Nichts neu bereitstellen nötig.
- **Sicherheit:** Das Passwort steht **nur** im Apps Script (nicht im öffentlichen Code). Die öffentliche Seite kann nur **lesen**; Schreiben geht nur mit Passwort. „Da geht's um nix" – für ein Spaßprojekt völlig ausreichend.
- **Jahres-Historie vor 2022:** Wird aus dem alten Sheet als **Jahres-Summe** übernommen (dort gab es früher Zählfehler; die Summen sind die veröffentlichten Werte). Ab 2023 sind die einzelnen Abende erfasst → Verlaufskurven & Rekorde.
- **Aktuelles Jahr:** Wird **live aus den eingetragenen Abenden** gerechnet. Ältere Jahre sind „eingefroren" (Tab `LegacyTotals`).
- **Neues Jahr / Saison abschließen:** Wenn 2026 vorbei ist, kannst du die Saison einfrieren, indem du im Apps Script die Funktion `closeYear_` nutzt (oder im Tab `Meta` den Wert `currentYear` hochsetzt und die Summen des Jahres in `LegacyTotals` überträgst). Sag mir Bescheid, dann baue ich dir dafür einen Ein-Klick-Knopf.

---

## Statistiken auf der Seite

**Ranglisten** (aktuelles Jahr live + jedes vergangene Jahr) · **Ewige Tabelle** · **Verlaufskurve** (kumulativ, antippbare Legende) · **Rekorde** (bester/schlechtester Abend, bestes/schlechtestes Jahr, meiste Abende, meiste Jahressiege) · **Hall of Fame** (Jahressieger, Zweite, Letzte pro Jahr) · **Form & Quoten** (Ø/Abend, Sieg-Quote, Schwankung, Form der letzten 5) · **Teilnahme & Locations** · **Auszeichnungen** (Dauersieger, Sponsor, Break-Even-Buddha, Glückspilz, Achterbahn, Mr. Konstant, Pechvogel, Abräumer, Comeback-King, Heimvorteil, Eiserner Dauergast u. a.).

## Projektstruktur
```
index.html            öffentliche Statistik-Seite
admin.html            Abend eintragen (Passwort)
assets/
  config.js           ← HIER die Apps-Script-URL eintragen
  style.css           Design (mobile-first)
  stats.js            Statistik-Engine + Daten-Loader
  app.js              Rendering der öffentlichen Seite
  admin.js            Eingabe-Formular
  sample-data.js      Beispieldaten (nur Vorschau ohne Backend)
apps-script/
  Code.gs             Backend: API + Migration
  appsscript.json     Manifest
```
