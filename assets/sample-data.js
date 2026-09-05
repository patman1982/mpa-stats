/* Beispieldaten (echte Werte aus dem alten Sheet) – nur für die Vorschau,
   solange in config.js noch keine API-URL steht. Im Live-Betrieb kommen die
   Daten aus dem Google Sheet und diese Datei wird ignoriert. */
window.MPA_SAMPLE = (function () {
  var buyin = 5, chips = 10000;

  // 2018–2025: eingefrorene Jahres-Summen pro Spieler (aus Tab "alltime")
  var L = {
    Thomas:  {2018:71,2019:147,2020:88,2021:-1.4,2022:21,2023:1.5,2024:-27.5,2025:11},
    Bruno:   {2018:11.5,2019:14.5,2020:127.4,2021:19,2022:-21,2023:9.2,2024:-9.3,2025:62.5},
    Patrick: {2018:49.5,2019:39,2020:-65,2021:78.2,2022:94.5,2023:16.6,2024:69.6,2025:-49.5},
    "Alex S":{2018:43,2019:143.5,2020:-13,2021:-2,2022:-4,2023:-14.8,2024:53.5,2025:0.5},
    Siki:    {2023:16,2024:17,2025:0},
    Mariane: {2021:32},
    Wolf:    {2018:4.5,2019:39.5,2020:-26.5,2021:-15.5,2022:-30,2023:-5.5,2024:18,2025:31},
    Heuschi: {2023:5,2024:-16,2025:8.8},
    Biac:    {2020:6,2021:0},
    "Jürgen":{2018:-28.5,2019:-18.5,2020:4,2021:23,2023:16,2025:25.5},
    "Zürn":  {2018:1.5,2019:-23,2020:-5.5,2023:5,2024:5,2025:11},
    Luki:    {2023:-15},
    Erich:   {2018:-94,2019:-33,2020:111.2,2021:66.7,2022:-11.5,2023:5.5,2024:27,2025:-53},
    Schmiedi:{2024:-3,2025:-35.5},
    Vahe:    {2020:-36.5},
    Raphi:   {2018:-18,2019:-67.5,2020:30,2022:-13,2023:24,2024:-16.5,2025:-3.3},
    Roman:   {2018:23.5,2019:-11.5,2020:-14.3,2021:-26,2022:-7,2023:-1,2024:-31.1,2025:-7},
    Greg:    {2018:-15,2019:26,2020:-0.8,2021:-23.1,2022:-7,2023:-20.5,2024:-32.2,2025:-6},
    Moni:    {2018:0,2019:-30,2021:-62.4},
    Anna:    {2018:0,2019:-51,2020:-89.5,2021:-42},
    Gabor:   {2018:-48.5,2019:-78.5,2020:-48.5,2021:-53.5,2022:-18.5,2023:-12.5,2024:31.5,2025:17.5},
    Michi:   {2018:6,2019:-89.5,2020:-59.5,2021:4,2022:-3.5,2023:-29.5,2024:-86,2025:-13.5}
  };
  var freq = {Bruno:1,Patrick:1,"Alex S":1,Wolf:1,"Zürn":1,Erich:1,Raphi:1,Roman:1,Greg:1,Gabor:1,Michi:1};
  var legacyTotals = [];
  Object.keys(L).forEach(function (p) {
    Object.keys(L[p]).forEach(function (y) { legacyTotals.push({ player: p, year: Number(y), total: L[p][y] }); });
  });
  var players = Object.keys(L).map(function (p) { return { player: p, freq: !!freq[p], firstYear: '', emoji: '' }; });

  // Rekord-Block (Hall of Fame) 2018–2026
  var yrs = [2018,2019,2020,2021,2022,2023,2024,2025,2026];
  var champ = {
    'Most won':     ['Thomas','Thomas','Bruno','Patrick','Patrick','Raphi','Patrick','Bruno','Bruno'],
    '2nd most won': ['Patrick','Alex S','Erich','Erich','Thomas','Patrick','Alex S','Wolf','Siki'],
    '2nd most lost':['Gabor','Gabor','Patrick','Gabor','Bruno','Greg','Greg','Patrick','Jürgen'],
    'Most lost':    ['Erich','Michi','Anna','Moni','Wolf','Michi','Michi','Erich','Erich']
  };
  var champAmt = {
    'Most won':     [71,147,127.4,78.2,94.5,24,69.6,62.5,26.5],
    '2nd most won': [49.5,143.5,111.2,66.7,21,16.6,53.5,31,23],
    '2nd most lost':[-48.5,-78.5,-65,-53.5,-21,-20.5,-32.2,-49.5,-25],
    'Most lost':    [-94,-89.5,-89.5,-62.4,-30,-29.5,-86,-53,-39]
  };
  var champions = [];
  Object.keys(champ).forEach(function (cat) {
    yrs.forEach(function (y, i) { champions.push({ year: y, category: cat, player: champ[cat][i], amount: champAmt[cat][i] }); });
  });

  // 2026: echte Abende
  var g26 = [
    ['G1','2026-01-06','Michi'], ['G2','2026-02-14','Erich'], ['G3','2026-05-16','Michi'],
    ['G4','2026-05-24','Michi'], ['G5','2026-08-22','Wolf']
  ];
  var r26 = {
    Bruno:[4,-8.5,29,null,2], Siki:[5,18,null,null,null], Heuschi:[0,null,5,16.5,-5.5],
    Gabor:[null,null,null,11,null], Thomas:[null,6.5,null,null,null], Schmiedi:[null,6,null,null,null],
    Wolf:[null,null,13,-8,0.5], Roman:[null,17,-15,0,null], Raphi:[null,null,-20,5.5,13],
    Greg:[8,null,null,null,-10], Michi:[0.5,null,-20,1.5,12],
    Patrick:[-5,-7.5,4,-17.5,3], "Jürgen":[null,-25,null,null,null],
    Erich:[-12.5,-6.5,4,-9,-15]
  };
  var games = g26.map(function (g) {
    return { id: g[0], date: g[1], year: 2026, location: g[2], buyin: buyin, chips: chips,
             pot: '', note: '', status: 'done', startedAt: '', endedAt: '' };
  });
  var results = [];
  Object.keys(r26).forEach(function (p) {
    r26[p].forEach(function (v, i) {
      if (v === null || v === undefined) return;
      results.push({ gameId: g26[i][0], player: p, buyIns: '', finalChips: '', payout: '', result: v });
    });
  });

  // Beispiel-Log für einen abgeschlossenen Abend (G5, 22.08.2026 bei Wolf)
  var log = [
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'start', player:'', info:'Abend gestartet' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Wolf', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Bruno', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Heuschi', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Raphi', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Greg', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Michi', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Patrick', info:'' },
    { gameId:'G5', ts:'2026-08-22T20:05:00', type:'buyin', player:'Erich', info:'' },
    { gameId:'G5', ts:'2026-08-22T21:12:00', type:'rebuy', player:'Erich', info:'' },
    { gameId:'G5', ts:'2026-08-22T21:48:00', type:'rebuy', player:'Greg', info:'' },
    { gameId:'G5', ts:'2026-08-22T22:30:00', type:'rebuy', player:'Erich', info:'' },
    { gameId:'G5', ts:'2026-08-22T23:55:00', type:'end', player:'', info:'Abend beendet' }
  ];

  // Ein laufender Live-Abend (heute) – noch ohne Endergebnis
  var lg = ['G6', '2026-09-05', 'Bruno'];
  games.push({ id: lg[0], date: lg[1], year: 2026, location: lg[2], buyin: buyin, chips: chips,
               pot: '', note: '', status: 'live', startedAt: '2026-09-05T20:10:00', endedAt: '' });
  [['Bruno','20:10'],['Patrick','20:10'],['Wolf','20:10'],['Michi','20:10'],['Raphi','20:10']].forEach(function (p) {
    log.push({ gameId:'G6', ts:'2026-09-05T'+p[1]+':00', type:'buyin', player:p[0], info:'' });
  });
  log.unshift({ gameId:'G6', ts:'2026-09-05T20:10:00', type:'start', player:'', info:'Abend gestartet' });
  log.push({ gameId:'G6', ts:'2026-09-05T21:05:00', type:'rebuy', player:'Patrick', info:'' });
  log.push({ gameId:'G6', ts:'2026-09-05T21:40:00', type:'rebuy', player:'Michi', info:'' });

  return {
    ok: true, updated: new Date().toISOString(), currentYear: 2026,
    defaultBuyin: buyin, defaultChips: chips,
    games: games, results: results, legacyTotals: legacyTotals,
    champions: champions, players: players, log: log, _demo: true
  };
})();
