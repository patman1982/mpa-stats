/**
 * MPA – Challenge Everything · Backend
 * =====================================
 * Google Apps Script Web-App, das an das (neue) Google Sheet gebunden ist.
 * Aufgaben:
 *   1. Das Sheet ist die Datenbank UND das Backup (Daten liegen immer in Google).
 *   2. doGet()  -> liefert alle Roh-Daten als JSON (die Website rechnet daraus alle Statistiken).
 *   3. doPost() -> nimmt einen neuen Pokerabend entgegen (nur mit Admin-Passwort).
 *   4. setup()  -> legt die Tabs/Struktur an.
 *   5. migrate()-> importiert die Historie aus dem alten Sheet (einmalig).
 *
 * === EINRICHTUNG (einmalig) ===
 *   1) Neues Google Sheet anlegen -> Erweiterungen -> Apps Script -> diesen Code einfügen.
 *   2) In den Projekt-Einstellungen (Zahnrad) unter "Skripteigenschaften" setzen:
 *        ADMIN_PASSWORD = <dein-passwort>
 *   3) Menü/Editor: Funktion  setup   ausführen (Rechte gewähren).
 *   4) Funktion  migrate  ausführen (holt die Historie aus dem alten Sheet).
 *   5) Bereitstellen -> Neue Bereitstellung -> Web-App
 *        Ausführen als: Ich    | Zugriff: Jeder
 *      -> die /exec-URL kopieren und in der Website (config.js) eintragen.
 */

// ==== Konstanten =============================================================
var OLD_SHEET_ID = '1SBONAyz1nIHysv8D0Ji7tu9hnstGJEnBdV3ZUGNvQc4'; // altes MPA-Sheet
var DEFAULT_BUYIN = 5;            // € pro Buy-In
var DEFAULT_CHIPS = 10000;        // Chips pro Buy-In
var CURRENT_YEAR_DEFAULT = 2026;  // aktuelle Saison (kann über Meta geändert werden)

// Tab-Namen im NEUEN Sheet
var T_GAMES   = 'Games';
var T_RESULTS = 'Results';
var T_LEGACY  = 'LegacyTotals';   // eingefrorene Jahres-Summen (2018–2025)
var T_CHAMPS  = 'Champions';      // Rekord-Block pro Jahr (Hall of Fame)
var T_PLAYERS = 'Players';        // Spieler-Meta (freq-Flag etc.)
var T_META    = 'Meta';           // Key/Value-Einstellungen

// ==== Web-API ===============================================================

function doGet(e) {
  var out = getAllData_();
  return jsonReply_(out, e);
}

function doPost(e) {
  var res = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    if (!checkPassword_(body.password)) {
      res.error = 'Falsches Passwort.';
      return jsonReply_(res, e);
    }
    switch (body.action) {
      case 'addGame':    res = addGame_(body); break;
      case 'deleteGame': res = deleteGame_(body); break;
      case 'closeYear':  res = closeYear_(body); break;
      default: res.error = 'Unbekannte Aktion: ' + body.action;
    }
  } catch (err) {
    res.error = String(err);
  }
  return jsonReply_(res, e);
}

function jsonReply_(obj, e) {
  var txt = JSON.stringify(obj);
  if (e && e.parameter && e.parameter.callback) { // JSONP-Fallback
    return ContentService
      .createTextOutput(e.parameter.callback + '(' + txt + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(txt)
    .setMimeType(ContentService.MimeType.JSON);
}

function checkPassword_(pw) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  return real && pw && String(pw) === String(real);
}

// ==== Daten lesen (für die Website) =========================================

function getAllData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var meta = readMeta_(ss);
  return {
    ok: true,
    updated: new Date().toISOString(),
    currentYear: Number(meta.currentYear || CURRENT_YEAR_DEFAULT),
    defaultBuyin: Number(meta.defaultBuyin || DEFAULT_BUYIN),
    defaultChips: Number(meta.defaultChips || DEFAULT_CHIPS),
    games:        readTable_(ss, T_GAMES),
    results:      readTable_(ss, T_RESULTS),
    legacyTotals: readTable_(ss, T_LEGACY),
    champions:    readTable_(ss, T_CHAMPS),
    players:      readTable_(ss, T_PLAYERS)
  };
}

