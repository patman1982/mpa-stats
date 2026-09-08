/**
 * MPA – Challenge Everything · Backend (Deno Deploy + Deno KV)
 * ===========================================================
 * Ersetzt das langsame Google-Apps-Script. Schnelle Edge-API mit CORS.
 *
 * Datenmodell in Deno KV (jeweils klein < 64 KiB):
 *   ["meta"]                -> { currentYear, defaultBuyin, defaultChips }
 *   ["legacyTotals"]        -> Array (eingefrorene Jahres-Summen)
 *   ["champions"]           -> Array (Hall of Fame)
 *   ["players"]             -> Array (Spieler-Meta)
 *   ["game", <id>]          -> Game-Objekt
 *   ["results", <id>]       -> Array der Ergebnisse dieses Abends
 *   ["log", <id>]           -> Array der Log-Einträge dieses Abends
 *
 * GET  /            -> gesamter Datensatz als JSON (mit ?callback= auch JSONP)
 * POST /            -> Schreib-Aktionen (Passwort im Body), gleiche Shapes wie zuvor
 *
 * Einrichtung auf Deno Deploy:
 *   - Projekt aus diesem Repo, Entry Point: deno/main.ts
 *   - Umgebungsvariable  ADMIN_PASSWORD = <dein-passwort>
 *   - KV wird automatisch bereitgestellt (kein Setup nötig)
 * Beim ersten Start wird die Datenbank einmalig aus deno/seed.json befüllt.
 */
import seed from "./seed.json" with { type: "json" };

// Auf Deno Deploy: verwaltete KV (kein Pfad). Lokal optional über MPA_KV_PATH isolierbar.
const kv = await Deno.openKv(Deno.env.get("MPA_KV_PATH") || undefined);
const DEFAULT_BUYIN = 5;
const DEFAULT_CHIPS = 10000;
const CURRENT_YEAR_DEFAULT = 2026;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---- Helfer ----------------------------------------------------------------
const round2 = (n: number) => Math.round(Number(n) * 100) / 100;
function yearOf(dateStr: string): number {
  const m = String(dateStr).match(/(20\d\d)/);
  if (m) return Number(m[1]);
  const y = new Date(dateStr).getFullYear();
  return y || CURRENT_YEAR_DEFAULT;
}

type Result = { player: string; buyIns: number | string; finalChips: number | string; payout: number | string; result: number };
type Game = Record<string, unknown> & { id: string; date: string; year: number };

function computeResults(results: any[], buyin: number, chips: number) {
  const chipValue = chips ? buyin / chips : 0;
  let totalPot = 0, totalPayout = 0;
  const clean: Result[] = [];
  for (const r of results) {
    const name = String(r.player || "").trim();
    if (!name) continue;
    const buyIns = Number(r.buyIns || 0);
    const finalChips = Number(r.finalChips || 0);
    const payout = finalChips * chipValue;
    const result = payout - buyIns * buyin;
    totalPot += buyIns * buyin;
    totalPayout += payout;
    clean.push({ player: name, buyIns, finalChips, payout: round2(payout), result: round2(result) });
  }
  return { clean, totalPot, totalPayout, balance: totalPayout - totalPot };
}

async function getGame(id: string): Promise<Game | null> {
  return (await kv.get<Game>(["game", id])).value;
}
async function getResults(id: string): Promise<Result[]> {
  return (await kv.get<Result[]>(["results", id])).value ?? [];
}
async function getLog(id: string): Promise<any[]> {
  return (await kv.get<any[]>(["log", id])).value ?? [];
}
async function getMeta() {
  const m = (await kv.get<any>(["meta"])).value ?? {};
  return {
    currentYear: Number(m.currentYear || CURRENT_YEAR_DEFAULT),
    defaultBuyin: Number(m.defaultBuyin || DEFAULT_BUYIN),
    defaultChips: Number(m.defaultChips || DEFAULT_CHIPS),
  };
}
function buyinCounts(log: any[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const e of log) {
    if ((e.type === "buyin" || e.type === "rebuy") && e.player) c[e.player] = (c[e.player] || 0) + 1;
  }
  return c;
}

