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

  // ---- 2) Abend-Details je Jahres-Tab (ALLE Jahre) -------------------------
  // Nur die "<Jahr>_stäts"-Tabs (nicht die _bilanz-/calc-Tabs).
  var games = [], results = [];
  old.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (!/stäts/i.test(nm)) return;
    var ym = nm.match(/(20\d\d)/);
    if (!ym) return;
    parseYearSheet_(sh, Number(ym[1]), games, results);
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

/**
 * Parst einen Jahres-Tab. Die alten Tabs haben ZWEI Formate:
 *   - "Delta"      (2022–2026): Einzelergebnisse pro Abend. Kopf enthält Start + Ttl,
 *                  Datumsspalten sind echte Datumszellen oder "d.m."-Texte.
 *   - "Kumulativ"  (2018–2021): laufende Gesamtstände. Kopf enthält "MPAs". Einzelabend
 *                  = Differenz zweier aufeinanderfolgender Spalten; ±0 = nicht dabei.
 * Spielernamen werden auf die kanonische Schreibweise normalisiert (normName_).
 */
function parseYearSheet_(sh, year, games, results) {
  var v = sh.getDataRange().getValues();
  var isDelta = false;
  for (var r = 0; r < v.length; r++) {
    var row = v[r].map(function (x){ return String(x).trim(); });
    if (row.indexOf('Start') >= 0 && row.indexOf('Ttl') >= 0) { isDelta = true; break; }
  }
  if (isDelta) parseDeltaSheet_(v, year, games, results);
  else         parseCumulSheet_(v, year, games, results);
}

/** Format mit Einzelergebnissen (2022–2026). */
function parseDeltaSheet_(v, year, games, results) {
  var hRow = -1;
  for (var r = 0; r < v.length; r++) {
    var row = v[r].map(function (x){ return String(x).trim(); });
    if (row.indexOf('Start') >= 0 && row.indexOf('Ttl') >= 0) { hRow = r; break; }
  }
  if (hRow < 0) return;
  var H = v[hRow].map(function (x){ return String(x).trim(); });
  var startCol = H.indexOf('Start');
  var playerCol = -1;
  ['Spielaz', 'Spieler', 'Player'].forEach(function (k) { if (playerCol < 0 && H.indexOf(k) >= 0) playerCol = H.indexOf(k); });
  if (playerCol < 0) playerCol = 1;

  var dateCols = [];
  for (var c = startCol + 1; c < v[hRow].length; c++) {
    var iso = cellToIso_(v[hRow][c], year);
    if (iso) dateCols.push({ col: c, iso: iso });
  }
  var locRow = -1;
  for (var lr = Math.max(0, hRow - 5); lr < hRow; lr++) {
    var has = false;
    v[lr].forEach(function (x){ if (String(x).trim().toLowerCase().indexOf('location') === 0) has = true; });
    if (has) locRow = lr;
  }
  var gid = {};
  dateCols.forEach(function (dc) {
    var loc = (locRow >= 0 && v[locRow][dc.col] != null) ? String(v[locRow][dc.col]).trim() : '';
    gid[dc.col] = { id: 'H' + year + '_' + dc.iso.replace(/-/g, ''), iso: dc.iso, loc: loc };
  });

  var startLen = results.length;
  for (var dr = hRow + 1; dr < v.length; dr++) {
    var raw = v[dr][playerCol];
    if (raw == null) continue;
    var s = String(raw).trim(), low = s.toLowerCase();
    if (low === 'ttl plays' || low === 'kontrolle' || low === 'runde') break;
    if (s === '' || isSkipName_(low)) continue;
    var name = normName_(s);
    dateCols.forEach(function (dc) {
      var val = v[dr][dc.col];
      if (typeof val === 'number' && isFinite(val)) {
        results.push([gid[dc.col].id, name, '', '', '', round2_(val)]);
      }
    });
  }
  addUsedGames_(results, startLen, dateCols.map(function (dc){ return { id: gid[dc.col].id, iso: gid[dc.col].iso, loc: gid[dc.col].loc }; }), year, games);
}

