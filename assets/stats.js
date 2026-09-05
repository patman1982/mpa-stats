/* MPA Statistik-Engine – rechnet alle Auswertungen aus den Rohdaten.
   Erwartet das JSON aus dem Apps-Script (siehe Code.gs -> getAllData_). */
(function (global) {
  'use strict';

  var MIN_NIGHTS = 5; // Mindestanzahl Abende für Form-/Quoten-Awards

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function stddev(a) {
    if (a.length < 2) return 0;
    var m = mean(a);
    return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); })));
  }

  function compute(data) {
    var currentYear = num(data.currentYear);
    var allGames = (data.games || []).map(function (g) {
      return {
        id: g.id, date: String(g.date || ''), year: num(g.year),
        location: String(g.location || '').trim(),
        buyin: num(g.buyin), chips: num(g.chips), pot: num(g.pot),
        note: g.note || '',
        status: String(g.status || 'done').trim().toLowerCase() || 'done',
        startedAt: g.startedAt || '', endedAt: g.endedAt || ''
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    // Live-Abende (noch nicht abgeschlossen) fließen NICHT in Wertungen ein.
    var games = allGames.filter(function (g) { return g.status !== 'live'; });
    var liveGames = allGames.filter(function (g) { return g.status === 'live'; });

    var gameById = {};
    allGames.forEach(function (g) { gameById[g.id] = g; });

    // Ergebnisse anreichern (mit Jahr/Datum des Spiels)
    var results = (data.results || []).map(function (r) {
      var g = gameById[r.gameId] || {};
      return {
        gameId: r.gameId, player: String(r.player || '').trim(),
        buyIns: r.buyIns === '' ? null : num(r.buyIns),
        finalChips: r.finalChips === '' ? null : num(r.finalChips),
        result: num(r.result),
        year: g.year || 0, date: g.date || '', location: g.location || ''
      };
    }).filter(function (r) { return r.player; });

    // ---- Log-Einträge je Abend ---------------------------------------------
    var logByGame = {};
    (data.log || []).forEach(function (e) {
      var gid = e.gameId;
      if (!gid) return;
      (logByGame[gid] = logByGame[gid] || []).push({
        ts: String(e.ts || ''), type: String(e.type || '').trim(),
        player: String(e.player || '').trim(), info: String(e.info || '')
      });
    });
    Object.keys(logByGame).forEach(function (gid) {
      logByGame[gid].sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    });

    var legacy = (data.legacyTotals || []).map(function (l) {
      return { player: String(l.player || '').trim(), year: num(l.year), total: num(l.total) };
    }).filter(function (l) { return l.player && l.year; });

    var playersMeta = {};
    (data.players || []).forEach(function (p) {
      playersMeta[String(p.player).trim()] = {
        freq: p.freq === true || String(p.freq).toLowerCase() === 'true' || p.freq === 'freq',
        emoji: p.emoji || ''
      };
    });

    // ---- Jahres-Summen: year -> player -> total ----------------------------
    var yearTotals = {};
    legacy.forEach(function (l) {
      (yearTotals[l.year] = yearTotals[l.year] || {})[l.player] = round2((yearTotals[l.year][l.player] || 0) + l.total);
    });
    // aktuelles Jahr live aus results
    var curTotals = {};
    results.forEach(function (r) {
      if (r.year !== currentYear) return;
      curTotals[r.player] = round2((curTotals[r.player] || 0) + r.result);
    });
    yearTotals[currentYear] = curTotals;

    var years = Object.keys(yearTotals).map(Number).filter(function (y) { return y > 0; }).sort();

    // ---- Alle Spieler + All-Time-Summe -------------------------------------
    var allPlayers = {};
    years.forEach(function (y) {
      Object.keys(yearTotals[y]).forEach(function (p) { allPlayers[p] = true; });
    });
    Object.keys(playersMeta).forEach(function (p) { allPlayers[p] = true; });

    var allTime = Object.keys(allPlayers).map(function (p) {
      var sum = 0, activeYears = 0;
      years.forEach(function (y) {
        if (yearTotals[y][p] !== undefined) { sum += yearTotals[y][p]; activeYears++; }
      });
      return {
        player: p, total: round2(sum), years: activeYears,
        freq: (playersMeta[p] || {}).freq || false
      };
    }).sort(function (a, b) { return b.total - a.total; });

    // ---- Abende je Spieler (nur Detailjahre) -------------------------------
    // Reihenfolge chronologisch für Serien/Form
    var nights = {}; // player -> [{date,year,result,location}]
    var sortedResults = results.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    sortedResults.forEach(function (r) {
      (nights[r.player] = nights[r.player] || []).push(r);
    });

    // ---- Leaderboard-Zeile pro Spieler (Detail-Statistik) ------------------
    function playerDetail(p) {
      var ns = nights[p] || [];
      var vals = ns.map(function (n) { return n.result; });
      var wins = vals.filter(function (v) { return v > 0; }).length;
      return {
        player: p,
        nights: ns.length,
        sum: round2(vals.reduce(function (s, x) { return s + x; }, 0)),
        avg: round2(mean(vals)),
        winRate: ns.length ? Math.round(wins / ns.length * 100) : 0,
        best: ns.length ? Math.max.apply(null, vals) : 0,
        worst: ns.length ? Math.min.apply(null, vals) : 0,
        vol: round1(stddev(vals)),
        form: vals.slice(-5),
        streakWin: longestStreak(vals, function (v) { return v > 0; }),
        streakNoWin: longestStreak(vals, function (v) { return v <= 0; }),
        freq: (playersMeta[p] || {}).freq || false
      };
    }

    function longestStreak(vals, ok) {
      var best = 0, cur = 0;
      vals.forEach(function (v) { if (ok(v)) { cur++; best = Math.max(best, cur); } else cur = 0; });
      return best;
    }

    // ---- Leaderboards -------------------------------------------------------
    function leaderboard(year) {
      var t = yearTotals[year] || {};
      return Object.keys(t).map(function (p) {
        var d = playerDetail(p);
        // Für Detailjahre kommen nights/games aus results; sonst nur total.
        return {
          player: p, total: t[p],
          nights: d.nights, avg: d.nights ? d.avg : null,
          winRate: d.nights ? d.winRate : null,
          best: d.nights ? d.best : null, worst: d.nights ? d.worst : null,
          form: d.form, freq: d.freq
        };
      }).sort(function (a, b) { return b.total - a.total; });
    }

    var currentLB = leaderboard(currentYear);

    // ---- Kumulativer Verlauf für ein Jahr (für den Graphen) ----------------
    function progression(year) {
      var gs = games.filter(function (g) { return g.year === year; });
      var dates = gs.map(function (g) { return g.date; });
      var byPlayer = {};
      gs.forEach(function (g, i) {
        results.filter(function (r) { return r.gameId === g.id; }).forEach(function (r) {
          var arr = byPlayer[r.player] = byPlayer[r.player] || new Array(dates.length).fill(null);
          arr[i] = r.result;
        });
      });
      // in kumulative Punkte umrechnen; nur Spieler mit >=1 Abend
      var series = Object.keys(byPlayer).map(function (p) {
        var run = 0, pts = [];
        byPlayer[p].forEach(function (v) {
          if (v !== null) run += v;
          pts.push(round2(run));
        });
        return { player: p, points: pts, total: round2(run),
                 nights: byPlayer[p].filter(function (v) { return v !== null; }).length };
      }).sort(function (a, b) { return b.total - a.total; });
      return { dates: dates, labels: gs.map(function (g) { return shortDate(g.date); }),
               locations: gs.map(function (g) { return g.location; }), series: series };
    }

    // ---- Champions / Hall of Fame ------------------------------------------
    var champions = (data.champions || []).map(function (c) {
      return { year: num(c.year), category: String(c.category || ''),
               player: String(c.player || '').trim(), amount: c.amount === '' ? null : num(c.amount) };
    });
    var championsByYear = {};
    champions.forEach(function (c) {
      (championsByYear[c.year] = championsByYear[c.year] || {})[c.category] = c;
    });
    // Meiste Jahressiege ("Most won")
    var titles = {};
    champions.filter(function (c) { return c.category === 'Most won' && c.player; })
      .forEach(function (c) { titles[c.player] = (titles[c.player] || 0) + 1; });
    var mostTitles = Object.keys(titles).map(function (p) { return { player: p, count: titles[p] }; })
      .sort(function (a, b) { return b.count - a.count; });

    // ---- Rekorde ------------------------------------------------------------
    var records = buildRecords();
    function buildRecords() {
      var best = null, worst = null, bigPot = null;
      results.forEach(function (r) {
        if (!best || r.result > best.result) best = r;
        if (!worst || r.result < worst.result) worst = r;
      });
      games.forEach(function (g) { if (g.pot && (!bigPot || g.pot > bigPot.pot)) bigPot = g; });
      // höchster Jahresgewinn/-verlust (über alle Jahre)
      var bestYear = null, worstYear = null;
      years.forEach(function (y) {
        Object.keys(yearTotals[y]).forEach(function (p) {
          var v = yearTotals[y][p];
          if (!bestYear || v > bestYear.total) bestYear = { player: p, year: y, total: v };
          if (!worstYear || v < worstYear.total) worstYear = { player: p, year: y, total: v };
        });
      });
      var mostNights = allTimeNights();
      return { best: best, worst: worst, bigPot: bigPot,
               bestYear: bestYear, worstYear: worstYear, mostNights: mostNights };
    }
    function allTimeNights() {
      var arr = Object.keys(nights).map(function (p) { return { player: p, nights: nights[p].length }; });
      arr.sort(function (a, b) { return b.nights - a.nights; });
      return arr[0] || null;
    }

    // ---- Teilnahme & Locations ---------------------------------------------
    var totalDetailGames = games.length;
    var participation = Object.keys(nights).map(function (p) {
      var n = nights[p].length;
      return { player: p, nights: n, rate: totalDetailGames ? Math.round(n / totalDetailGames * 100) : 0 };
    }).sort(function (a, b) { return b.nights - a.nights; });

    var locations = {};
    games.forEach(function (g) {
      if (!g.location) return;
      locations[g.location] = (locations[g.location] || 0) + 1;
    });
    var locationList = Object.keys(locations).map(function (l) { return { location: l, count: locations[l] }; })
      .sort(function (a, b) { return b.count - a.count; });

    // ---- Awards (mit Augenzwinkern) ----------------------------------------
    var awards = buildAwards();
    function buildAwards() {
      var A = [];
      var detail = allPlayers ? Object.keys(nights).map(playerDetail) : [];
      var freqDetail = detail.filter(function (d) { return d.nights >= MIN_NIGHTS; });

      function top(list, keyFn, dir) {
        var arr = list.slice().sort(function (a, b) { return dir * (keyFn(b) - keyFn(a)); });
        return arr[0];
      }
      function push(emoji, title, sub, winner, value) {
        if (!winner) return;
        A.push({ emoji: emoji, title: title, sub: sub, player: winner.player, value: value });
      }

      // All-Time Sieger / Sponsor
      if (allTime.length) {
        push('👑', 'Der Dauersieger', 'Höchste All-Time-Bilanz', allTime[0], eur(allTime[0].total));
        var loser = allTime[allTime.length - 1];
        push('💸', 'Der Sponsor', 'Niedrigste All-Time-Bilanz', loser, eur(loser.total));
        // Break-Even-Buddha: am nächsten an 0 (freq, min 2 Jahre)
        var bb = allTime.filter(function (a) { return a.years >= 2; })
          .slice().sort(function (a, b) { return Math.abs(a.total) - Math.abs(b.total); })[0];
        push('⚖️', 'Break-Even-Buddha', 'Am nächsten an ±0', bb, bb ? eur(bb.total) : '');
      }
      // Meiste Titel
      if (mostTitles.length && mostTitles[0].count > 1)
        push('🏆', 'Seriensieger', 'Meiste Jahressiege', mostTitles[0], mostTitles[0].count + '×');

      // Form & Quoten (nur ausreichend aktive Spieler)
      if (freqDetail.length) {
        var lucky = top(freqDetail, function (d) { return d.winRate; }, 1);
        push('🍀', 'Der Glückspilz', 'Höchste Sieg-Quote', lucky, lucky.winRate + '% Abende im Plus');

        var coaster = top(freqDetail, function (d) { return d.vol; }, 1);
        push('🎢', 'Achterbahn-Award', 'Höchste Schwankung', coaster, '±' + eur(coaster.vol) + '/Abend');

        var zen = top(freqDetail, function (d) { return -d.vol; }, 1);
        push('🧘', 'Mr. Konstant', 'Niedrigste Schwankung', zen, '±' + eur(zen.vol) + '/Abend');

        var hot = top(freqDetail, function (d) { return d.streakWin; }, 1);
        if (hot && hot.streakWin >= 2) push('🔥', 'Heißeste Serie', 'Längste Plus-Serie', hot, hot.streakWin + ' Abende');

        var cold = top(freqDetail, function (d) { return d.streakNoWin; }, 1);
        if (cold && cold.streakNoWin >= 2) push('💤', 'Durststrecke', 'Längste Serie ohne Sieg', cold, cold.streakNoWin + ' Abende');
      }

      // Pechvogel / Abräumer: letzte & erste Plätze pro Abend
      var last = {}, first = {};
      games.forEach(function (g) {
        var rs = results.filter(function (r) { return r.gameId === g.id; });
        if (rs.length < 2) return;
        var mn = rs[0], mx = rs[0];
        rs.forEach(function (r) { if (r.result < mn.result) mn = r; if (r.result > mx.result) mx = r; });
        last[mn.player] = (last[mn.player] || 0) + 1;
        first[mx.player] = (first[mx.player] || 0) + 1;
      });
      var pech = topCount(last), raeum = topCount(first);
      if (pech) push('🐐', 'Der Pechvogel', 'Meiste letzte Plätze', pech, pech.count + '×');
      if (raeum) push('🦈', 'Der Abräumer', 'Meiste erste Plätze', raeum, raeum.count + '×');

      // Comeback-King: größte Aufholung innerhalb eines Jahres
      var comeback = bestComeback();
      if (comeback) push('🚀', 'Comeback-King', 'Größte Aufholjagd (' + comeback.year + ')', comeback, '+' + eur(comeback.swing));

      // Heimvorteil: bester Gastgeber am eigenen Tisch
      var host = bestHost();
      if (host) push('🏠', 'Heimvorteil', 'Bester Gastgeber (Ø am eigenen Tisch)', host, eur(host.avg) + '/Abend');

      // Eiserner Dauergast
      if (participation.length) {
        var iron = participation[0];
        push('❤️', 'Eiserner Dauergast', 'Meiste Abende dabei', iron, iron.nights + ' Abende');
      }

      // Einzel-Rekorde
      if (records.best) push('💰', 'Größter Einzel-Coup', shortDate(records.best.date), records.best, eur(records.best.result));
      if (records.worst) push('☠️', 'Schwärzester Abend', shortDate(records.worst.date), records.worst, eur(records.worst.result));

      return A;
    }

    function topCount(obj) {
      var arr = Object.keys(obj).map(function (p) { return { player: p, count: obj[p] }; })
        .sort(function (a, b) { return b.count - a.count; });
      return arr[0];
    }
    function bestComeback() {
      var best = null;
      Object.keys(nights).forEach(function (p) {
        var byYear = {};
        nights[p].forEach(function (n) { (byYear[n.year] = byYear[n.year] || []).push(n.result); });
        Object.keys(byYear).forEach(function (y) {
          var run = 0, low = 0, fin = 0;
          byYear[y].forEach(function (v) { run += v; low = Math.min(low, run); fin = run; });
          var swing = fin - low;
          if (fin > 0 && (!best || swing > best.swing)) best = { player: p, year: Number(y), swing: round2(swing) };
        });
      });
      return best;
    }
    function bestHost() {
      var byHost = {};
      results.forEach(function (r) {
        if (r.location && r.location === r.player) (byHost[r.player] = byHost[r.player] || []).push(r.result);
      });
      var arr = Object.keys(byHost).filter(function (p) { return byHost[p].length >= 2; })
        .map(function (p) { return { player: p, avg: round2(mean(byHost[p])), n: byHost[p].length }; })
        .sort(function (a, b) { return b.avg - a.avg; });
      return arr[0];
    }

    // ---- Abend-Detail & Abend-Liste ----------------------------------------
    var resultsByGame = {};
    results.forEach(function (r) { (resultsByGame[r.gameId] = resultsByGame[r.gameId] || []).push(r); });

    function buyinCounts(id) {
      var out = {};
      (logByGame[id] || []).forEach(function (e) {
        if (e.type !== 'buyin' && e.type !== 'rebuy') return;
        if (e.player) out[e.player] = (out[e.player] || 0) + 1;
      });
      return out;
    }

    function gameDetail(id) {
      var g = gameById[id];
      if (!g) return null;
      var log = logByGame[id] || [];
      var counts = buyinCounts(id);
      var rs = (resultsByGame[id] || []).slice().sort(function (a, b) { return b.result - a.result; });
      var playerNames;
      if (rs.length) {
        playerNames = rs.map(function (r) { return r.player; });
      } else {
        // Live-Abend: Teilnehmer aus dem Log
        var seen = {};
        log.forEach(function (e) { if ((e.type === 'buyin' || e.type === 'rebuy') && e.player) seen[e.player] = true; });
        playerNames = Object.keys(seen);
      }
      var pot = g.pot || 0;
      if (!pot) { // aus Buy-Ins schätzen (v.a. für Live-Abende)
        var tb = 0; Object.keys(counts).forEach(function (p) { tb += counts[p]; });
        pot = round2(tb * g.buyin);
      }
      return {
        game: g, results: rs, log: log, buyinCounts: counts,
        players: playerNames, pot: round2(pot),
        rebuys: log.filter(function (e) { return e.type === 'rebuy'; }).length
      };
    }

    function gamesList() {
      return allGames.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
        .map(function (g) {
          var rs = resultsByGame[g.id] || [];
          var counts = buyinCounts(g.id);
          var np = rs.length || Object.keys(counts).length;
          var top = null;
          rs.forEach(function (r) { if (!top || r.result > top.result) top = r; });
          return {
            id: g.id, date: g.date, year: g.year, location: g.location,
            status: g.status, players: np, pot: g.pot || 0,
            top: top ? { player: top.player, result: top.result } : null,
            rebuys: (logByGame[g.id] || []).filter(function (e) { return e.type === 'rebuy'; }).length
          };
        });
    }

    // ---- Kennzahlen für den Kopf -------------------------------------------
    var summary = {
      currentYear: currentYear,
      currentGames: games.filter(function (g) { return g.year === currentYear; }).length,
      totalGames: games.length,
      totalPlayers: Object.keys(allPlayers).length,
      firstYear: years[0], lastYear: years[years.length - 1],
      leader: currentLB[0] || null,
      updated: data.updated
    };

    return {
      currentYear: currentYear, years: years, summary: summary,
      currentLeaderboard: currentLB,
      leaderboard: leaderboard,
      allTime: allTime,
      yearTotals: yearTotals,
      progression: progression,
      champions: champions, championsByYear: championsByYear, mostTitles: mostTitles,
      records: records, participation: participation, locations: locationList,
      awards: awards,
      playerDetail: playerDetail, nights: nights, allPlayers: Object.keys(allPlayers).sort(),
      gameDetail: gameDetail, gamesList: gamesList, liveGames: liveGames
    };
  }

  // ---- Formatierung ---------------------------------------------------------
  function eur(n) {
    n = Number(n);
    var s = (Math.round(n * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return s + ' €';
  }
  function shortDate(iso) {
    var m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return Number(m[3]) + '.' + Number(m[2]) + '.';
  }
  function fmtDate(iso) {
    var m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return Number(m[3]) + '.' + Number(m[2]) + '.' + m[1];
  }
  // ISO-Zeitstempel -> "HH:MM" in lokaler Zeit
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      var m = String(iso).match(/(\d{2}):(\d{2})/);
      return m ? m[1] + ':' + m[2] : '';
    }
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  // Dauer zwischen zwei ISO-Zeiten -> "3 h 20 min"
  function fmtDuration(fromIso, toIso) {
    var a = new Date(fromIso), b = new Date(toIso || Date.now());
    var ms = b.getTime() - a.getTime();
    if (!isFinite(ms) || ms < 0) return '';
    var min = Math.round(ms / 60000), h = Math.floor(min / 60);
    min = min % 60;
    return (h ? h + ' h ' : '') + min + ' min';
  }

  // ---- Daten laden: fetch, bei CORS-Problemen JSONP-Fallback --------------
  function loadData(url, onOk, onErr) {
    var done = false;
    function ok(d){ if(!done){ done = true; onOk(d); } }
    function err(e){ if(!done){ done = true; onErr(e); } }
    // 1) fetch
    try {
      fetch(url, { method:'GET' })
        .then(function(r){ return r.json(); })
        .then(function(d){ if(d && d.ok) ok(d); else jsonp(); })
        .catch(function(){ jsonp(); });
    } catch(e){ jsonp(); }
    // 2) JSONP-Fallback (funktioniert für Apps Script "Jeder"-Web-Apps immer)
    function jsonp(){
      if(done) return;
      var cb = 'mpa_cb_' + Math.floor(Math.random()*1e9);
      var s = document.createElement('script');
      var t = setTimeout(function(){ cleanup(); err(new Error('Zeitüberschreitung')); }, 12000);
      window[cb] = function(d){ clearTimeout(t); cleanup(); d && d.ok ? ok(d) : err(new Error(d && d.error || 'Antwort ungültig')); };
      function cleanup(){ try{ delete window[cb]; }catch(_){ window[cb]=undefined; } if(s.parentNode) s.parentNode.removeChild(s); }
      s.onerror = function(){ clearTimeout(t); cleanup(); err(new Error('Netzwerkfehler')); };
      s.src = url + (url.indexOf('?')<0?'?':'&') + 'callback=' + cb;
      document.head.appendChild(s);
    }
  }

  global.MPA = { compute: compute, eur: eur, shortDate: shortDate, fmtDate: fmtDate,
                 fmtTime: fmtTime, fmtDuration: fmtDuration, loadData: loadData };
})(window);