// ---- Einmaliges Seeding ----------------------------------------------------
async function ensureSeeded() {
  if ((await kv.get(["seeded"])).value) return;
  const s: any = seed;
  await kv.set(["meta"], {
    currentYear: s.currentYear || CURRENT_YEAR_DEFAULT,
    defaultBuyin: s.defaultBuyin || DEFAULT_BUYIN,
    defaultChips: s.defaultChips || DEFAULT_CHIPS,
  });
  await kv.set(["legacyTotals"], s.legacyTotals || []);
  await kv.set(["champions"], s.champions || []);
  await kv.set(["players"], s.players || []);

  // Ergebnisse & Log nach gameId gruppieren
  const resByGame: Record<string, any[]> = {};
  for (const r of (s.results || [])) (resByGame[r.gameId] ??= []).push(r);
  const logByGame: Record<string, any[]> = {};
  for (const e of (s.log || [])) (logByGame[e.gameId] ??= []).push(e);

  // In Blöcken schreiben (Deno KV: max ~1000 Mutationen / 800 KB pro atomic)
  const muts: { key: Deno.KvKey; val: unknown }[] = [];
  for (const g of (s.games || [])) {
    muts.push({ key: ["game", g.id], val: g });
    muts.push({ key: ["results", g.id], val: resByGame[g.id] || [] });
    if (logByGame[g.id]) muts.push({ key: ["log", g.id], val: logByGame[g.id] });
  }
  for (let i = 0; i < muts.length; i += 100) {
    let a = kv.atomic();
    for (const m of muts.slice(i, i + 100)) a = a.set(m.key, m.val);
    await a.commit();
  }
  await kv.set(["seeded"], true);
}

// ---- Daten lesen -----------------------------------------------------------
async function getAllData() {
  const meta = await getMeta();
  const games: any[] = [];
  const results: any[] = [];
  const log: any[] = [];
  for await (const e of kv.list<any>({ prefix: ["game"] })) games.push(e.value);
  for await (const e of kv.list<any[]>({ prefix: ["results"] })) for (const r of e.value) results.push(r);
  for await (const e of kv.list<any[]>({ prefix: ["log"] })) for (const l of e.value) log.push(l);
  const legacyTotals = (await kv.get<any[]>(["legacyTotals"])).value ?? [];
  const champions = (await kv.get<any[]>(["champions"])).value ?? [];
  const players = (await kv.get<any[]>(["players"])).value ?? [];
  return {
    ok: true,
    updated: new Date().toISOString(),
    currentYear: meta.currentYear,
    defaultBuyin: meta.defaultBuyin,
    defaultChips: meta.defaultChips,
    games, results, legacyTotals, champions, players, log,
  };
}

// ---- Schreib-Aktionen ------------------------------------------------------
async function addGame(body: any) {
  const g = body.game || {};
  const results = body.results || [];
  if (!g.date) return { ok: false, error: "Datum fehlt." };
  if (!results.length) return { ok: false, error: "Keine Spieler-Ergebnisse." };
  const buyin = Number(g.buyin || DEFAULT_BUYIN);
  const chips = Number(g.chips || DEFAULT_CHIPS);
  const calc = computeResults(results, buyin, chips);
  const id = "G" + Date.now();
  const game = {
    id, date: g.date, year: yearOf(g.date), location: g.location || "",
    buyin, chips, pot: round2(calc.totalPot), note: g.note || "",
    createdAt: new Date().toISOString(), status: "done", startedAt: "", endedAt: "",
  };
  await kv.atomic()
    .set(["game", id], game)
    .set(["results", id], calc.clean.map((r) => ({ gameId: id, ...r })))
    .commit();
  return { ok: true, id, balance: round2(calc.balance), saved: calc.clean.length };
}

