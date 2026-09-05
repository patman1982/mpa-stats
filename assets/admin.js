/* MPA – Admin. Router mit mehreren Ansichten:
   #            Übersicht (Abende-Liste, Aktionen)
   #new         Abend manuell in einem Rutsch eintragen (wie früher)
   #live/new    Live-Abend starten (Startspieler wählen)
   #live/<id>   Live-Runner: Rebuys loggen
   #finish/<id> Live-Abend abschließen (End-Chips eintragen)
   #edit/<id>   Bestehenden Abend bearbeiten / löschen
   Schreibt via Apps-Script POST ins Google Sheet (nur mit Admin-Passwort). */
(function () {
  'use strict';
  var cfg = window.MPA_CONFIG || {};
  var root = document.getElementById('admin');
  var eur = MPA.eur, fmtDate = MPA.fmtDate, fmtTime = MPA.fmtTime, fmtDuration = MPA.fmtDuration;
  var API = cfg.API_URL || '';
  var DEMO = !API || /PASTE_YOUR/.test(API);

  var raw = null;                 // Rohdaten aus dem Sheet
  var S = null;                   // MPA.compute(raw)
  var players = [];               // bekannte Spielernamen
  var defaults = { buyin: 5, chips: 10000, freq: [] };
  var ed = { rows: [], buyin: 5, chips: 10000 }; // Zustand des Ergebnis-Editors
  var live = null;                // Live-Runner: {id, game, log:[]}
  var clockTimer = null;

  // ---- kleine Helfer --------------------------------------------------------
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function getPw(){ try { return localStorage.getItem('mpa_pw') || ''; } catch(e){ return ''; } }
  function setPw(v){ try { localStorage.setItem('mpa_pw', v); } catch(e){} }
  function today(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function num(id, def){ var e=document.getElementById(id); var n=e?Number(e.value):NaN; return isFinite(n)?n:def; }
  function signEur(n){ return (n>0?'+':'')+eur(n); }
  function cls(n){ return n>0?'pos':n<0?'neg':'zero'; }

  var toastTimer;
  function toast(msg, err){
    var el=document.querySelector('.toast'); if(el) el.remove();
    el=document.createElement('div'); el.className='toast'+(err?' err':''); el.textContent=msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ el.remove(); }, err?4200:2600);
  }

  // POST an Apps Script (mit Passwort). cb(data) bei Erfolg, cb(null) bei Fehler.
  function post(payload, cb){
    if(DEMO){ toast('Vorschaumodus – ohne API-URL wird nichts gespeichert.', true); return; }
    var password = getPw();
    if(!password){ toast('Bitte Admin-Passwort eingeben.', true); return; }
    payload.password = password;
    fetch(API, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(d){ if(!d || !d.ok){ toast((d&&d.error)||'Fehler beim Speichern.', true); cb&&cb(null,d); } else cb&&cb(d); })
      .catch(function(e){ toast('Netzwerkfehler: '+e.message, true); cb&&cb(null); });
  }

  function pwField(){
    return '<div class="formcard"><label>Admin-Passwort</label>'
      + '<input id="pw" type="password" placeholder="Passwort" value="'+esc(getPw())+'" autocomplete="current-password">'
      + '<p class="mini" style="margin:6px 2px 0">Wird nur lokal gespeichert und bei jeder Änderung mitgeschickt.</p></div>';
  }
  function bindPw(){ var p=document.getElementById('pw'); if(p) p.addEventListener('input', function(){ setPw(p.value.trim()); }); }
  function datalist(){ return '<datalist id="playerList">'+players.map(function(p){ return '<option value="'+esc(p)+'">'; }).join('')+'</datalist>'; }

  // ---- Daten laden ----------------------------------------------------------
  function boot(){
    window.addEventListener('hashchange', route);
    loadAll(route);
  }
  function loadAll(cb){
    if(DEMO){ apply(window.MPA_SAMPLE); return cb&&cb(); }
    MPA.loadData(API, function(d){ apply(d); cb&&cb(); },
      function(){ apply(window.MPA_SAMPLE || emptyData()); cb&&cb(); });
  }
  function emptyData(){ return { ok:true, currentYear:new Date().getFullYear(), defaultBuyin:5, defaultChips:10000,
    games:[], results:[], legacyTotals:[], champions:[], players:[], log:[] }; }
  function apply(d){
    raw = d; S = MPA.compute(d);
    defaults.buyin = Number(d.defaultBuyin)||5;
    defaults.chips = Number(d.defaultChips)||10000;
    var names = {};
    (d.players||[]).forEach(function(p){ names[String(p.player).trim()]=1; });
    (d.results||[]).forEach(function(r){ names[String(r.player).trim()]=1; });
    (d.legacyTotals||[]).forEach(function(r){ names[String(r.player).trim()]=1; });
    (d.log||[]).forEach(function(e){ if(e.player) names[String(e.player).trim()]=1; });
    players = Object.keys(names).filter(Boolean).sort();
    defaults.freq = (d.players||[]).filter(function(p){ return p.freq===true||String(p.freq).toLowerCase()==='true'||p.freq==='freq'; })
      .map(function(p){ return String(p.player).trim(); });
  }

  // ---- Router ---------------------------------------------------------------
  function route(){
    if(clockTimer){ clearInterval(clockTimer); clockTimer=null; }
    var h = location.hash || '';
    var m;
    if((m=h.match(/^#live\/new$/)))            viewLiveNew();
    else if((m=h.match(/^#live\/(.+)$/)))      viewLiveRun(decodeURIComponent(m[1]));
    else if((m=h.match(/^#finish\/(.+)$/)))    viewFinish(decodeURIComponent(m[1]));
    else if((m=h.match(/^#edit\/(.+)$/)))      viewEdit(decodeURIComponent(m[1]));
    else if(h==='#new')                         viewManualNew();
    else                                        viewHome();
    window.scrollTo(0,0);
  }
  function go(hash){ location.hash = hash; }

  // ==== Übersicht ============================================================
  function viewHome(){
    var list = S.gamesList();
    var rows = list.map(function(g){
      var live = g.status==='live';
      var right = live ? '<span class="badge live-badge"><span class="livedot"></span>live</span>'
        : (g.top?'<span class="mini">🥇 '+esc(g.top.player)+' '+signEur(g.top.result)+'</span>':'');
      var actions = live
        ? '<button class="mini-btn" data-act="run" data-id="'+esc(g.id)+'">▶ weiter</button>'
        : '<button class="mini-btn" data-act="edit" data-id="'+esc(g.id)+'">✏️</button>'
          + '<button class="mini-btn danger" data-act="del" data-id="'+esc(g.id)+'">🗑</button>';
      return '<div class="nightrow admin">'
        + '<a class="nd" href="index.html#game/'+encodeURIComponent(g.id)+'">'+fmtDate(g.date)+'</a>'
        + '<span class="nl">'+(g.location?'🏠 '+esc(g.location):'<span class="mini">—</span>')+'</span>'
        + '<span class="nm mini">'+g.players+' Sp.'+(g.rebuys?' · '+g.rebuys+' Reb.':'')+'</span>'
        + '<span class="nr">'+right+'</span>'
        + '<span class="acts">'+actions+'</span>'
        + '</div>';
    }).join('');

    root.innerHTML =
      (DEMO?demoNote():'')
      + pwField()
      + '<div class="actionrow">'
      +   '<a class="btn" href="#live/new">▶ Live-Abend starten</a>'
      +   '<a class="btn sec" href="#new">✍️ Abend manuell eintragen</a>'
      + '</div>'
      + '<div class="card"><h2><span class="h-emoji">🗓️</span> Abende ('+list.length+')</h2>'
      +   '<div class="body nightlist">'+(rows||'<p class="state">Noch keine Abende erfasst.</p>')+'</div></div>';
    bindPw();
    root.querySelector('.nightlist') && root.querySelector('.nightlist').addEventListener('click', function(e){
      var b=e.target.closest('[data-act]'); if(!b) return;
      var id=b.dataset.id, act=b.dataset.act;
      if(act==='run') go('#live/'+encodeURIComponent(id));
      else if(act==='edit') go('#edit/'+encodeURIComponent(id));
      else if(act==='del') delGame(id);
    });
  }
  function demoNote(){ return '<div class="state"><div class="errbox" style="background:rgba(231,193,76,.12);border-color:var(--gold);color:#f6e6ad">🔧 Vorschaumodus – ohne API-URL wird nichts gespeichert. Trage die URL in <b>assets/config.js</b> ein.</div></div>'; }

  function delGame(id){
    var d = S.gameDetail(id); var lbl = d?fmtDate(d.game.date):id;
    if(!confirm('Abend vom '+lbl+' wirklich löschen? Das kann nicht rückgängig gemacht werden.')) return;
    post({ action:'deleteGame', id:id }, function(r){
      if(!r) return;
      toast('Abend gelöscht.');
      loadAll(function(){ go('#'); route(); });
    });
  }

  // ==== Ergebnis-Editor (gemeinsam für manuell/bearbeiten/abschließen) =======
  function editorTable(opts){
    // opts: {showChips:true, chipsPlaceholder}
    return '<div class="formcard">'
      + '<div class="section-title" style="margin:0 0 8px">Ergebnisse</div>'
      + '<table class="ptable"><colgroup><col style="width:36%"><col style="width:18%"><col style="width:22%"><col style="width:18%"><col style="width:6%"></colgroup>'
      + '<thead><tr><th style="text-align:left">Spieler</th><th>Buy-Ins</th><th>Chips</th><th>Ergebnis</th><th></th></tr></thead>'
      + '<tbody id="pbody"></tbody></table>'
      + '<div class="addrow"><input id="newp" list="playerList" placeholder="Spieler hinzufügen …"><button id="addBtn">+ Hinzufügen</button></div>'
      + '<div id="balance" class="balance ok">Bilanz: 0 €</div>'
      + '</div>';
  }
  function buildRows(){
    var tb=document.getElementById('pbody');
    tb.innerHTML = ed.rows.map(function(r,i){
      return '<tr>'
        + '<td class="pn"><input list="playerList" data-i="'+i+'" data-k="player" value="'+esc(r.player)+'" style="text-align:left"></td>'
        + '<td><input type="number" inputmode="numeric" data-i="'+i+'" data-k="buyIns" value="'+esc(r.buyIns)+'"></td>'
        + '<td><input type="number" inputmode="numeric" data-i="'+i+'" data-k="finalChips" value="'+esc(r.finalChips)+'" placeholder="0"></td>'
        + '<td><input class="res" data-res="'+i+'" value="0" readonly></td>'
        + '<td><button class="rm" data-rm="'+i+'">✕</button></td>'
        + '</tr>';
    }).join('');
    updateComputed();
  }
  function updateComputed(){
    var buyin=num('buyin',ed.buyin), chips=num('chips',ed.chips), chipVal=chips?buyin/chips:0;
    ed.rows.forEach(function(r,i){
      var res=(Number(r.finalChips)||0)*chipVal-(Number(r.buyIns)||0)*buyin; res=Math.round(res*100)/100;
      var el=document.querySelector('[data-res="'+i+'"]');
      if(el){ el.value=(res>0?'+':'')+res; el.className='res '+(res>0?'pos':res<0?'neg':'zero'); }
    });
    updateBalance();
  }
  function updateBalance(){
    var buyin=num('buyin',ed.buyin), chips=num('chips',ed.chips), chipVal=chips?buyin/chips:0;
    var pot=0, pay=0, totalChips=0;
    ed.rows.forEach(function(r){ pot+=(Number(r.buyIns)||0)*buyin; pay+=(Number(r.finalChips)||0)*chipVal; totalChips+=(Number(r.finalChips)||0); });
    var diff=Math.round((pay-pot)*100)/100, el=document.getElementById('balance'); if(!el) return;
    var expChips=chips?Math.round(pot/buyin*chips):0;
    if(Math.abs(diff)<0.01){ el.className='balance ok'; el.innerHTML='✓ Bilanz stimmt · Pot '+eur(pot)+' · Chips '+totalChips.toLocaleString('de-DE')+' / '+expChips.toLocaleString('de-DE'); }
    else { el.className='balance bad'; el.innerHTML='⚠ Differenz '+(diff>0?'+':'')+eur(diff)+' · Chips '+totalChips.toLocaleString('de-DE')+' erwartet '+expChips.toLocaleString('de-DE')+' (End-Chips prüfen)'; }
  }
  function bindEditor(){
    document.getElementById('pbody').addEventListener('input', function(e){
      var t=e.target,i=t.dataset.i,k=t.dataset.k; if(i==null)return; ed.rows[i][k]=t.value; updateComputed();
    });
    document.getElementById('pbody').addEventListener('click', function(e){
      var rm=e.target.closest('[data-rm]'); if(!rm)return; ed.rows.splice(Number(rm.dataset.rm),1); buildRows();
    });
    document.getElementById('addBtn').addEventListener('click', function(){
      var inp=document.getElementById('newp'); var name=(inp.value||'').trim(); if(!name)return;
      ed.rows.push({player:name,buyIns:1,finalChips:''}); inp.value=''; buildRows();
    });
    document.getElementById('newp').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addBtn').click(); } });
    ['buyin','chips'].forEach(function(id){ var e=document.getElementById(id); if(e) e.addEventListener('input', updateComputed); });
  }
  function collectResults(){
    return ed.rows
      .filter(function(r){ return String(r.player).trim() && (r.finalChips!==''||r.buyIns!==''); })
      .map(function(r){ return { player:String(r.player).trim(), buyIns:Number(r.buyIns)||0, finalChips:Number(r.finalChips)||0 }; });
  }

  // ==== Abend manuell eintragen (#new) =======================================
  function viewManualNew(){
    ed = { rows:(defaults.freq.length?defaults.freq:players.slice(0,8)).map(function(p){ return {player:p,buyIns:1,finalChips:''}; }),
           buyin:defaults.buyin, chips:defaults.chips };
    root.innerHTML =
      (DEMO?demoNote():'')
      + backlink('Abend manuell eintragen')
      + pwField() + datalist()
      + gameMetaCard({date:today(), location:'', buyin:defaults.buyin, chips:defaults.chips, note:''}, true)
      + editorTable()
      + '<button class="btn" id="saveBtn">💾 Abend speichern</button>';
    bindPw(); buildRows(); bindEditor();
    document.getElementById('saveBtn').addEventListener('click', function(){
      var game=readGameMeta(); if(!game) return;
      var results=collectResults(); if(!results.length){ toast('Keine Ergebnisse eingetragen.', true); return; }
      var btn=this; btn.disabled=true; btn.textContent='Speichere …';
      post({ action:'addGame', game:game, results:results }, function(d){
        btn.disabled=false; btn.textContent='💾 Abend speichern';
        if(!d) return; afterSave(d);
      });
    });
  }

  // ==== Live: Abend starten (#live/new) ======================================
  function viewLiveNew(){
    var start = defaults.freq.slice();
    root.innerHTML =
      (DEMO?demoNote():'')
      + backlink('Live-Abend starten')
      + pwField() + datalist()
      + gameMetaCard({date:today(), location:'', buyin:defaults.buyin, chips:defaults.chips, note:''}, true)
      + '<div class="formcard"><div class="section-title" style="margin:0 0 8px">Startspieler (jeder mit 1 Buy-In)</div>'
      +   '<div id="startList" class="chiplist"></div>'
      +   '<div class="addrow"><input id="newp" list="playerList" placeholder="Spieler hinzufügen …"><button id="addBtn">+ Hinzufügen</button></div>'
      + '</div>'
      + '<button class="btn" id="startBtn">▶ Abend jetzt starten</button>';
    bindPw();
    function renderChips(){
      document.getElementById('startList').innerHTML = start.length
        ? start.map(function(p,i){ return '<span class="chiptag">'+esc(p)+'<button data-rm="'+i+'">✕</button></span>'; }).join('')
        : '<span class="mini">Noch keine Spieler gewählt.</span>';
    }
    renderChips();
    document.getElementById('startList').addEventListener('click', function(e){
      var b=e.target.closest('[data-rm]'); if(!b)return; start.splice(Number(b.dataset.rm),1); renderChips();
    });
    function addStart(){ var inp=document.getElementById('newp'); var n=(inp.value||'').trim(); if(!n)return;
      if(start.indexOf(n)<0) start.push(n); inp.value=''; renderChips(); }
    document.getElementById('addBtn').addEventListener('click', addStart);
    document.getElementById('newp').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addStart(); } });
    document.getElementById('startBtn').addEventListener('click', function(){
      var game=readGameMeta(); if(!game) return;
      if(!start.length){ toast('Bitte mindestens einen Startspieler wählen.', true); return; }
      var btn=this; btn.disabled=true; btn.textContent='Starte …';
      post({ action:'startGame', game:game, players:start }, function(d){
        btn.disabled=false; btn.textContent='▶ Abend jetzt starten';
        if(!d) return;
        live = { id:d.id, game:game, log:d.log||[] };
        loadAll(function(){ go('#live/'+encodeURIComponent(d.id)); route(); });
      });
    });
  }

  // ==== Live-Runner (#live/<id>) =============================================
  function countsFromLog(log){
    var c={}; (log||[]).forEach(function(e){ if((e.type==='buyin'||e.type==='rebuy')&&e.player) c[e.player]=(c[e.player]||0)+1; }); return c;
  }
  function viewLiveRun(id){
    var g = S.gameDetail(id);
    if(!g || g.game.status!=='live'){
      // schon abgeschlossen oder unbekannt
      if(g){ go('#edit/'+encodeURIComponent(id)); return; }
      root.innerHTML = backlink('Live-Abend') + '<div class="state"><div class="errbox">Abend nicht gefunden.</div></div>'; return;
    }
    if(!live || live.id!==id) live = { id:id, game:g.game, log:g.log.slice() };
    var meta = g.game;
    root.innerHTML =
      (DEMO?demoNote():'')
      + backlink('Live-Abend läuft')
      + pwField() + datalist()
      + '<div class="formcard">'
      +   '<div class="livemeta">'
      +     (meta.location?'<span>🏠 '+esc(meta.location)+'</span>':'')
      +     '<span>💶 '+eur(meta.buyin)+' / '+Number(meta.chips).toLocaleString('de-DE')+'</span>'
      +     '<span>🕒 Start '+fmtTime(meta.startedAt)+' · <span class="liveclock" id="liveClock"></span></span>'
      +   '</div>'
      +   '<div class="playerchips" id="chips"></div>'
      +   '<div class="addrow" style="margin-top:10px"><input id="newp" list="playerList" placeholder="Spieler kommt dazu …"><button id="addBtn">+ Buy-In</button></div>'
      +   '<div class="minilog" id="minilog"></div>'
      + '</div>'
      + '<a class="btn" href="#finish/'+encodeURIComponent(id)+'">✅ Abend abschließen</a>';
    bindPw();
    renderChips(); renderMiniLog(); tickClock();
    clockTimer = setInterval(tickClock, 30000);

    document.getElementById('chips').addEventListener('click', function(e){
      var b=e.target.closest('button'); if(!b) return;
      var p=b.dataset.p;
      if(b.classList.contains('reb')) doBuy(p,'rebuy');
      else if(b.classList.contains('undo')) doUndo(p);
    });
    function addPlayer(){ var inp=document.getElementById('newp'); var n=(inp.value||'').trim(); if(!n)return; inp.value=''; doBuy(n,'buyin'); }
    document.getElementById('addBtn').addEventListener('click', addPlayer);
    document.getElementById('newp').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); addPlayer(); } });

    function renderChips(){
      var c=countsFromLog(live.log);
      var names=Object.keys(c).sort(function(a,b){ return a.localeCompare(b); });
      document.getElementById('chips').innerHTML = names.map(function(p){
        return '<div class="pchip"><span class="pnm">'+esc(p)+'</span>'
          + '<span class="cnt">'+c[p]+'× · '+eur(c[p]*meta.buyin)+'</span>'
          + '<button class="reb" data-p="'+esc(p)+'">+ Rebuy</button>'
          + '<button class="undo" data-p="'+esc(p)+'" title="letztes zurücknehmen">↶</button></div>';
      }).join('') || '<span class="mini">Noch keine Spieler.</span>';
    }
    function renderMiniLog(){
      var l=live.log.slice().reverse().slice(0,12);
      document.getElementById('minilog').innerHTML = '<ul class="timeline">'+l.map(function(e){
        var ic=e.type==='start'?'🟢':e.type==='rebuy'?'🔁':e.type==='buyin'?'🪙':e.type==='end'?'🔴':'📝';
        var tx=e.type==='start'?'Abend gestartet':e.type==='end'?'Abend beendet':esc(e.player)+' '+(e.type==='rebuy'?'Rebuy':'Buy-In');
        return '<li><span class="lt">'+fmtTime(e.ts)+'</span><span class="li-ic">'+ic+'</span><span class="lx">'+tx+'</span></li>';
      }).join('')+'</ul>';
    }
    function tickClock(){ var el=document.getElementById('liveClock'); if(el) el.textContent='läuft '+fmtDuration(meta.startedAt,null); }
    function doBuy(player,type){
      post({ action:'logBuy', id:id, player:player, type:type }, function(d){
        if(!d) return; live.log=d.log||live.log; renderChips(); renderMiniLog();
        toast((type==='rebuy'?'Rebuy':'Buy-In')+' für '+player+' geloggt ('+fmtTime(new Date().toISOString())+').');
      });
    }
    function doUndo(player){
      post({ action:'undoBuy', id:id, player:player }, function(d){
        if(!d) return; live.log=d.log||live.log; renderChips(); renderMiniLog(); toast('Zurückgenommen: '+player);
      });
    }
  }

  // ==== Live abschließen (#finish/<id>) ======================================
  function viewFinish(id){
    var g = S.gameDetail(id);
    if(!g){ root.innerHTML = backlink('Abschließen')+'<div class="state"><div class="errbox">Abend nicht gefunden.</div></div>'; return; }
    var meta=g.game, counts=g.buyinCounts;
    var names = Object.keys(counts);
    if(!names.length) names = g.players.slice();
    ed = { rows:names.map(function(p){ return {player:p, buyIns:counts[p]||1, finalChips:''}; }),
           buyin:meta.buyin||defaults.buyin, chips:meta.chips||defaults.chips };
    root.innerHTML =
      (DEMO?demoNote():'')
      + backlink('Abend abschließen · '+fmtDate(meta.date))
      + pwField() + datalist()
      + '<div class="formcard"><div class="livemeta">'
      +   (meta.location?'<span>🏠 '+esc(meta.location)+'</span>':'')
      +   '<span>🕒 Start '+fmtTime(meta.startedAt)+'</span>'
      +   '<div class="row2" style="width:100%;margin-top:8px">'
      +     '<div><label>Buy-In (€)</label><input id="buyin" type="number" step="0.5" value="'+meta.buyin+'"></div>'
      +     '<div><label>Chips / Buy-In</label><input id="chips" type="number" step="1000" value="'+meta.chips+'"></div>'
      +   '</div>'
      + '</div></div>'
      + '<p class="mini" style="margin:0 4px 8px">Buy-Ins sind aus dem Live-Log vorbefüllt. Trage die End-Chips jedes Spielers ein.</p>'
      + editorTable()
      + '<button class="btn" id="finBtn">✅ Abschließen &amp; speichern</button>';
    bindPw(); buildRows(); bindEditor();
    document.getElementById('finBtn').addEventListener('click', function(){
      var results=collectResults(); if(!results.length){ toast('Keine Ergebnisse.', true); return; }
      var btn=this; btn.disabled=true; btn.textContent='Speichere …';
      post({ action:'finishGame', id:id, game:{ buyin:num('buyin',meta.buyin), chips:num('chips',meta.chips) }, results:results }, function(d){
        btn.disabled=false; btn.textContent='✅ Abschließen & speichern';
        if(!d) return; live=null;
        var bal = Math.abs(Number(d.balance||0))<0.01?'':' (Bilanz-Differenz '+eur(d.balance)+')';
        toast('✓ Abend abgeschlossen: '+d.saved+' Spieler'+bal+'.');
        setTimeout(function(){ location.href='index.html#game/'+encodeURIComponent(id); }, 1200);
      });
    });
  }

  // ==== Abend bearbeiten (#edit/<id>) ========================================
  function viewEdit(id){
    var g = S.gameDetail(id);
    if(!g){ root.innerHTML = backlink('Bearbeiten')+'<div class="state"><div class="errbox">Abend nicht gefunden.</div></div>'; return; }
    if(g.game.status==='live'){ go('#live/'+encodeURIComponent(id)); return; }
    var meta=g.game;
    ed = { rows:g.results.map(function(r){ return {player:r.player, buyIns:(r.buyIns==null?'':r.buyIns), finalChips:(r.finalChips==null?'':r.finalChips)}; }),
           buyin:meta.buyin||defaults.buyin, chips:meta.chips||defaults.chips };
    if(!ed.rows.length) ed.rows=[{player:'',buyIns:1,finalChips:''}];
    root.innerHTML =
      (DEMO?demoNote():'')
      + backlink('Abend bearbeiten')
      + pwField() + datalist()
      + gameMetaCard({date:meta.date, location:meta.location, buyin:meta.buyin, chips:meta.chips, note:meta.note}, true)
      + editorTable()
      + '<button class="btn" id="saveBtn">💾 Änderungen speichern</button>'
      + '<button class="btn danger" id="delBtn">🗑 Abend löschen</button>';
    bindPw(); buildRows(); bindEditor();
    document.getElementById('saveBtn').addEventListener('click', function(){
      var game=readGameMeta(); if(!game) return;
      var results=collectResults(); if(!results.length){ toast('Keine Ergebnisse eingetragen.', true); return; }
      var btn=this; btn.disabled=true; btn.textContent='Speichere …';
      post({ action:'editGame', id:id, game:game, results:results }, function(d){
        btn.disabled=false; btn.textContent='💾 Änderungen speichern';
        if(!d) return;
        var bal=Math.abs(Number(d.balance||0))<0.01?'':' (Bilanz-Differenz '+eur(d.balance)+')';
        toast('✓ Gespeichert'+bal+'.');
        setTimeout(function(){ location.href='index.html#game/'+encodeURIComponent(id); }, 1200);
      });
    });
    document.getElementById('delBtn').addEventListener('click', function(){ delGame(id); });
  }

  // ---- geteilte Bausteine ---------------------------------------------------
  function gameMetaCard(g, withNote){
    return '<div class="formcard">'
      + '<div class="row2">'
      +   '<div><label>Datum</label><input id="date" type="date" value="'+esc(g.date||today())+'"></div>'
      +   '<div><label>Gastgeber / Ort</label><input id="loc" list="playerList" placeholder="z.B. Michi" value="'+esc(g.location||'')+'"></div>'
      + '</div>'
      + '<div class="row2">'
      +   '<div><label>Buy-In (€)</label><input id="buyin" type="number" step="0.5" value="'+(g.buyin||defaults.buyin)+'"></div>'
      +   '<div><label>Chips / Buy-In</label><input id="chips" type="number" step="1000" value="'+(g.chips||defaults.chips)+'"></div>'
      + '</div>'
      + (withNote?'<label>Notiz (optional)</label><input id="note" type="text" value="'+esc(g.note||'')+'" placeholder="z.B. Turniermodus">':'')
      + '</div>';
  }
  function readGameMeta(){
    var date=document.getElementById('date').value;
    if(!date){ toast('Bitte Datum wählen.', true); return null; }
    var noteEl=document.getElementById('note');
    return { date:date, location:(document.getElementById('loc').value||'').trim(),
             buyin:num('buyin',defaults.buyin), chips:num('chips',defaults.chips),
             note:noteEl?noteEl.value.trim():'' };
  }
  function backlink(title){ return '<div class="crumb"><a href="#">← Übersicht</a><span class="ctitle">'+esc(title)+'</span></div>'; }
  function afterSave(d){
    var bal=Math.abs(Number(d.balance||0))<0.01?'':' (Bilanz-Differenz '+eur(d.balance)+')';
    toast('✓ Gespeichert: '+d.saved+' Spieler'+bal+'.');
    setTimeout(function(){ location.href='index.html#game/'+encodeURIComponent(d.id); }, 1200);
  }

  boot();
})();