function readTable_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var head = v[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = {};
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = v[i][c];
    rows.push(o);
  }
  return rows;
}

function readMeta_(ss) {
  var sh = ss.getSheetByName(T_META);
  var m = {};
  if (!sh) return m;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0]).trim()] = v[i][1];
  return m;
}

// ==== Neuen Abend speichern =================================================

function addGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var g = body.game || {};
  var results = body.results || [];
  if (!g.date) return { ok: false, error: 'Datum fehlt.' };
  if (!results.length) return { ok: false, error: 'Keine Spieler-Ergebnisse.' };

  var buyin = Number(g.buyin || DEFAULT_BUYIN);
  var chips = Number(g.chips || DEFAULT_CHIPS);
  var chipValue = buyin / chips;

  // Ergebnisse serverseitig nachrechnen (Quelle der Wahrheit)
  var totalPot = 0, totalPayout = 0, clean = [];
  results.forEach(function (r) {
    var name = String(r.player || '').trim();
    if (!name) return;
    var buyIns = Number(r.buyIns || 0);
    var finalChips = Number(r.finalChips || 0);
    var payout = finalChips * chipValue;
    var result = payout - buyIns * buyin;
    totalPot += buyIns * buyin;
    totalPayout += payout;
    clean.push({ player: name, buyIns: buyIns, finalChips: finalChips,
                 payout: round2_(payout), result: round2_(result) });
  });

  var year = yearOf_(g.date);
  var id = 'G' + new Date().getTime();

  var gGames = ss.getSheetByName(T_GAMES);
  gGames.appendRow([id, g.date, year, g.location || '', buyin, chips,
                    round2_(totalPot), g.note || '', new Date()]);

  var gRes = ss.getSheetByName(T_RESULTS);
  clean.forEach(function (r) {
    gRes.appendRow([id, r.player, r.buyIns, r.finalChips, r.payout, r.result]);
  });

  return {
    ok: true, id: id,
    balance: round2_(totalPayout - totalPot), // sollte ~0 sein
    saved: clean.length
  };
}

function deleteGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = body.id;
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  removeRowsById_(ss.getSheetByName(T_GAMES), 0, id);
  removeRowsById_(ss.getSheetByName(T_RESULTS), 0, id);
  return { ok: true, deleted: id };
}

function removeRowsById_(sh, col, id) {
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) {
    if (String(v[i][col]) === String(id)) sh.deleteRow(i + 1);
  }
}

// ==== Struktur anlegen ======================================================

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, T_GAMES,   ['id','date','year','location','buyin','chips','pot','note','createdAt']);
  ensureSheet_(ss, T_RESULTS, ['gameId','player','buyIns','finalChips','payout','result']);
  ensureSheet_(ss, T_LEGACY,  ['player','year','total']);
  ensureSheet_(ss, T_CHAMPS,  ['year','category','player','amount']);
  ensureSheet_(ss, T_PLAYERS, ['player','freq','firstYear','emoji']);
  var meta = ensureSheet_(ss, T_META, ['key','value']);
  if (meta.getLastRow() < 2) {
    meta.getRange(2,1,3,2).setValues([
      ['currentYear', CURRENT_YEAR_DEFAULT],
      ['defaultBuyin', DEFAULT_BUYIN],
      ['defaultChips', DEFAULT_CHIPS]
    ]);
  }
  SpreadsheetApp.getUi && SpreadsheetApp.getActive().toast('Setup fertig.');
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

// ==== Migration aus dem alten Sheet =========================================

