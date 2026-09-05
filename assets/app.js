/* MPA – öffentliche Statistik-Seite. Holt Daten, rechnet (stats.js), rendert. */
(function () {
  'use strict';
  var eur = MPA.eur, shortDate = MPA.shortDate, fmtDate = MPA.fmtDate,
      fmtTime = MPA.fmtTime, fmtDuration = MPA.fmtDuration;
  var cfg = window.MPA_CONFIG || {};
  var app = document.getElementById('app');
  var state = { data: null, S: null, viewYear: null, chartOff: {} };

  var PALETTE = ['#e7c14c','#57d38c','#5aa9ff','#ff6b6b','#c084fc','#ff9f45','#4dd0e1',
                 '#f06292','#9ccc65','#ffd54f','#7986cb','#4db6ac','#ba68c8','#a1887f',
                 '#90a4ae','#f48fb1'];
  function colorFor(i){ return PALETTE[i % PALETTE.length]; }

  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function cls(n){ return n>0?'pos':n<0?'neg':'zero'; }
  function signEur(n){ return (n>0?'+':'') + eur(n); }

  function boot(){
    setHeader();
    var url = cfg.API_URL || '';
    if (!url || /PASTE_YOUR/.test(url)) { useSample('Noch keine API-URL hinterlegt – Vorschau mit Beispieldaten.'); return; }
    showLoading();
    MPA.loadData(url,
      function(d){ render(d); },
      function(err){
        if (window.MPA_SAMPLE) useSample('Server nicht erreichbar – Vorschau mit Beispieldaten. ('+err.message+')');
        else showError(err.message);
      });
  }
  function useSample(msg){ state.demoMsg = msg; render(window.MPA_SAMPLE); }

  // Hash-Routing: #game/<id> -> öffentliche Detailansicht, sonst Dashboard
  function gameIdFromHash(){
    var m = String(location.hash || '').match(/^#game\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  window.addEventListener('hashchange', function(){ if(state.S) route(); });
  function route(){
    var id = gameIdFromHash();
    if (id) renderDetail(id);
    else renderDashboard();
  }

  function setHeader(){
    document.getElementById('brandTitle').textContent = cfg.TITLE || 'MPA';
    if (cfg.SUBTITLE) document.getElementById('brandSub').textContent = cfg.SUBTITLE;
    document.title = cfg.TITLE || 'MPA Poker';
  }
  function showLoading(){ app.innerHTML = '<div class="state"><div class="spinner"></div>Lade Statistik …</div>'; }
  function showError(m){ app.innerHTML = '<div class="state"><div class="errbox">Fehler: '+esc(m)+'</div></div>'; }

  function render(data){
    state.data = data;
    state.S = MPA.compute(data);
    if (state.viewYear == null) state.viewYear = state.S.currentYear;
    route();
  }

  function renderDashboard(){
    var data = state.data;
    var html = '';
    if (data._demo) html += demoBanner(state.demoMsg);
    html += liveBanner();
    html += hero();
    html += kpis();
    html += yearSwitcher();
    html += '<div id="yearView"></div>';
    html += awardsSection();
    html += recordsSection();
    html += hallOfFame();
    html += allTimeSection();
    html += formSection();
    html += participationSection();
    html += footer();
    app.innerHTML = html;
    renderYearView();
    bindYearSwitcher();
    window.scrollTo(0, 0);
  }

  // Banner, wenn gerade ein Abend live läuft
  function liveBanner(){
    var live = (state.S.liveGames || []);
    if(!live.length) return '';
    return live.map(function(g){
      return '<a class="livebanner" href="#game/'+encodeURIComponent(g.id)+'">'
        + '<span class="livedot"></span> <b>Live-Abend läuft</b>'
        + ' · '+fmtDate(g.date)+(g.location?' · '+esc(g.location):'')
        + ' <span class="go">ansehen →</span></a>';
    }).join('');
  }

  function demoBanner(msg){
    return '<div class="state"><div class="errbox" style="background:rgba(231,193,76,.12);border-color:var(--gold);color:#f6e6ad">'
      + '🔧 '+esc(msg||'Vorschaumodus')+'</div></div>';
  }

  // ---- Öffentliche Abend-Detailansicht (#game/<id>) ------------------------
  function renderDetail(id){
    var d = state.S.gameDetail(id);
    if(!d){
      app.innerHTML = '<div class="state"><div class="errbox">Abend nicht gefunden.</div>'
        + '<p style="margin-top:14px"><a href="#">← zurück zur Statistik</a></p></div>';
      window.scrollTo(0,0); return;
    }
    var g = d.game, live = g.status === 'live';
    var chipVal = g.chips ? g.buyin/g.chips : 0;

    // Kopf
    var dur = g.startedAt ? fmtDuration(g.startedAt, live ? null : g.endedAt) : '';
    var head = '<div class="detailhead">'
      + '<a class="back" href="#">← Statistik</a>'
      + '<h1 class="dtitle">'+fmtDate(g.date)+(live?' <span class="badge live-badge"><span class="livedot"></span>live</span>':'')+'</h1>'
      + '<div class="dmeta">'
      +   (g.location?'<span>🏠 '+esc(g.location)+'</span>':'')
      +   '<span>👥 '+d.players.length+' Spieler</span>'
      +   (d.rebuys?'<span>🔁 '+d.rebuys+' Rebuys</span>':'')
      +   (g.startedAt?'<span>🕒 '+fmtTime(g.startedAt)+(g.endedAt?'–'+fmtTime(g.endedAt):'')+(dur?' ('+dur+')':'')+'</span>':'')
      +   '<span>💶 Buy-In '+eur(g.buyin)+' / '+Number(g.chips).toLocaleString('de-DE')+' Chips</span>'
      + '</div>'
      + (g.note?'<div class="dnote">📝 '+esc(g.note)+'</div>':'')
      + '</div>';

    // Ergebnis-Tabelle
    var table;
    if (d.results.length){
      var rows = d.results.map(function(r,i){
        var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
        return '<tr class="'+(i===0?'top1':'')+'">'
          + '<td class="rank">'+(medal||(i+1))+'</td>'
          + '<td class="name"><span class="pname">'+esc(r.player)+'</span></td>'
          + '<td class="mini">'+(r.buyIns!=null?r.buyIns+'×':'–')+'</td>'
          + '<td class="mini hide-sm">'+(r.finalChips!=null?Number(r.finalChips).toLocaleString('de-DE'):'–')+'</td>'
          + '<td class="'+cls(r.result)+'"><b>'+signEur(r.result)+'</b></td>'
          + '</tr>';
      }).join('');
      table = '<div class="card"><h2><span class="h-emoji">📊</span> Ergebnis</h2>'
        + '<div class="body"><table class="lb"><thead><tr>'
        + '<th class="rank">#</th><th class="name">Spieler</th><th>Buy-Ins</th>'
        + '<th class="hide-sm">End-Chips</th><th>Ergebnis</th>'
        + '</tr></thead><tbody>'+rows+'</tbody></table>'
        + '<div class="dpot mini">Pot: '+eur(d.pot)+'</div></div></div>';
    } else {
      // Live: noch keine Endergebnisse -> aktuelle Buy-Ins zeigen
      var cs = d.buyinCounts;
      var prs = Object.keys(cs).sort(function(a,b){ return cs[b]-cs[a]; }).map(function(p){
        return '<tr><td class="name"><span class="pname">'+esc(p)+'</span></td>'
          + '<td>'+cs[p]+'×</td><td class="mini">'+eur(cs[p]*g.buyin)+'</td></tr>';
      }).join('');
      table = '<div class="card"><h2><span class="h-emoji">🎲</span> Läuft gerade</h2>'
        + '<div class="body"><p class="mini" style="padding:0 8px 8px">Endergebnis wird nach Abschluss angezeigt. Bisherige Buy-Ins:</p>'
        + '<table class="lb"><thead><tr><th class="name">Spieler</th><th>Buy-Ins</th><th class="mini">Einsatz</th></tr></thead>'
        + '<tbody>'+prs+'</tbody></table>'
        + '<div class="dpot mini">Pot bisher: '+eur(d.pot)+'</div></div></div>';
    }

    // Log / Verlauf
    var timeline = logTimeline(d.log);

    // Admin-Aktionen (Bearbeiten braucht Passwort -> in admin.html)
    var admin = '<div class="detailactions">'
      + (live
          ? '<a class="btn" href="admin.html#live/'+encodeURIComponent(g.id)+'">▶ Live weiterführen (Admin)</a>'
          : '<a class="btn sec" href="admin.html#edit/'+encodeURIComponent(g.id)+'">✏️ Bearbeiten (Admin)</a>')
      + '</div>';

    app.innerHTML = '<section class="detail">'+head+table+timeline+admin+'</section>';
    window.scrollTo(0,0);
  }

  function logTimeline(log){
    if(!log || !log.length)
      return '<div class="card"><h2><span class="h-emoji">📜</span> Verlauf</h2>'
        + '<div class="body"><p class="state">Für diesen Abend wurde kein Live-Log geführt.</p></div></div>';
    var items = log.map(function(e){
      var icon, txt;
      if(e.type==='start'){ icon='🟢'; txt='<b>Abend gestartet</b>'; }
      else if(e.type==='end'){ icon='🔴'; txt='<b>Abend beendet</b>'; }
      else if(e.type==='buyin'){ icon='🪙'; txt=esc(e.player)+' <span class="mini">Buy-In</span>'; }
      else if(e.type==='rebuy'){ icon='🔁'; txt=esc(e.player)+' <span class="mini">Rebuy</span>'; }
      else { icon='📝'; txt=(e.player?esc(e.player)+' · ':'')+esc(e.info||''); }
      return '<li><span class="lt">'+fmtTime(e.ts)+'</span><span class="li-ic">'+icon+'</span><span class="lx">'+txt+'</span></li>';
    }).join('');
    return '<div class="card"><h2><span class="h-emoji">📜</span> Verlauf</h2>'
      + '<div class="body"><ul class="timeline">'+items+'</ul></div></div>';
  }

  function hero(){
    var s = state.S.summary;
    return '<div class="hero">'
      + '<div class="sub">Saison '+s.currentYear+' · '+s.currentGames+' Abende gespielt</div>'
      + (s.leader ? '<div style="margin-top:6px;font-size:15px">Führung '+s.currentYear+': <b style="color:var(--gold2)">'+esc(s.leader.player)+'</b> '+signEur(s.leader.total)+'</div>' : '')
      + '</div>';
  }

  function kpis(){
    var s = state.S.summary;
    function k(n,l){ return '<div class="kpi"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }
    return '<div class="kpis">'
      + k(s.currentGames, 'Abende '+s.currentYear)
      + k(s.totalGames, 'Abende erfasst')
      + k(s.totalPlayers, 'Spieler gesamt')
      + k(s.firstYear+'–'+s.lastYear, 'Jahre')
      + '</div>';
  }

  function yearSwitcher(){
    var years = state.S.years.slice().reverse();
    var btns = years.map(function(y){
      return '<button data-year="'+y+'" class="'+(y===state.viewYear?'on':'')+'">'+y+'</button>';
    }).join('');
    return '<div style="text-align:center"><div class="year-pill" id="yearPill">'+btns+'</div></div>';
  }
  function bindYearSwitcher(){
    var pill = document.getElementById('yearPill');
    if(!pill) return;
    pill.addEventListener('click', function(e){
      var b = e.target.closest('button'); if(!b) return;
      state.viewYear = Number(b.dataset.year);
      state.chartOff = {};
      Array.prototype.forEach.call(pill.children, function(c){ c.classList.toggle('on', Number(c.dataset.year)===state.viewYear); });
      renderYearView();
      var el = document.getElementById('yearView'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }

  function renderYearView(){
    var y = state.viewYear;
    var lb = state.S.leaderboard(y);
    var prog = state.S.progression(y);
    var html = leaderboardCard(y, lb);
    if (prog.dates.length) html += chartCard(y, prog);
    else html += '<div class="card"><div class="body"><p class="state">Für '+y+' liegen keine Abend-Details vor – nur die Jahres-Summe (die Runde hatte damals noch keine Detailerfassung). Bilanz siehe Tabelle oben.</p></div></div>';
    html += nightsListCard(y);
    document.getElementById('yearView').innerHTML = html;
    if (prog.dates.length) drawChart(prog);
  }

  function leaderboardCard(year, lb){
    var isCur = year === state.S.currentYear;
    var rows = lb.map(function(p,i){
      var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      return '<tr class="'+(i===0?'top1':'')+'">'
        + '<td class="rank">'+(medal?'<span class="medal">'+medal+'</span>':(i+1))+'</td>'
        + '<td class="name"><span class="pname">'+esc(p.player)+'</span>'+(p.freq?'<span class="freqdot" title="Stammspieler"></span>':'')+'</td>'
        + '<td class="'+cls(p.total)+'"><b>'+signEur(p.total)+'</b></td>'
        + '<td class="hide-sm mini">'+(p.nights||'–')+'</td>'
        + '<td class="hide-sm mini">'+(p.avg!=null?signEur(p.avg):'–')+'</td>'
        + '<td class="hide-sm mini">'+(p.winRate!=null?p.winRate+'%':'–')+'</td>'
        + '</tr>';
    }).join('');
    return '<section><div class="card">'
      + '<h2><span class="h-emoji">📊</span> Rangliste '+year+(isCur?' <span class="badge" style="margin-left:auto">live</span>':'')+'</h2>'
      + '<div class="body"><table class="lb"><thead><tr>'
      + '<th class="rank">#</th><th class="name">Spieler</th><th>Bilanz</th>'
      + '<th class="hide-sm">Abende</th><th class="hide-sm">Ø</th><th class="hide-sm">Quote</th>'
      + '</tr></thead><tbody>'+rows+'</tbody></table></div></div></section>';
  }

  // Klickbare Liste aller Abende eines Jahres -> Detailansicht
  function nightsListCard(year){
    var list = state.S.gamesList().filter(function(g){ return g.year === year; });
    if(!list.length) return '';
    var rows = list.map(function(g){
      var live = g.status === 'live';
      var meta = g.players + (g.players===1?' Spieler':' Spieler')
        + (g.rebuys?' · '+g.rebuys+' Rebuys':'');
      var right = live
        ? '<span class="badge live-badge"><span class="livedot"></span>live</span>'
        : (g.top ? '<span class="mini">🥇 '+esc(g.top.player)+' '+signEur(g.top.result)+'</span>' : '');
      return '<a class="nightrow" href="#game/'+encodeURIComponent(g.id)+'">'
        + '<span class="nd">'+fmtDate(g.date)+'</span>'
        + '<span class="nl">'+(g.location?'🏠 '+esc(g.location):'<span class="mini">—</span>')+'</span>'
        + '<span class="nm mini">'+meta+'</span>'
        + '<span class="nr">'+right+'</span>'
        + '<span class="chev">›</span>'
        + '</a>';
    }).join('');
    return '<section><div class="card"><h2><span class="h-emoji">🗓️</span> Abende '+year+'</h2>'
      + '<div class="body nightlist">'+rows+'</div></div></section>';
  }

  function chartCard(year, prog){
    return '<section><div class="card">'
      + '<h2><span class="h-emoji">📈</span> Verlauf '+year+'</h2>'
      + '<div class="chartwrap"><svg class="chart" id="chartSvg" viewBox="0 0 720 360" preserveAspectRatio="xMidYMid meet"></svg></div>'
      + '<div class="legend" id="chartLegend"></div>'
      + '</div></section>';
  }

  function drawChart(prog){
    var svg = document.getElementById('chartSvg');
    var legend = document.getElementById('chartLegend');
    var W=720,H=360,pad={l:44,r:14,t:14,b:34};
    var n = prog.dates.length;
    var series = prog.series;
    // Standard: Top 5 + Bottom 3 aktiv
    if (Object.keys(state.chartOff).length===0 && series.length>8){
      series.forEach(function(s,i){ if(i>=5 && i<series.length-3) state.chartOff[s.player]=true; });
    }
    var active = series.filter(function(s){ return !state.chartOff[s.player]; });
    var vals = [];
    active.forEach(function(s){ s.points.forEach(function(v){ if(v!=null) vals.push(v); }); });
    vals.push(0);
    var min = Math.min.apply(null,vals), max = Math.max.apply(null,vals);
    if(min===max){ min-=1; max+=1; }
    var pdv=(max-min)*0.08; min-=pdv; max+=pdv;
    function X(i){ return pad.l + (n<=1?0:(i/(n-1))*(W-pad.l-pad.r)); }
    function Y(v){ return pad.t + (1-(v-min)/(max-min))*(H-pad.t-pad.b); }

    var g = '';
    // Gitter + Y-Beschriftung
    var ticks = niceTicks(min,max,4);
    ticks.forEach(function(t){
      var y=Y(t);
      g += '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="'+(t===0?'#3a6b58':'#1e3f33')+'" stroke-width="'+(t===0?1.4:1)+'"/>';
      g += '<text x="'+(pad.l-6)+'" y="'+(y+3)+'" fill="#9db8ac" font-size="10" text-anchor="end">'+t+'</text>';
    });
    // X-Beschriftung
    prog.labels.forEach(function(lb,i){
      if(n>8 && i%2===1) return;
      g += '<text x="'+X(i)+'" y="'+(H-pad.b+16)+'" fill="#9db8ac" font-size="10" text-anchor="middle">'+esc(lb)+'</text>';
    });
    // Linien
    series.forEach(function(s,idx){
      if(state.chartOff[s.player]) return;
      var col = colorFor(idx);
      var d='', started=false;
      s.points.forEach(function(v,i){
        var x=X(i), y=Y(v);
        d += (started?' L':'M')+x.toFixed(1)+' '+y.toFixed(1); started=true;
      });
      g += '<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="2.4" stroke-linejoin="round" opacity="0.95"/>';
      // Endpunkt-Label
      var lx=X(n-1), ly=Y(s.points[n-1]);
      g += '<circle cx="'+lx+'" cy="'+ly+'" r="3" fill="'+col+'"/>';
    });
    svg.innerHTML = g;

    legend.innerHTML = series.map(function(s,idx){
      return '<span class="li '+(state.chartOff[s.player]?'off':'')+'" data-p="'+esc(s.player)+'">'
        + '<span class="sw" style="background:'+colorFor(idx)+'"></span>'+esc(s.player)+' '+signEur(s.total)+'</span>';
    }).join('');
    legend.onclick = function(e){
      var li=e.target.closest('.li'); if(!li) return;
      var p=li.dataset.p; state.chartOff[p]=!state.chartOff[p];
      drawChart(prog);
    };
  }

  function niceTicks(min,max,count){
    var span=max-min, step=Math.pow(10,Math.floor(Math.log10(span/count)));
    var err=count/span*step;
    if(err<=0.15)step*=10; else if(err<=0.35)step*=5; else if(err<=0.75)step*=2;
    var ticks=[], t=Math.ceil(min/step)*step;
    for(;t<=max;t+=step) ticks.push(Math.round(t*10)/10);
    if(ticks.indexOf(0)<0 && min<0 && max>0) ticks.push(0);
    return ticks;
  }

  function awardsSection(){
    var a = state.S.awards;
    if(!a.length) return '';
    var cards = a.map(function(x){
      return '<div class="award"><div class="em">'+x.emoji+'</div>'
        + '<div class="t">'+esc(x.title)+'</div>'
        + '<div class="s">'+esc(x.sub)+'</div>'
        + '<div class="w">'+esc(x.player)+'</div>'
        + (x.value?'<div class="v">'+esc(x.value)+'</div>':'')
        + '</div>';
    }).join('');
    return '<section><div class="section-title">🏅 Auszeichnungen (all-time)</div><div class="awards">'+cards+'</div></section>';
  }

  function recordsSection(){
    var r = state.S.records;
    function rec(em,label,who,val,dir){
      if(!who) return '';
      return '<div class="rec"><div class="rem">'+em+'</div><div class="rt"><div class="rl">'+label+'</div><div class="rv">'+esc(who)+'</div></div><div class="ra '+(dir||'')+'">'+val+'</div></div>';
    }
    var h = '';
    if(r.best) h+=rec('💰','Bester Einzelabend', r.best.player+' · '+fmtDate(r.best.date), signEur(r.best.result),'');
    if(r.worst)h+=rec('☠️','Schlechtester Einzelabend', r.worst.player+' · '+fmtDate(r.worst.date), signEur(r.worst.result),'neg');
    if(r.bestYear)h+=rec('📈','Bestes Jahr', r.bestYear.player+' · '+r.bestYear.year, signEur(r.bestYear.total),'');
    if(r.worstYear)h+=rec('📉','Schlechtestes Jahr', r.worstYear.player+' · '+r.worstYear.year, signEur(r.worstYear.total),'neg');
    if(r.mostNights)h+=rec('🎟️','Meiste Abende (Detail)', r.mostNights.player, r.mostNights.nights+'×','');
    if(state.S.mostTitles[0])h+=rec('🏆','Meiste Jahressiege', state.S.mostTitles[0].player, state.S.mostTitles[0].count+'×','');
    if(!h) return '';
    return '<section><div class="card"><h2><span class="h-emoji">🎖️</span> Rekorde</h2><div class="reclist">'+h+'</div></div></section>';
  }

  function hallOfFame(){
    var cby = state.S.championsByYear;
    var years = Object.keys(cby).map(Number).sort().reverse();
    if(!years.length) return '';
    var rows = years.map(function(y){
      var c = cby[y];
      function cell(cat,klass){ var v=c[cat]; return '<td class="'+(klass||'')+'">'+(v?esc(v.player)+(v.amount!=null?'<br><span class="mini">'+signEur(v.amount)+'</span>':''):'–')+'</td>'; }
      return '<tr><td class="y">'+y+'</td>'+cell('Most won','win')+cell('2nd most won','win')+cell('2nd most lost','lose')+cell('Most lost','lose')+'</tr>';
    }).join('');
    return '<section><div class="card"><h2><span class="h-emoji">👑</span> Hall of Fame · Jahressieger</h2>'
      + '<div class="body" style="overflow-x:auto"><table class="hof"><thead><tr>'
      + '<th>Jahr</th><th>🥇 Sieger</th><th>2.</th><th>Vorletzter</th><th>💀 Letzter</th>'
      + '</tr></thead><tbody>'+rows+'</tbody></table></div></div></section>';
  }

  function allTimeSection(){
    var at = state.S.allTime;
    var rows = at.map(function(p,i){
      var medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
      return '<tr class="'+(i===0?'top1':'')+'">'
        + '<td class="rank">'+(medal?'<span class="medal">'+medal+'</span>':(i+1))+'</td>'
        + '<td class="name"><span class="pname">'+esc(p.player)+'</span>'+(p.freq?'<span class="freqdot"></span>':'')+'</td>'
        + '<td class="'+cls(p.total)+'"><b>'+signEur(p.total)+'</b></td>'
        + '<td class="hide-sm mini">'+p.years+'</td>'
        + '</tr>';
    }).join('');
    return '<section><div class="card"><h2><span class="h-emoji">🏛️</span> Ewige Tabelle (all-time)</h2>'
      + '<div class="body"><table class="lb"><thead><tr><th class="rank">#</th><th class="name">Spieler</th><th>Bilanz</th><th class="hide-sm">Jahre</th></tr></thead>'
      + '<tbody>'+rows+'</tbody></table>'
      + '<p class="mini" style="padding:6px 8px">● = Stammspieler. Werte vor 2022 stammen aus dem alten Sheet und können kleine Zählfehler enthalten.</p>'
      + '</div></div></section>';
  }

  function formSection(){
    // Detail-Spieler mit >=3 Abenden, sortiert nach Ø
    var players = state.S.allPlayers.map(state.S.playerDetail).filter(function(d){ return d.nights>=3; })
      .sort(function(a,b){ return b.avg-a.avg; });
    if(!players.length) return '';
    var rows = players.map(function(d){
      return '<tr>'
        + '<td class="name"><span class="pname">'+esc(d.player)+'</span></td>'
        + '<td class="mini">'+d.nights+'</td>'
        + '<td class="'+cls(d.avg)+'">'+signEur(d.avg)+'</td>'
        + '<td class="mini">'+d.winRate+'%</td>'
        + '<td class="hide-sm mini">±'+eur(d.vol)+'</td>'
        + '<td class="hide-sm">'+sparkline(d.form)+'</td>'
        + '</tr>';
    }).join('');
    return '<section><div class="card"><h2><span class="h-emoji">🎯</span> Form &amp; Quoten</h2>'
      + '<div class="body"><table class="lb"><thead><tr><th class="name">Spieler</th><th>Abende</th><th>Ø/Abend</th><th>Sieg-Quote</th><th class="hide-sm">Schwankung</th><th class="hide-sm">Form (letzte 5)</th></tr></thead>'
      + '<tbody>'+rows+'</tbody></table>'
      + '<p class="mini" style="padding:6px 8px">Nur Spieler mit ≥3 erfassten Abenden (ab 2023). Schwankung = Standardabweichung der Abend-Ergebnisse.</p>'
      + '</div></div></section>';
  }

  function sparkline(vals){
    if(!vals || !vals.length) return '';
    var w=70,h=20,max=Math.max.apply(null,vals.map(Math.abs))||1;
    var step=vals.length>1?w/(vals.length-1):0;
    var d=vals.map(function(v,i){ var x=i*step, y=h/2-(v/max)*(h/2-2); return (i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1); }).join(' ');
    var last=vals[vals.length-1];
    return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'
      + '<line x1="0" y1="'+(h/2)+'" x2="'+w+'" y2="'+(h/2)+'" stroke="#245243" stroke-width="1"/>'
      + '<path d="'+d+'" fill="none" stroke="'+(last>=0?'#57d38c':'#ff6b6b')+'" stroke-width="1.8"/></svg>';
  }

  function participationSection(){
    var part = state.S.participation.filter(function(p){ return p.nights>0; });
    var locs = state.S.locations;
    var pRows = part.slice(0,16).map(function(p){
      return '<tr><td class="name"><span class="pname">'+esc(p.player)+'</span></td><td>'+p.nights+'</td><td class="mini">'+p.rate+'%</td></tr>';
    }).join('');
    var lRows = locs.map(function(l){
      return '<tr><td class="name">🏠 '+esc(l.location)+'</td><td>'+l.count+'×</td></tr>';
    }).join('');
    var out = '<section class="row2" style="display:grid;grid-template-columns:1fr;gap:16px">';
    if(pRows) out += '<div class="card"><h2><span class="h-emoji">🪑</span> Teilnahme</h2><div class="body"><table class="lb"><thead><tr><th class="name">Spieler</th><th>Abende</th><th class="mini">Quote</th></tr></thead><tbody>'+pRows+'</tbody></table></div></div>';
    if(lRows) out += '<div class="card"><h2><span class="h-emoji">📍</span> Locations / Gastgeber</h2><div class="body"><table class="lb"><thead><tr><th class="name">Ort</th><th>Abende</th></tr></thead><tbody>'+lRows+'</tbody></table></div></div>';
    out += '</section>';
    return out;
  }

  function footer(){
    var u = state.S.summary.updated;
    return '<footer>MPA – Challenge Everything · Stand '+(u?fmtDate(u.slice(0,10))||u:'–')+'<br>'
      + '<a href="admin.html">Ergebnisse eintragen →</a></footer>';
  }

  boot();
})();