async function editGame(body: any) {
  const id = body.id;
  const g = body.game || {};
  const results = body.results || [];
  if (!id) return { ok: false, error: "Keine Spiel-ID." };
  const game = await getGame(id);
  if (!game) return { ok: false, error: "Abend nicht gefunden." };
  if (!results.length) return { ok: false, error: "Keine Spieler-Ergebnisse." };
  const buyin = Number(g.buyin || DEFAULT_BUYIN);
  const chips = Number(g.chips || DEFAULT_CHIPS);
  const calc = computeResults(results, buyin, chips);
  const upd = {
    ...game, date: g.date, year: yearOf(g.date), location: g.location || "",
    buyin, chips, pot: round2(calc.totalPot), note: g.note || "",
  };
  await kv.atomic()
    .set(["game", id], upd)
    .set(["results", id], calc.clean.map((r) => ({ gameId: id, ...r })))
    .commit();
  return { ok: true, id, balance: round2(calc.balance), saved: calc.clean.length };
}

async function deleteGame(body: any) {
  const id = body.id;
  if (!id) return { ok: false, error: "Keine Spiel-ID." };
  await kv.atomic().delete(["game", id]).delete(["results", id]).delete(["log", id]).commit();
  return { ok: true, deleted: id };
}

async function startGame(body: any) {
  const g = body.game || {};
  const players: string[] = (body.players || []).map((p: any) => String(p || "").trim()).filter(Boolean);
  if (!g.date) return { ok: false, error: "Datum fehlt." };
  if (!players.length) return { ok: false, error: "Keine Startspieler." };
  const buyin = Number(g.buyin || DEFAULT_BUYIN);
  const chips = Number(g.chips || DEFAULT_CHIPS);
  const id = "G" + Date.now();
  const now = new Date().toISOString();
  const game = {
    id, date: g.date, year: yearOf(g.date), location: g.location || "",
    buyin, chips, pot: "", note: g.note || "",
    createdAt: now, status: "live", startedAt: now, endedAt: "",
  };
  const log: any[] = [{ gameId: id, ts: now, type: "start", player: "", info: "Abend gestartet" }];
  for (const p of players) log.push({ gameId: id, ts: now, type: "buyin", player: p, info: "" });
  await kv.atomic().set(["game", id], game).set(["log", id], log).set(["results", id], []).commit();
  return { ok: true, id, startedAt: now, log };
}

async function logBuy(body: any) {
  const id = body.id;
  const player = String(body.player || "").trim();
  const type = body.type === "buyin" ? "buyin" : "rebuy";
  if (!id) return { ok: false, error: "Keine Spiel-ID." };
  if (!player) return { ok: false, error: "Kein Spieler." };
  if (!(await getGame(id))) return { ok: false, error: "Abend nicht gefunden." };
  const log = await getLog(id);
  log.push({ gameId: id, ts: new Date().toISOString(), type, player, info: "" });
  await kv.set(["log", id], log);
  return { ok: true, id, log };
}

async function undoBuy(body: any) {
  const id = body.id;
  const player = String(body.player || "").trim();
  if (!id) return { ok: false, error: "Keine Spiel-ID." };
  const log = await getLog(id);
  for (let i = log.length - 1; i >= 0; i--) {
    if (player && String(log[i].player).trim() !== player) continue;
    if (log[i].type === "rebuy" || log[i].type === "buyin") { log.splice(i, 1); break; }
  }
  await kv.set(["log", id], log);
  return { ok: true, id, log };
}