/**
 * Liest die echten Zellwerte aus dem alten Sheet – kein Text-/Formel-Parsen,
 * daher keine Zählfehler.
 *   - Jahres-Summen + freq-Flag  aus Tab "alltime"
 *   - Rekord-Block (Champions)   aus Tab "alltime"
 *   - Abend-Details 2023–2026    aus den Jahres-Tabs
 */
function migrate() {
  setup();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = SpreadsheetApp.openById(OLD_SHEET_ID);

  var currentYear = Number(readMeta_(ss).currentYear || CURRENT_YEAR_DEFAULT);

  // ---- 1) alltime-Tab lesen -------------------------------------------------
  var alltime = findSheet_(old, ['alltime','all time','all-time']);
  var legacy = [], champs = [], playerMeta = {};
  if (alltime) {
    var av = alltime.getDataRange().getValues();
    // Kopfzeile mit Jahres-Spalten finden ("Player" + Jahre)
    var hRow = -1, playerCol = -1, yearCols = {};
    for (var r = 0; r < av.length; r++) {
      var row = av[r].map(String);
      var pc = row.indexOf('Player');
      if (pc >= 0) {
        var found = {};
        for (var c = 0; c < row.length; c++) {
          var m = row[c].match(/^(20\d\d)/);
          if (m) found[c] = Number(m[1]);
        }
        if (Object.keys(found).length >= 3) { hRow = r; playerCol = pc; yearCols = found; break; }
      }
    }
    if (hRow >= 0) {
      var statusCol = playerCol - 1; // "Status"-Spalte (freq)
      for (var rr = hRow + 1; rr < av.length; rr++) {
        var name = String(av[rr][playerCol]).trim();
        if (!name) continue;
        if (/^(fehler|totals?)$/i.test(name)) continue;
        var status = statusCol >= 0 ? String(av[rr][statusCol]).trim().toLowerCase() : '';
        playerMeta[name] = { freq: status === 'freq' };
        for (var cc in yearCols) {
          var yr = yearCols[cc];
          if (yr >= currentYear) continue; // laufendes Jahr wird live gerechnet
          var val = parseNum_(av[rr][cc]);
          if (val !== null) legacy.push([name, yr, round2_(val)]);
        }
      }
    }
    // ---- Champions-Block (Most won / 2nd / Most lost) ----
    champs = parseChampions_(av, currentYear);
  }

  // ---- 2) Abend-Details je Jahres-Tab --------------------------------------
  var games = [], results = [];
  old.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    var ym = nm.match(/(20\d\d)/);
    if (!ym) return;
    var yr = Number(ym[1]);
    if (yr < 2023) return; // vor 2023: nur Summen (alte Tabs fehlerbehaftet)
    parseYearSheet_(sh, yr, games, results);
  });

  // ---- 3) Schreiben ---------------------------------------------------------
  writeAll_(ss, T_LEGACY,  ['player','year','total'], legacy);
  writeAll_(ss, T_CHAMPS,  ['year','category','player','amount'], champs);
  writeAll_(ss, T_GAMES,   ['id','date','year','location','buyin','chips','pot','note','createdAt'], games);
  writeAll_(ss, T_RESULTS, ['gameId','player','buyIns','finalChips','payout','result'], results);

  var pmRows = Object.keys(playerMeta).map(function (n) {
    return [n, playerMeta[n].freq, '', ''];
  });
  writeAll_(ss, T_PLAYERS, ['player','freq','firstYear','emoji'], pmRows);

  SpreadsheetApp.getActive().toast(
    'Migration fertig: ' + legacy.length + ' Legacy-Werte, ' +
    games.length + ' Spiele, ' + results.length + ' Ergebnisse, ' +
    champs.length + ' Rekorde.');
}

