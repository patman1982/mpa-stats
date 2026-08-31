/* MPA – Admin: Pokerabend eintragen. Rechnet live (Poker-calc-Logik),
   schreibt via Apps-Script POST ins Google Sheet. */
(function () {
  'use strict';
  var cfg = window.MPA_CONFIG || {};
  var root = document.getElementById('admin');
  var eur = MPA.eur;
  var API = cfg.API_URL || '';
  var DEMO = !API || /PASTE_YOUR/.test(API);
  var state = { players: [], buyin: 5, chips: 10000, rows: [] };

  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function pw(){ try { return localStorage.getItem('mpa_pw') || ''; } catch(e){ return ''; } }
  function setPw(v){ try { localStorage.setItem('mpa_pw', v); } catch(e){} }
  function today(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }

  function boot(){
    // Spielerliste + Defaults laden
    if (DEMO) { fill(window.MPA_SAMPLE); return; }
    MPA.loadData(API, fill, function(){ fill(null); });
    function fill(d){
      if(d){
        state.buyin = Number(d.defaultBuyin)||5;
        state.chips = Number(d.defaultChips)||10000;
        var names = {};
        (d.players||[]).forEach(function(p){ names[String(p.player).trim()]=1; });
        (d.results||[]).forEach(function(r){ names[String(r.player).trim()]=1; });
        (d.legacyTotals||[]).forEach(function(r){ names[String(r.player).trim()]=1; });
        state.players = Object.keys(names).filter(Boolean).sort();
        // Stammspieler vorbelegen
        state.freq = (d.players||[]).filter(function(p){ return p.freq===true||String(p.freq).toLowerCase()==='true'||p.freq==='freq'; })
          .map(function(p){ return String(p.player).trim(); });
      }
      render();
    }
  }

  function render(){
    var opts = state.players.map(function(p){ return '<option value="'+esc(p)+'">'; }).join('');
    root.innerHTML =
      (DEMO ? '<div class="state"><div class="errbox" style="background:rgba(231,193,76,.12);border-color:var(--gold);color:#f6e6ad">🔧 Vorschaumodus – ohne API-URL wird nichts gespeichert. Trage die URL in <b>assets/config.js</b> ein.</div></div>' : '')
      + '<datalist id="playerList">'+opts+'</datalist>'
      + '<div class="formcard">'
      + '<label>Admin-Passwort</label>'
      + '<input id="pw" type="password" placeholder="Passwort" value="'+esc(pw())+'" autocomplete="current-password">'
      + '<div class="row2">'
      +   '<div><label>Datum</label><input id="date" type="date" value="'+today()+'"></div>'
      +   '<div><label>Gastgeber / Ort</label><input id="loc" list="playerList" placeholder="z.B. Michi"></div>'
      + '</div>'
      + '<div class="row2">'
      +   '<div><label>Buy-In (€)</label><input id="buyin" type="number" step="0.5" value="'+state.buyin+'"></div>'
      +   '<div><label>Chips / Buy-In</label><input id="chips" type="number" step="1000" value="'+state.chips+'"></div>'
      + '</div>'
      + '</div>'

      + '<div class="formcard">'
      + '<div class="section-title" style="margin:0 0 8px">Ergebnisse des Abends</div>'
      + '<table class="ptable"><colgroup><col style="width:36%"><col style="width:18%"><col style="width:22%"><col style="width:18%"><col style="width:6%"></colgroup>'
      + '<thead><tr><th style="text-align:left">Spieler</th><th>Buy-Ins</th><th>Chips</th><th>Ergebnis</th><th></th></tr></thead>'
      + '<tbody id="pbody"></tbody></table>'
      + '<div class="addrow"><input id="newp" list="playerList" placeholder="Spieler hinzufügen …"><button id="addBtn">+ Hinzufügen</button></div>'
      + '<div id="balance" class="balance ok">Bilanz: 0 €</div>'
      + '<button class="btn" id="saveBtn">💾 Abend speichern</button>'
      + '</div>';

    // Defaults: Stammspieler-Zeilen
    state.rows = (state.freq && state.freq.length ? state.freq : state.players.slice(0,8)).map(function(p){
      return { player:p, buyIns:1, finalChips:'' };
    });
    buildRows();
    bind();
  }

  // Voll-Render (nur bei Zeile hinzufügen/entfernen nötig)
  function buildRows(){
    var tb = document.getElementById('pbody');
    tb.innerHTML = state.rows.map(function(r,i){
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

  // Nur Ergebnisse + Bilanz neu rechnen (kein Neuaufbau -> kein Cursor-Sprung)
  function updateComputed(){
    var buyin = num('buyin', state.buyin), chips = num('chips', state.chips);
    var chipVal = chips ? buyin/chips : 0;
    state.rows.forEach(function(r,i){
      var res = (Number(r.finalChips)||0)*chipVal - (Number(r.buyIns)||0)*buyin;
      res = Math.round(res*100)/100;
      var el = document.querySelector('[data-res="'+i+'"]');
      if(el){ el.value = (res>0?'+':'')+res; el.className = 'res '+(res>0?'pos':res<0?'neg':'zero'); }
    });
    updateBalance();
  }

  function updateBalance(){
    var buyin = num('buyin', state.buyin), chips = num('chips', state.chips);
    var chipVal = chips ? buyin/chips : 0;
    var pot=0, pay=0, totalChips=0;
    state.rows.forEach(function(r){
      pot += (Number(r.buyIns)||0)*buyin;
      pay += (Number(r.finalChips)||0)*chipVal;
      totalChips += (Number(r.finalChips)||0);
    });
    var diff = Math.round((pay-pot)*100)/100;
    var el = document.getElementById('balance');
    if(!el) return;
    var expChips = chips ? Math.round(pot/buyin*chips) : 0;
    if(Math.abs(diff) < 0.01){
      el.className='balance ok';
      el.innerHTML='✓ Bilanz stimmt · Pot '+eur(pot)+' · Chips '+totalChips.toLocaleString('de-DE')+' / '+expChips.toLocaleString('de-DE');
    } else {
      el.className='balance bad';
      el.innerHTML='⚠ Differenz '+(diff>0?'+':'')+eur(diff)+' · Chips '+totalChips.toLocaleString('de-DE')+' erwartet '+expChips.toLocaleString('de-DE')+' (End-Chips prüfen)';
    }
  }

  function num(id, def){ var e=document.getElementById(id); var n=e?Number(e.value):NaN; return isFinite(n)?n:def; }

  function bind(){
    document.getElementById('pbody').addEventListener('input', function(e){
      var t=e.target, i=t.dataset.i, k=t.dataset.k; if(i==null)return;
      state.rows[i][k] = t.value;
      updateComputed(); // nur rechnen, Felder bleiben stehen
    });
    document.getElementById('pbody').addEventListener('click', function(e){
      var rm=e.target.closest('[data-rm]'); if(!rm)return;
      state.rows.splice(Number(rm.dataset.rm),1); buildRows();
    });
    document.getElementById('addBtn').addEventListener('click', function(){
      var inp=document.getElementById('newp'); var name=(inp.value||'').trim();
      if(!name) return;
      state.rows.push({player:name,buyIns:1,finalChips:''}); inp.value=''; buildRows();
    });
    document.getElementById('newp').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); document.getElementById('addBtn').click(); } });
    ['buyin','chips'].forEach(function(id){ document.getElementById(id).addEventListener('input', updateComputed); });
    document.getElementById('saveBtn').addEventListener('click', save);
  }

  function save(){
    var btn=document.getElementById('saveBtn');
    var password=document.getElementById('pw').value.trim();
    if(!password){ toast('Bitte Passwort eingeben.', true); return; }
    var results = state.rows
      .filter(function(r){ return String(r.player).trim() && (r.finalChips!==''||r.buyIns!==''); })
      .map(function(r){ return { player:String(r.player).trim(), buyIns:Number(r.buyIns)||0, finalChips:Number(r.finalChips)||0 }; });
    if(!results.length){ toast('Keine Ergebnisse eingetragen.', true); return; }
    var game = {
      date: document.getElementById('date').value,
      location: document.getElementById('loc').value.trim(),
      buyin: num('buyin', state.buyin), chips: num('chips', state.chips)
    };
    if(!game.date){ toast('Bitte Datum wählen.', true); return; }
    setPw(password);

    if(DEMO){ toast('Vorschaumodus – nicht gespeichert. (API-URL fehlt in config.js)', true); return; }

    btn.disabled=true; btn.textContent='Speichere …';
    // text/plain vermeidet CORS-Preflight bei Apps Script
    fetch(API, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({ password:password, action:'addGame', game:game, results:results }) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        btn.disabled=false; btn.textContent='💾 Abend speichern';
        if(!d.ok){ toast(d.error||'Fehler beim Speichern.', true); return; }
        var bal = Math.abs(Number(d.balance||0))<0.01 ? '' : ' (Bilanz-Differenz '+eur(d.balance)+')';
        toast('✓ Gespeichert: '+d.saved+' Spieler'+bal+'. → zur Statistik');
        setTimeout(function(){ location.href='index.html'; }, 1600);
      })
      .catch(function(err){
        btn.disabled=false; btn.textContent='💾 Abend speichern';
        toast('Netzwerkfehler: '+err.message, true);
      });
  }

  var toastTimer;
  function toast(msg, err){
    var el=document.querySelector('.toast'); if(el) el.remove();
    el=document.createElement('div'); el.className='toast'+(err?' err':''); el.textContent=msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer); toastTimer=setTimeout(function(){ el.remove(); }, err?4000:2500);
  }

  boot();
})();