async function finishGame(body: any) {
  const id = body.id;
  const results = body.results || [];
  if (!id) return { ok: false, error: "Keine Spiel-ID." };
  const game = await getGame(id);
  if (!game) return { ok: false, error: "Abend nicht gefunden." };
  if (!results.length) return { ok: false, error: "Keine Ergebnisse." };
  const log = await getLog(id);
  const counts = buyinCounts(log);
  const buyin = Number((body.game && body.game.buyin) || game.buyin || DEFAULT_BUYIN);
  const chips = Number((body.game && body.game.chips) || game.chips || DEFAULT_CHIPS);
  const enriched = results.map((r: any) => {
    const name = String(r.player || "").trim();
    const b = (r.buyIns === "" || r.buyIns == null) ? (counts[name] || 1) : Number(r.buyIns);
    return { player: name, buyIns: b, finalChips: Number(r.finalChips || 0) };
  });
  const calc = computeResults(enriched, buyin, chips);
  const now = new Date().toISOString();
  const upd: any = { ...game, buyin, chips, pot: round2(calc.totalPot), status: "done", endedAt: now };
  if (body.game) {
    if (body.game.date) { upd.date = body.game.date; upd.year = yearOf(body.game.date); }
    if (body.game.location != null) upd.location = body.game.location;
    if (body.game.note != null) upd.note = body.game.note;
  }
  log.push({ gameId: id, ts: now, type: "end", player: "", info: "Abend beendet" });
  await kv.atomic()
    .set(["game", id], upd)
    .set(["results", id], calc.clean.map((r) => ({ gameId: id, ...r })))
    .set(["log", id], log)
    .commit();
  return { ok: true, id, balance: round2(calc.balance), saved: calc.clean.length };
}

async function closeYear(body: any) {
  const year = Number(body.year);
  if (!year) return { ok: false, error: "Jahr fehlt." };
  const data = await getAllData();
  const gy: Record<string, number> = {};
  for (const g of data.games) gy[g.id] = Number(g.year);
  const totals: Record<string, number> = {};
  for (const r of data.results) {
    if (gy[r.gameId] !== year) continue;
    totals[r.player] = (totals[r.player] || 0) + Number(r.result || 0);
  }
  const legacy = (await kv.get<any[]>(["legacyTotals"])).value ?? [];
  for (const p of Object.keys(totals)) legacy.push({ player: p, year, total: round2(totals[p]) });
  await kv.set(["legacyTotals"], legacy);
  const meta = await getMeta();
  await kv.set(["meta"], { ...meta, currentYear: year + 1 });
  return { ok: true, frozen: year, players: Object.keys(totals).length };
}

// ---- HTTP ------------------------------------------------------------------
function checkPassword(pw: unknown): boolean {
  const real = Deno.env.get("ADMIN_PASSWORD");
  return !!real && !!pw && String(pw) === String(real);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  await ensureSeeded();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const data = await getAllData();
    const cb = url.searchParams.get("callback");
    if (cb) {
      return new Response(`${cb}(${JSON.stringify(data)})`, {
        headers: { ...CORS, "Content-Type": "application/javascript; charset=utf-8" },
      });
    }
    return Response.json(data, { headers: CORS });
  }

  if (req.method === "POST") {
    let res: any = { ok: false };
    try {
      const body = JSON.parse(await req.text() || "{}");
      if (!checkPassword(body.password)) {
        res.error = "Falsches Passwort.";
      } else {
        switch (body.action) {
          case "addGame": res = await addGame(body); break;
          case "editGame": res = await editGame(body); break;
          case "deleteGame": res = await deleteGame(body); break;
          case "startGame": res = await startGame(body); break;
          case "logBuy": res = await logBuy(body); break;
          case "undoBuy": res = await undoBuy(body); break;
          case "finishGame": res = await finishGame(body); break;
          case "closeYear": res = await closeYear(body); break;
          default: res.error = "Unbekannte Aktion: " + body.action;
        }
      }
    } catch (err) {
      res = { ok: false, error: String(err) };
    }
    return Response.json(res, { headers: CORS });
  }

  return new Response("Method not allowed", { status: 405, headers: CORS });
});