/** Parst einen Jahres-Tab (Format ab 2023): Rank|Player|Ttl|Da|Start|Datum…| */
function parseYearSheet_(sh, year, games, results) {
  var v = sh.getDataRange().getValues();
  // Kopfzeile finden: Spalte0 == "Rank", enthält "Ttl" und "Start"
  var hRow = -1;
  for (var r = 0; r < v.length; r++) {
    var row = v[r].map(function (x){ return String(x).trim(); });
    if (row[0] === 'Rank' && row.indexOf('Start') >= 0 && row.indexOf('Ttl') >= 0) { hRow = r; break; }
  }
  if (hRow < 0) return;
  var startCol = v[hRow].map(String).indexOf('Start');
  var dateStart = startCol + 1;
  // Datums-Spalten (zusammenhängend ab dateStart, solange Kopf nicht leer)
  var dates = [];
  for (var c = dateStart; c < v[hRow].length; c++) {
    var d = String(v[hRow][c]).trim();
    if (d === '') break;
    dates.push({ col: c, label: d });
  }
  // Location-Zeile suchen (oberhalb der Kopfzeile: Zelle == "Location")
  var locRow = -1;
  for (var lr = Math.max(0, hRow - 5); lr < hRow; lr++) {
    if (v[lr].map(function(x){return String(x).trim();}).indexOf('Location') >= 0) locRow = lr;
  }
  // Spiele anlegen (ein Spiel je Datum, das echte Ergebnisse hat)
  var gameId = {};
  dates.forEach(function (dc) {
    var loc = locRow >= 0 ? String(v[locRow][dc.col] || '').trim() : '';
    var id = 'H' + year + '_' + normDate_(dc.label);
    gameId[dc.col] = { id: id, date: fullDate_(dc.label, year), location: loc };
  });
  // Spieler-Zeilen: ab hRow+1, solange Spalte0 Zahl (Rank) und Spalte1 Name
  for (var dr = hRow + 1; dr < v.length; dr++) {
    var rank = v[dr][0];
    var player = String(v[dr][1]).trim();
    if (player === '' || !isFinite(Number(rank)) || String(rank).trim() === '') {
      // Ende des Blocks, wenn zwei leere Zeilen o. "Ttl plays"
      if (String(v[dr][1]).indexOf('Ttl plays') >= 0) break;
      if (player === '' && String(v[dr][0]).trim() === '') break;
      continue;
    }
    dates.forEach(function (dc) {
      var val = parseNum_(v[dr][dc.col]);
      if (val === null) return;
      // leere Teilnahme (0 an Datum, an dem Spieler nicht spielte) rausfiltern:
      // im Original bedeutet leere Zelle "nicht dabei", 0 = dabei mit +/-0.
      var raw = v[dr][dc.col];
      if (raw === '' || raw === null) return;
      var gi = gameId[dc.col];
      results.push([gi.id, player, '', '', '', round2_(val)]);
    });
  }
  // Nur Spiele mit mind. 1 Ergebnis übernehmen
  var used = {};
  results.forEach(function (row) { used[row[0]] = true; });
  dates.forEach(function (dc) {
    var gi = gameId[dc.col];
    if (!used[gi.id]) return;
    games.push([gi.id, gi.date, year, gi.location, '', '', '', '', '']);
  });
}

/** Rekord-Block aus dem alltime-Tab: Names- und Betragszeilen paaren. */
function parseChampions_(av, currentYear) {
  var cats = ['Most won','2nd most won','2nd most lost','Most lost'];
  var out = [];
  // Jahres-Kopf des Blocks finden: eine Zeile mit mehreren "20xx"
  var yearRowCols = null;
  for (var r = 0; r < av.length; r++) {
    var row = av[r].map(String);
    var cols = {};
    for (var c = 0; c < row.length; c++) {
      var m = row[c].match(/(20\d\d)/);
      if (m) cols[c] = Number(m[1]);
    }
    // Block-Kopf = viele Jahre UND keine "Player"-Zelle (unterscheidet von Haupttabelle)
    if (Object.keys(cols).length >= 5 && row.indexOf('Player') < 0) { yearRowCols = cols; }
  }
  if (!yearRowCols) return out;
  // Für jede Kategorie: erste Fundzeile = Namen, spätere = Beträge
  cats.forEach(function (cat) {
    var rowsFound = [];
    for (var r = 0; r < av.length; r++) {
      var row = av[r].map(function (x){ return String(x).trim(); });
      if (row.indexOf(cat) >= 0) rowsFound.push(r);
    }
    if (!rowsFound.length) return;
    var nameRow = rowsFound[0];
    var amtRow  = rowsFound.length > 1 ? rowsFound[rowsFound.length - 1] : -1;
    for (var col in yearRowCols) {
      var yr = yearRowCols[col];
      var nm = String(av[nameRow][col] || '').trim();
      var amt = amtRow >= 0 ? parseNum_(av[amtRow][col]) : null;
      if (nm) out.push([yr, cat, nm, amt === null ? '' : round2_(amt)]);
    }
  });
  return out;
}