/** Format mit kumulierten Gesamtständen (2018–2021). */
function parseCumulSheet_(v, year, games, results) {
  var hRow = -1;
  for (var r = 0; r < v.length; r++) {
    if (v[r].map(function (x){ return String(x).trim(); }).indexOf('MPAs') >= 0) { hRow = r; break; }
  }
  if (hRow < 0) return;
  var H = v[hRow];
  var playerCol = H.map(function (x){ return String(x).trim(); }).indexOf('MPAs');
  var valueCols = [];
  for (var c = playerCol + 1; c < H.length; c++) {
    if (H[c] != null && String(H[c]).trim() !== '') valueCols.push(c);
  }
  // Datum je Spalte: echtes Datum / "d.m."-Text, sonst aus Monatsnamen schätzen
  var lastM = 0, mc = {}, colIso = {};
  valueCols.forEach(function (c) {
    var iso = cellToIso_(H[c], year);
    if (iso) { colIso[c] = iso; lastM = Number(iso.slice(5, 7)); }
    else {
      var mo = monthFromLabel_(String(H[c])) || lastM || 1; lastM = mo;
      mc[mo] = (mc[mo] || 0) + 1;
      colIso[c] = year + '-' + pad2_(mo) + '-' + pad2_(Math.min(1 + mc[mo] * 3, 28));
    }
  });
  var gidByCol = {}, order = [];
  valueCols.forEach(function (c, gi) {
    var id = 'H' + year + '_' + pad2_(gi + 1);
    gidByCol[c] = id;
    order.push({ id: id, iso: colIso[c], loc: '' });
  });

  var startLen = results.length;
  for (var dr = hRow + 1; dr < v.length; dr++) {
    var raw = v[dr][playerCol];
    if (raw == null) continue;
    var s = String(raw).trim(), low = s.toLowerCase();
    if (low === 'kontrolle' || low === 'runde') break;
    if (s === '' || isSkipName_(low)) continue;
    var name = normName_(s), prev = 0;
    valueCols.forEach(function (c) {
      var val = v[dr][c];
      if (val == null || typeof val !== 'number' || !isFinite(val)) return;
      var delta = round2_(val - prev); prev = val;
      if (Math.abs(delta) >= 0.01) results.push([gidByCol[c], name, '', '', '', delta]);
    });
  }
  addUsedGames_(results, startLen, order, year, games);
}

/** Fügt nur die Spiele hinzu, die (in diesem Aufruf) mind. 1 Ergebnis bekamen. */
function addUsedGames_(results, startLen, order, year, games) {
  var used = {};
  for (var i = startLen; i < results.length; i++) used[results[i][0]] = true;
  order.forEach(function (g) {
    if (used[g.id]) games.push([g.id, g.iso, year, g.loc, '', '', '', '', '']);
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
function pad2_(n) { return ('0' + n).slice(-2); }

// ---- Migration: Namens- & Datums-Helfer ------------------------------------

// Schreibvarianten aus den alten Jahres-Tabs -> kanonischer Name (wie im alltime-Tab)
var NAME_ALIASES_ = { 'alex': 'Alex S', 'alex s.': 'Alex S', 'gregor': 'Greg', 'marianne': 'Mariane' };
function normName_(s) {
  s = String(s).trim();
  return NAME_ALIASES_[s.toLowerCase()] || s;
}

// Zeilen-Labels, die keine Spieler sind
var SKIP_NAMES_ = {
  'kontrolle':1,'runde':1,'statistikopfer':1,'fehler':1,'ttl plays':1,'totals':1,'total':1,
  'ttl':1,'spielaz':1,'spieler':1,'player':1,'mpas':1,'location':1,'location:':1,'date:':1,
  'order':1,'rank':1,'ranking':1,'show ups':1,'starting point':1,'-':1,'dead':1
};
function isSkipName_(low) { return !!SKIP_NAMES_[low]; }

// Monatsnamen/Feiertage aus alten Kopfzeilen -> Monatszahl (für 2018–2020)
var MONTHS_ = { 'jän':1,'jan':1,'feb':2,'mär':3,'apr':4,'mai':5,'jun':6,'jul':7,'aug':8,
                'sep':9,'spc':9,'okt':10,'nov':11,'dez':12,'ostern':4,'himmelf':5,
                'jubiläum':6,'open air':7,'weihnacht':12,'acs':12 };
function monthFromLabel_(s) {
  s = String(s).toLowerCase();
  for (var k in MONTHS_) if (s.indexOf(k) >= 0) return MONTHS_[k];
  if (s.indexOf('arbeit') >= 0) return 5; // "T.d. Arbeit"
  return 0;
}

/** Zellwert -> "YYYY-MM-DD", wenn es ein Datum (Date-Zelle oder "d.m.[yyyy]"-Text) ist; sonst null. */
function cellToIso_(cell, year) {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    // Kaputte Datumszellen (z.B. Jahr 0206 statt 2026) auf das Tab-Jahr korrigieren.
    if (cell.getFullYear() < 2010) {
      return year + '-' + pad2_(cell.getMonth() + 1) + '-' + pad2_(cell.getDate());
    }
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var m = String(cell).match(/^\s*(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?\s*$/);
  if (!m) return null;
  var y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(year);
  return y + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
}

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
