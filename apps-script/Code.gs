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
var T_LOG     = 'Log';            // Abend-Verlauf (Start / Buy-Ins / Rebuys / Ende)

// Spalten-Header der wichtigsten Tabs (zentral, damit setup/ensure konsistent bleiben)
var H_GAMES   = ['id','date','year','location','buyin','chips','pot','note','createdAt','status','startedAt','endedAt'];
var H_RESULTS = ['gameId','player','buyIns','finalChips','payout','result'];
var H_LOG     = ['gameId','ts','type','player','info'];

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
      case 'editGame':   res = editGame_(body); break;
      case 'deleteGame': res = deleteGame_(body); break;
      case 'startGame':  res = startGame_(body); break;   // Live: Abend starten
      case 'logBuy':     res = logBuy_(body); break;      // Live: Buy-In / Rebuy loggen
      case 'undoBuy':    res = undoBuy_(body); break;      // Live: letztes (Re)Buy zurücknehmen
      case 'finishGame': res = finishGame_(body); break;  // Live: Abend abschließen
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
  var tz = ss.getSpreadsheetTimeZone();
  // Games: date-Feld immer als reines "YYYY-MM-DD" ausliefern (kein Date-Objekt,
  // keine Zeitzonen-Verschiebung um einen Tag). startedAt/endedAt bleiben Zeitstempel.
  var games = readTable_(ss, T_GAMES).map(function (g) {
    g.date = toDateStr_(g.date, tz);
    return g;
  });
  return {
    ok: true,
    updated: new Date().toISOString(),
    currentYear: Number(meta.currentYear || CURRENT_YEAR_DEFAULT),
    defaultBuyin: Number(meta.defaultBuyin || DEFAULT_BUYIN),
    defaultChips: Number(meta.defaultChips || DEFAULT_CHIPS),
    games:        games,
    results:      readTable_(ss, T_RESULTS),
    legacyTotals: readTable_(ss, T_LEGACY),
    champions:    readTable_(ss, T_CHAMPS),
    players:      readTable_(ss, T_PLAYERS),
    log:          readTable_(ss, T_LOG)
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
  ensureStructure_(ss);
  var g = body.game || {};
  var results = body.results || [];
  if (!g.date) return { ok: false, error: 'Datum fehlt.' };
  if (!results.length) return { ok: false, error: 'Keine Spieler-Ergebnisse.' };

  var buyin = Number(g.buyin || DEFAULT_BUYIN);
  var chips = Number(g.chips || DEFAULT_CHIPS);
  var calc = computeResults_(results, buyin, chips);
  var id = 'G' + new Date().getTime();
  var year = yearOf_(g.date);

  appendGameRow_(ss, {
    id: id, date: g.date, year: year, location: g.location || '',
    buyin: buyin, chips: chips, pot: round2_(calc.totalPot), note: g.note || '',
    status: 'done', startedAt: '', endedAt: ''
  });
  writeResults_(ss, id, calc.clean);

  return { ok: true, id: id, balance: round2_(calc.balance), saved: calc.clean.length };
}

/** Bestehenden Abend bearbeiten (Meta + Ergebnisse neu berechnen). */
function editGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStructure_(ss);
  var id = body.id;
  var g = body.game || {};
  var results = body.results || [];
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  var row = gameRowIndex_(ss, id);
  if (row < 0) return { ok: false, error: 'Abend nicht gefunden.' };
  if (!results.length) return { ok: false, error: 'Keine Spieler-Ergebnisse.' };

  var buyin = Number(g.buyin || DEFAULT_BUYIN);
  var chips = Number(g.chips || DEFAULT_CHIPS);
  var calc = computeResults_(results, buyin, chips);
  var year = yearOf_(g.date);

  // Games-Zeile aktualisieren (Log/Status/Zeiten bleiben erhalten)
  setGameFields_(ss, id, {
    date: g.date, year: year, location: g.location || '',
    buyin: buyin, chips: chips, pot: round2_(calc.totalPot), note: g.note || ''
  });
  // Ergebnisse ersetzen
  removeRowsById_(ss.getSheetByName(T_RESULTS), 0, id);
  writeResults_(ss, id, calc.clean);

  return { ok: true, id: id, balance: round2_(calc.balance), saved: calc.clean.length };
}

function deleteGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = body.id;
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  removeRowsById_(ss.getSheetByName(T_GAMES), 0, id);
  removeRowsById_(ss.getSheetByName(T_RESULTS), 0, id);
  removeRowsById_(ss.getSheetByName(T_LOG), 0, id);
  return { ok: true, deleted: id };
}

// ==== Live-Abend: starten / (re)buy loggen / abschließen =====================

/** Startet einen Live-Abend, loggt Start + je Startspieler einen Buy-In. */
function startGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStructure_(ss);
  var g = body.game || {};
  var players = (body.players || []).map(function (p) { return String(p || '').trim(); })
    .filter(Boolean);
  if (!g.date) return { ok: false, error: 'Datum fehlt.' };
  if (!players.length) return { ok: false, error: 'Keine Startspieler.' };

  var buyin = Number(g.buyin || DEFAULT_BUYIN);
  var chips = Number(g.chips || DEFAULT_CHIPS);
  var id = 'G' + new Date().getTime();
  var year = yearOf_(g.date);
  var now = new Date();

  appendGameRow_(ss, {
    id: id, date: g.date, year: year, location: g.location || '',
    buyin: buyin, chips: chips, pot: '', note: g.note || '',
    status: 'live', startedAt: now, endedAt: ''
  });

  appendLog_(ss, id, now, 'start', '', 'Abend gestartet');
  players.forEach(function (p) { appendLog_(ss, id, now, 'buyin', p, ''); });

  return { ok: true, id: id, startedAt: now.toISOString(), log: logForGame_(ss, id) };
}

/** Loggt einen Buy-In (Typ 'rebuy' Standard, 'buyin' für spät dazugekommene). */
function logBuy_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = body.id;
  var player = String(body.player || '').trim();
  var type = body.type === 'buyin' ? 'buyin' : 'rebuy';
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  if (!player) return { ok: false, error: 'Kein Spieler.' };
  if (gameRowIndex_(ss, id) < 0) return { ok: false, error: 'Abend nicht gefunden.' };
  appendLog_(ss, id, new Date(), type, player, '');
  return { ok: true, id: id, log: logForGame_(ss, id) };
}

/** Nimmt den letzten Buy-In/Rebuy eines Spielers wieder zurück. */
function undoBuy_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = body.id;
  var player = String(body.player || '').trim();
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  var sh = ss.getSheetByName(T_LOG);
  var v = sh.getDataRange().getValues(); // [gameId,ts,type,player,info]
  for (var i = v.length - 1; i >= 1; i--) {
    if (String(v[i][0]) !== String(id)) continue;
    if (player && String(v[i][3]).trim() !== player) continue;
    if (v[i][2] === 'rebuy' || v[i][2] === 'buyin') { sh.deleteRow(i + 1); break; }
  }
  return { ok: true, id: id, log: logForGame_(ss, id) };
}