// ==== Jahr abschließen (optional, wenn Saison endet) ========================

function closeYear_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var year = Number(body.year);
  if (!year) return { ok: false, error: 'Jahr fehlt.' };
  // aktuelle Jahres-Summen aus Results berechnen und in Legacy einfrieren
  var data = getAllData_();
  var totals = {};
  data.results.forEach(function (r) {
    // gameYear ermitteln
  });
  var gy = {};
  data.games.forEach(function (g){ gy[g.id] = Number(g.year); });
  data.results.forEach(function (r) {
    if (gy[r.gameId] !== year) return;
    totals[r.player] = (totals[r.player] || 0) + Number(r.result || 0);
  });
  var legacy = ss.getSheetByName(T_LEGACY);
  Object.keys(totals).forEach(function (p) {
    legacy.appendRow([p, year, round2_(totals[p])]);
  });
  var meta = ss.getSheetByName(T_META);
  var mv = meta.getDataRange().getValues();
  for (var i = 1; i < mv.length; i++) if (mv[i][0] === 'currentYear') meta.getRange(i+1,2).setValue(year + 1);
  return { ok: true, frozen: year, players: Object.keys(totals).length };
}

// ==== Hilfsfunktionen =======================================================

function writeAll_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.appendRow(header);
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(
    rows.map(function (r) {
      var out = r.slice(0, header.length);
      while (out.length < header.length) out.push('');
      return out;
    })
  );
}

function findSheet_(ss, names) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName().toLowerCase().trim();
    for (var j = 0; j < names.length; j++) if (n === names[j]) return sheets[i];
  }
  // Teil-Match
  for (var i2 = 0; i2 < sheets.length; i2++) {
    var n2 = sheets[i2].getName().toLowerCase();
    for (var j2 = 0; j2 < names.length; j2++) if (n2.indexOf(names[j2]) >= 0) return sheets[i2];
  }
  return null;
}

/** "1.234,50 €" / "-12,5" / Zahl -> Number oder null */
function parseNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  var s = String(v).replace(/[€\s]/g, '').replace(/−/g, '-'); // Minuszeichen
  if (s === '' || s === '-') return null;
  // deutsches Format: Tausenderpunkt entfernen, Komma -> Punkt
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = Number(s);
  return isFinite(n) ? n : null;
}

function round2_(n) { return Math.round(Number(n) * 100) / 100; }

function yearOf_(dateStr) {
  var m = String(dateStr).match(/(20\d\d)/);
  if (m) return Number(m[1]);
  return new Date(dateStr).getFullYear() || CURRENT_YEAR_DEFAULT;
}

/** "6.1." + 2026 -> "2026-01-06" (ISO). Deutsche d.m.-Labels. */
function fullDate_(label, year) {
  var m = String(label).match(/(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/);
  if (!m) return year + '-01-01';
  var d = ('0' + m[1]).slice(-2);
  var mo = ('0' + m[2]).slice(-2);
  var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : year;
  return y + '-' + mo + '-' + d;
}

function normDate_(label) {
  var m = String(label).match(/(\d{1,2})\.(\d{1,2})/);
  return m ? (('0'+m[1]).slice(-2) + ('0'+m[2]).slice(-2)) : label.replace(/\W/g, '');
}