/** Schließt einen Live-Abend ab: End-Chips eintragen, Ergebnisse berechnen. */
function finishGame_(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureStructure_(ss);
  var id = body.id;
  var results = body.results || [];
  if (!id) return { ok: false, error: 'Keine Spiel-ID.' };
  var row = gameRowIndex_(ss, id);
  if (row < 0) return { ok: false, error: 'Abend nicht gefunden.' };
  if (!results.length) return { ok: false, error: 'Keine Ergebnisse.' };

  var meta = gameMeta_(ss, id);
  var buyin = Number((body.game && body.game.buyin) || meta.buyin || DEFAULT_BUYIN);
  var chips = Number((body.game && body.game.chips) || meta.chips || DEFAULT_CHIPS);
  var counts = countBuyins_(ss, id); // player -> Anzahl Buy-Ins aus dem Log

  // Buy-Ins aus dem Log ergänzen, wenn nicht explizit übergeben
  var enriched = results.map(function (r) {
    var name = String(r.player || '').trim();
    var b = (r.buyIns === '' || r.buyIns == null) ? (counts[name] || 1) : Number(r.buyIns);
    return { player: name, buyIns: b, finalChips: Number(r.finalChips || 0) };
  });
  var calc = computeResults_(enriched, buyin, chips);
  var now = new Date();

  removeRowsById_(ss.getSheetByName(T_RESULTS), 0, id);
  writeResults_(ss, id, calc.clean);
  setGameFields_(ss, id, {
    buyin: buyin, chips: chips, pot: round2_(calc.totalPot),
    status: 'done', endedAt: now
  });
  if (body.game) {
    var upd = {};
    if (body.game.date)     { upd.date = body.game.date; upd.year = yearOf_(body.game.date); }
    if (body.game.location != null) upd.location = body.game.location;
    if (body.game.note != null)     upd.note = body.game.note;
    if (Object.keys(upd).length) setGameFields_(ss, id, upd);
  }
  appendLog_(ss, id, now, 'end', '', 'Abend beendet');

  return { ok: true, id: id, balance: round2_(calc.balance), saved: calc.clean.length };
}

// ==== gemeinsame Schreib-/Rechen-Helfer =====================================

/** Ergebnisse serverseitig nachrechnen (Quelle der Wahrheit). */
function computeResults_(results, buyin, chips) {
  var chipValue = chips ? buyin / chips : 0;
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
  return { clean: clean, totalPot: totalPot, totalPayout: totalPayout,
           balance: totalPayout - totalPot };
}

function appendGameRow_(ss, g) {
  var sh = ss.getSheetByName(T_GAMES);
  var head = headerOf_(sh, H_GAMES);
  var rowObj = {
    id: g.id, date: g.date, year: g.year, location: g.location,
    buyin: g.buyin, chips: g.chips, pot: g.pot, note: g.note,
    createdAt: new Date(), status: g.status || 'done',
    startedAt: g.startedAt || '', endedAt: g.endedAt || ''
  };
  sh.appendRow(head.map(function (h) { return rowObj[h] != null ? rowObj[h] : ''; }));
}

function writeResults_(ss, id, clean) {
  var sh = ss.getSheetByName(T_RESULTS);
  clean.forEach(function (r) {
    sh.appendRow([id, r.player, r.buyIns, r.finalChips, r.payout, r.result]);
  });
}

function appendLog_(ss, id, ts, type, player, info) {
  var sh = ss.getSheetByName(T_LOG) || ensureSheet_(ss, T_LOG, H_LOG);
  sh.appendRow([id, ts, type, player || '', info || '']);
}

function logForGame_(ss, id) {
  var sh = ss.getSheetByName(T_LOG);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== String(id)) continue;
    var ts = v[i][1];
    out.push({ gameId: v[i][0], ts: ts instanceof Date ? ts.toISOString() : String(ts),
               type: v[i][2], player: v[i][3], info: v[i][4] });
  }
  return out;
}

/** player -> Anzahl Buy-Ins (buyin + rebuy) aus dem Log. */
function countBuyins_(ss, id) {
  var sh = ss.getSheetByName(T_LOG);
  var out = {};
  if (!sh) return out;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== String(id)) continue;
    if (v[i][2] !== 'buyin' && v[i][2] !== 'rebuy') continue;
    var p = String(v[i][3]).trim();
    if (p) out[p] = (out[p] || 0) + 1;
  }
  return out;
}

function gameRowIndex_(ss, id) {
  var sh = ss.getSheetByName(T_GAMES);
  if (!sh) return -1;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(id)) return i; // 0-basiert (Zeile i+1)
  return -1;
}

function gameMeta_(ss, id) {
  var sh = ss.getSheetByName(T_GAMES);
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== String(id)) continue;
    var o = {};
    for (var c = 0; c < head.length; c++) o[head[c]] = v[i][c];
    return o;
  }
  return {};
}

/** Setzt einzelne Felder einer Games-Zeile anhand der Header-Namen. */
function setGameFields_(ss, id, fields) {
  var sh = ss.getSheetByName(T_GAMES);
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]) !== String(id)) continue;
    Object.keys(fields).forEach(function (k) {
      var c = head.indexOf(k);
      if (c >= 0) sh.getRange(i + 1, c + 1).setValue(fields[k]);
    });
    return true;
  }
  return false;
}

/** Header-Zeile eines Sheets lesen; leeres Sheet mit Default-Header initialisieren. */
function headerOf_(sh, def) {
  if (sh.getLastRow() === 0) { sh.appendRow(def); return def.slice(); }
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
}

function removeRowsById_(sh, col, id) {
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) {
    if (String(v[i][col]) === String(id)) sh.deleteRow(i + 1);
  }
}

/** Stellt sicher, dass Log-Tab existiert und Games die neuen Spalten hat. */
function ensureStructure_(ss) {
  ensureSheet_(ss, T_LOG, H_LOG);
  ensureColumns_(ss.getSheetByName(T_GAMES), H_GAMES);
}

/** Fehlende Spalten (nach Header-Name) rechts anhängen – nicht-destruktiv. */
function ensureColumns_(sh, required) {
  if (!sh) return;
  if (sh.getLastRow() === 0) { sh.appendRow(required); return; }
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  required.forEach(function (h) {
    if (head.indexOf(h) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
      head.push(h);
    }
  });
}

// ==== Struktur anlegen ======================================================

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, T_GAMES,   H_GAMES);
  ensureSheet_(ss, T_RESULTS, H_RESULTS);
  ensureSheet_(ss, T_LOG,     H_LOG);
  ensureSheet_(ss, T_LEGACY,  ['player','year','total']);
  ensureSheet_(ss, T_CHAMPS,  ['year','category','player','amount']);
  ensureSheet_(ss, T_PLAYERS, ['player','freq','firstYear','emoji']);
  ensureColumns_(ss.getSheetByName(T_GAMES), H_GAMES); // bestehende Sheets nachrüsten
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
  writeAll_(ss, T_GAMES,   H_GAMES, games);
  writeAll_(ss, T_RESULTS, H_RESULTS, results);

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
  // Datums-Spalten (zusammenhängend ab dateStart, solange Kopf nicht leer).
  // raw = Original-Zellwert (oft ein echtes Date-Objekt), label = Text-Fallback.
  var dates = [];
  for (var c = dateStart; c < v[hRow].length; c++) {
    var raw = v[hRow][c];
    var d = String(raw).trim();
    if (d === '') break;
    dates.push({ col: c, raw: raw, label: d });
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
    var iso = fullDate_(dc.raw, year);
    var id = 'H' + year + '_' + iso.replace(/-/g, '');
    gameId[dc.col] = { id: id, date: iso, location: loc };
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

/** Datums-Kopf -> "2026-01-06" (ISO). Akzeptiert echte Date-Zellen ODER d.m.-Texte. */
function fullDate_(label, year) {
  if (label instanceof Date && !isNaN(label.getTime())) {
    return Utilities.formatDate(label, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var m = String(label).match(/(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/);
  if (!m) return year + '-01-01';
  var d = ('0' + m[1]).slice(-2);
  var mo = ('0' + m[2]).slice(-2);
  var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : year;
  return y + '-' + mo + '-' + d;
}

/** Zellwert (Date oder ISO/String) -> reines "YYYY-MM-DD" in der Sheet-Zeitzone. */
function toDateStr_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, tz || Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v == null ? '' : v);
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : s;
}
