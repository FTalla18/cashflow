// App controller: lobby, local (pass-and-play) games, hosting and joining online games.
import { newGame, apply, current, actor, GameError, MAX_PLAYERS } from "./engine.js";
import { renderGame, renderBoard, statementHTML, showDice, renderTimer } from "./ui.js";
import { setTaxTables, bestTaxYear } from "./tax.js";
import { initCoach, openCoach } from "./coach.js";
import { sfx, soundFor, toggleMute, isMuted } from "./sound.js";
import { hostRoom, joinRoom } from "./net.js";

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
// One ID per browser tab (kept across refreshes, so a dropped player can rejoin their seat).
const clientKey = (() => {
  const fromUrl = new URLSearchParams(location.search).get("key"); // used by the automated tests
  if (fromUrl) return fromUrl;
  try { let k = sessionStorage.getItem("cf.key"); if (!k) { k = crypto.getRandomValues(new Uint32Array(2)).join("-"); sessionStorage.setItem("cf.key", k); } return k; }
  catch { return crypto.getRandomValues(new Uint32Array(2)).join("-"); }
})();

const app = {
  mode: null,          // "local" | "host" | "guest"
  game: null,
  localIds: new Set(), // players controlled on this device
  viewerId: null,
  online: null,        // Set of connected player ids (online games)
  code: null,
  net: null,
  lobby: [],           // host: [{ id, name }]
  stmtFor: null,
};

// ------------------------------------------------------------------ helpers
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}
function show(screen) {
  $("lobby").hidden = screen !== "lobby";
  $("game").hidden = screen !== "game";
  $("saveBtn").hidden = screen !== "game";
}
function newSeed() { return crypto.getRandomValues(new Uint32Array(2)).join("-"); }

// Tax tables: the newest IRS tables (auto-updated by a GitHub Action) load at startup; the 2026 table is built in as a fallback.
const taxReady = fetch("js/data/tax-tables.json", { cache: "no-cache" }).then((r) => r.json()).then(setTaxTables).catch(() => {});
async function makeGame(players, length) {
  await taxReady;
  return newGame({ seed: newSeed(), players, length, taxYear: bestTaxYear(new Date().getFullYear()) });
}

// ------------------------------------------------------------------ turn timer (online games, run by the host)
// The host auto-plays for whoever is up when time runs out: roll, take a small deal, pass, end the turn.
// Offline players are auto-skipped after a short grace period even with the timer off.
const GRACE = 20;
const timer = { limit: 0, deadline: null, key: null, offline: false, autoTurn: null, guestDeadline: null };
function armTimer() {
  const g = app.game;
  if (app.mode !== "host" || !g || g.winner) { timer.deadline = null; return; }
  const a = actor(g), off = !app.online.has(a.id);
  const key = `${g.round}:${g.turn}:${g.phase}:${a.id}`;
  if (key === timer.key && off === timer.offline) return;
  timer.key = key; timer.offline = off;
  const turnKey = `${g.round}:${g.turn}`;
  const secs = off ? (timer.autoTurn === turnKey ? 2 : GRACE) : timer.limit;
  timer.deadline = secs ? Date.now() + secs * 1000 : null;
}
function autoAct() {
  const g = app.game, a = actor(g);
  const card = g.phase === "share" ? null : g.card;
  const action = g.phase === "roll" ? { type: "ROLL" } : g.phase === "choose" ? { type: "DEAL", size: "small" } : g.phase === "manage" ? { type: "END_TURN" } : { type: "PASS" };
  if (g.phase === "decide" && card && card.type === "offer") action.type = "PASS";
  timer.autoTurn = `${g.round}:${g.turn}`;
  try { setGame(apply(g, { ...action, by: a.id })); broadcastState(); toast(`⏱ Time's up: auto-played for ${a.name}`); }
  catch (e) { console.warn("auto-act failed", e); setGame(apply(g, { type: "END_TURN", by: current(g).id })); broadcastState(); }
}
app.timeLeft = () => {
  const d = app.mode === "host" ? timer.deadline : app.mode === "guest" ? timer.guestDeadline : null;
  return d ? (d - Date.now()) / 1000 : null;
};
setInterval(() => {
  if (!app.game) return;
  renderTimer(app);
  if (app.mode === "host" && timer.deadline && Date.now() >= timer.deadline && !app.game.winner) { timer.deadline = null; autoAct(); }
}, 500);

let animating = null;
function playSounds(entries) {
  const seen = new Set();
  entries.forEach((l, i) => { const f = soundFor(l); if (f && !seen.has(f)) { seen.add(f); setTimeout(f, i * 140); } });
}
function setGame(next) {
  const prev = app.game;
  const prevSeq = prev ? prev.seq : -1;
  const lastN = prev && prev.log.length ? prev.log[prev.log.length - 1].n : 0;
  app.game = next;
  if (app.mode === "local") app.viewerId = actor(next).id;
  armTimer();
  show("game");
  renderGame(app);
  if (next.dice && next.seq !== prevSeq) showDice(next.dice);
  // Hop the moving token tile by tile, then play the sounds for what happened.
  const same = prev && prev.seed === next.seed;
  const fresh = same ? next.log.filter((l) => l.n > lastN) : [];
  const mover = same ? next.players.find((p) => { const q = prev.players.find((x) => x.id === p.id); return q && q.pos !== p.pos; }) : null;
  if (mover && fresh.some((l) => l.key === "roll")) {
    const from = prev.players.find((x) => x.id === mover.id).pos;
    const steps = (mover.pos - from + 81) % 81;
    const stepMs = Math.min(150, 1500 / Math.max(steps, 1));
    sfx.dice();
    clearInterval(animating);
    let k = 0;
    renderBoard(next, { [mover.id]: from });
    animating = setInterval(() => {
      k++;
      renderBoard(app.game, { [mover.id]: (from + k) % 81 });
      sfx.step();
      if (k >= steps) { clearInterval(animating); animating = null; renderBoard(app.game); setTimeout(() => playSounds(fresh.filter((l) => l.key !== "roll")), 120); }
    }, stepMs);
  } else playSounds(fresh);
  if ($("stmtDialog").open && app.stmtFor) openStatement(app.stmtFor, true);
  if (app.mode === "local" || app.mode === "host") autosave();
}

// ------------------------------------------------------------------ saved games
// Every move autosaves (local and hosted games). The last 8 games are kept in this browser, and any
// save can be downloaded as a file to continue on another device.
const MAX_SAVES = 8;
const saves = () => { const list = store.get("cf.saves", []); return Array.isArray(list) ? list : []; };
function snapshot() {
  return { v: 1, id: app.game.seed, mode: app.mode, savedAt: Date.now(), code: app.code, timer: timer.limit,
    lobby: app.mode === "host" ? app.lobby : null, game: app.game };
}
function autosave() {
  if (!app.game) return;
  const list = saves().filter((x) => x.id !== app.game.seed);
  list.unshift(snapshot());
  while (list.length > MAX_SAVES) list.pop();
  try { localStorage.setItem("cf.saves", JSON.stringify(list)); }
  catch { // storage full: keep fewer old games
    try { localStorage.setItem("cf.saves", JSON.stringify(list.slice(0, 3))); } catch {}
  }
}
function validSave(x) {
  return x && x.game && Array.isArray(x.game.players) && x.game.players.length && x.game.seed && Array.isArray(x.game.board) && (x.mode === "local" || x.mode === "host");
}
function resumeSave(sv) {
  if (!validSave(sv)) { toast("That save file doesn't look like a CashFlow game."); return; }
  if (sv.mode === "host") { host(sv); return; }
  app.mode = "local"; app.code = null; app.online = null;
  app.localIds = new Set(sv.game.players.map((p) => p.id));
  setGame(sv.game);
  toast(`Welcome back! Round ${sv.game.round} 🎲`);
}
function downloadSave(sv) {
  const blob = new Blob([JSON.stringify(sv)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cashflow-${sv.game.players.map((p) => p.name).join("-").replace(/[^\w-]+/g, "")}-round${sv.game.round}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
function renderSaves() {
  const list = saves();
  const box = $("saves");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="font-size:1.2rem">📂 Saved games</h2><label class="btn btn--ghost btn--sm">⬆ Load from file<input type="file" accept=".json,application/json" id="loadFile" hidden /></label></div>
    ${list.length ? `<div class="savelist">${list.map((sv, i) => {
      const g = sv.game, done = !!g.winner, w = done && g.players.find((p) => p.id === g.winner);
      return `<div class="saverow"><div><b>${sv.mode === "host" ? "🌐" : "🎮"} ${esc(g.players.map((p) => p.name).join(", "))}</b>
        <small class="muted">${done ? `🏆 ${esc(w ? w.name : "")} won` : `Round ${g.round}`} · ${({ quick: "Quick", standard: "Standard", classic: "Classic" })[g.length] || "Standard"} · ${sv.mode === "host" ? `online room ${esc(sv.code || "")}` : "this device"} · saved ${ago(sv.savedAt)}</small></div>
        <div class="row">${done ? "" : `<button class="btn btn--accent btn--sm" data-act="resumeSave" data-i="${i}">Resume</button>`}<button class="btn btn--ghost btn--sm" data-act="downloadSave" data-i="${i}" title="Download a save file">⬇</button><button class="btn btn--ghost btn--sm" data-act="deleteSave" data-i="${i}" title="Delete">🗑</button></div></div>`;
    }).join("")}</div>` : `<p class="muted" style="margin:0">No saved games yet. Games save automatically after every move.</p>`}`;
  box.hidden = false;
  $("loadFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const sv = JSON.parse(await file.text()); if (!validSave(sv)) throw new Error(); sv.savedAt = Date.now(); resumeSave(sv); }
    catch { toast("Couldn't read that file. Pick a CashFlow save (.json)."); }
  };
}

// ------------------------------------------------------------------ actions
function dispatch(action) {
  if (!app.game) return;
  if (app.mode === "guest") { app.net.send({ t: "action", action }); return; }
  try {
    action.by = app.mode === "local" ? actor(app.game).id : app.viewerId;
    setGame(apply(app.game, action));
    if (app.mode === "host") broadcastState();
  } catch (e) {
    if (e instanceof GameError) { toast(e.message); sfx.error(); } else { console.error(e); toast("Something went wrong: " + e.message); }
  }
}

function broadcastState() {
  if (!app.net) return;
  const timeLeft = app.timeLeft();
  app.net.broadcast((pid) => ({ t: "state", state: app.game, you: pid, online: [...app.online], timeLeft }));
}

// ------------------------------------------------------------------ lobby: local
function renderLocalNames() {
  const names = store.get("cf.localNames", ["Player 1", "Player 2"]);
  $("localNames").innerHTML = names.map((n, i) => `<div class="row"><input class="inp" data-local="${i}" value="${n.replace(/"/g, "&quot;")}" maxlength="18" aria-label="Player ${i + 1} name" />${names.length > 1 ? `<button class="btn btn--ghost btn--sm" data-act="removeLocal" data-i="${i}" aria-label="Remove player">✕</button>` : ""}</div>`).join("");
}
function readLocalNames() { return [...document.querySelectorAll("[data-local]")].map((i, k) => i.value.trim() || `Player ${k + 1}`); }

async function startLocal() {
  const names = readLocalNames();
  store.set("cf.localNames", names);
  const players = names.map((name, i) => ({ id: `p${i + 1}`, name }));
  app.mode = "local"; app.code = null; app.online = null;
  app.localIds = new Set(players.map((p) => p.id));
  setGame(await makeGame(players, document.querySelector('[data-length="local"]').value));
}

// ------------------------------------------------------------------ lobby: host
async function host(saved = null) {
  const name = saved ? (saved.lobby || []).concat([{ id: "h", name: "Host" }]).find((p) => p.id === "h").name : $("hostName").value.trim() || "Host";
  if (!saved) store.set("cf.name", name);
  const box = $("hostLobby");
  box.hidden = false; box.innerHTML = `<p class="status">${saved ? "Reopening your room…" : "Creating room…"}</p>`;
  try {
    app.mode = "host"; app.viewerId = "h"; app.localIds = new Set(["h"]); app.online = new Set(["h"]);
    app.lobby = saved && saved.lobby ? saved.lobby : saved ? saved.game.players.map((p) => ({ id: p.id, name: p.name, key: p.id === "h" ? clientKey : "" })) : [{ id: "h", name, key: clientKey }];
    const handlers = {
      onHello(conn, msg) {
        const key = String(msg.key || "");
        if (app.game) { // reconnecting to a game in progress
          // same browser tab → same seat; otherwise match an offline seat by name (e.g. after a resumed game)
          const nm = String(msg.name || "").trim().toLowerCase();
          let seat = app.lobby.find((p) => p.key === key && p.id !== "h");
          if (!seat) seat = app.lobby.find((p) => p.id !== "h" && !app.online.has(p.id) && p.name.trim().toLowerCase() === nm);
          if (!seat) {
            const open = app.lobby.filter((p) => p.id !== "h" && !app.online.has(p.id)).map((p) => p.name);
            conn.send({ t: "error", msg: open.length ? `This game is in progress. Join with the name of an open seat: ${open.join(", ")}.` : "This game already started." });
            return null;
          }
          seat.key = key;
          app.online.add(seat.id); setTimeout(() => { armTimer(); broadcastState(); renderGame(app); }, 50);
          toast(`${seat.name} is back 👋`);
          return seat.id;
        }
        let seat = app.lobby.find((p) => p.key === key && p.id !== "h"); // the host's own seat can't be claimed remotely
        if (!seat) {
          if (app.lobby.length >= MAX_PLAYERS) { conn.send({ t: "error", msg: "This room is full (6 players)." }); return null; }
          seat = { id: `g${app.lobby.length}${Date.now() % 1000}`, name: String(msg.name || "Guest").slice(0, 18), key };
          app.lobby.push(seat);
        }
        app.online.add(seat.id);
        setTimeout(() => { renderHostLobby(); app.net.broadcast((pid) => ({ t: "lobby", players: app.lobby.map(({ id, name }) => ({ id, name })), you: pid })); }, 50);
        return seat.id;
      },
      onAction(pid, action) {
        if (!app.game) return;
        try { setGame(apply(app.game, { ...action, by: pid })); broadcastState(); }
        catch (e) { app.net.send(pid, { t: "error", msg: e instanceof GameError ? e.message : "Action failed." }); }
      },
      onLeave(pid) {
        app.online.delete(pid);
        const seat = app.lobby.find((p) => p.id === pid);
        if (seat) toast(`${seat.name} disconnected`);
        if (app.game) { armTimer(); renderGame(app); broadcastState(); } else renderHostLobby();
      },
      onError(e) { console.warn(e); },
    };
    try { app.net = await hostRoom(handlers, ...(saved && saved.code ? [saved.code] : [])); }
    catch (e) { if (!saved) throw e; app.net = await hostRoom(handlers); } // old code taken: open a new one
    app.code = app.net.code;
    if (saved) {
      timer.limit = saved.timer || 0;
      setGame(saved.game);
      toast(app.code === saved.code ? `Room ${app.code} is open again. Friends rejoin with the same code 🔑` : `New room code: ${app.code}. Share it so friends can rejoin.`);
      return;
    }
    renderHostLobby();
  } catch (e) {
    box.innerHTML = `<p class="status">${e.message}</p>`;
    app.mode = null;
  }
}

function renderHostLobby() {
  const link = `${location.origin}${location.pathname}?join=${app.code}`;
  $("hostLobby").innerHTML = `<p class="muted" style="margin:0">Room code</p><div class="code">${app.code}</div>
    <button class="btn btn--ghost btn--sm" data-act="copyLink" data-link="${link}">Copy invite link</button>
    <p class="muted" style="margin:0">Players (${app.lobby.length}/${MAX_PLAYERS}):</p>
    <div class="names">${app.lobby.map((p) => `<div class="chip">${p.id === "h" ? "👑 " : ""}${p.name.replace(/</g, "&lt;")}${p.id !== "h" && !app.online.has(p.id) ? " (left)" : ""}</div>`).join("")}</div>
    <button class="btn btn--accent btn--block" data-act="startHost" ${app.lobby.length < 1 ? "disabled" : ""}>Start game with ${app.lobby.length} player${app.lobby.length > 1 ? "s" : ""}</button>`;
}

async function startHost() {
  timer.limit = Number(document.querySelector("[data-timer]").value) || 0;
  const players = app.lobby.filter((p) => app.online.has(p.id)).map(({ id, name }) => ({ id, name }));
  app.lobby = app.lobby.filter((p) => app.online.has(p.id));
  setGame(await makeGame(players, document.querySelector('[data-length="host"]').value));
  broadcastState();
}

// ------------------------------------------------------------------ lobby: join
async function join() {
  const code = $("joinCode").value.trim().toUpperCase();
  const name = $("joinName").value.trim() || "Guest";
  if (code.length < 4) { $("joinStatus").textContent = "Enter the room code from the host."; return; }
  store.set("cf.name", name);
  $("joinStatus").textContent = "Connecting…";
  try {
    app.mode = "guest"; app.code = code; app.online = new Set();
    app.net = await joinRoom(code, { name, key: clientKey }, {
      onMessage(msg) {
        if (msg.t === "lobby") { app.viewerId = msg.you; app.localIds = new Set([msg.you]); $("joinStatus").innerHTML = `Joined ✅ Waiting for the host to start… <br>In the room: ${msg.players.map((p) => p.name.replace(/</g, "&lt;")).join(", ")}`; }
        else if (msg.t === "state") { app.viewerId = msg.you; app.localIds = new Set([msg.you]); app.online = new Set(msg.online || []); timer.guestDeadline = msg.timeLeft ? Date.now() + msg.timeLeft * 1000 : null; setGame(msg.state); }
        else if (msg.t === "error") { toast(msg.msg); if (!app.game) $("joinStatus").textContent = msg.msg; }
      },
      onClose() { toast("Disconnected from the host."); $("joinStatus").textContent = "Disconnected. Rejoin with the same code to take your seat back."; },
    });
    $("joinStatus").textContent = "Connected, saying hi…";
  } catch (e) { $("joinStatus").textContent = e.message; app.mode = null; }
}

// ------------------------------------------------------------------ statement dialog
function openStatement(id, refresh = false) {
  const g = app.game, p = g.players.find((x) => x.id === id);
  if (!p) return;
  app.stmtFor = id;
  const canManage = app.localIds.has(p.id) && current(g).id === p.id && actor(g).id === p.id && !g.winner && !["roll", "choose", "share"].includes(g.phase);
  $("stmtBody").innerHTML = statementHTML(g, p, canManage);
  if (!refresh) $("stmtDialog").showModal();
}

// ------------------------------------------------------------------ events
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  switch (act) {
    case "rules": $("rulesDialog").showModal(); break;
    case "mute": { const m = toggleMute(); b.textContent = m ? "🔇" : "🔊"; if (!m) sfx.click(); break; }
    case "close": b.closest("dialog").close(); break;
    case "addLocal": { const n = readLocalNames(); if (n.length < MAX_PLAYERS) { n.push(`Player ${n.length + 1}`); store.set("cf.localNames", n); renderLocalNames(); } break; }
    case "removeLocal": { const n = readLocalNames(); n.splice(Number(b.dataset.i), 1); store.set("cf.localNames", n); renderLocalNames(); break; }
    case "startLocal": startLocal(); break;
    case "host": if (!app.net) host(); break;
    case "startHost": startHost(); break;
    case "resumeSave": resumeSave(saves()[Number(b.dataset.i)]); break;
    case "downloadSave": downloadSave(saves()[Number(b.dataset.i)]); break;
    case "deleteSave": { const l = saves(); const sv = l[Number(b.dataset.i)]; if (sv && confirm(`Delete the saved game with ${sv.game.players.map((p) => p.name).join(", ")}?`)) { l.splice(Number(b.dataset.i), 1); store.set("cf.saves", l); renderSaves(); } break; }
    case "saveFile": if (app.game) downloadSave(snapshot()); break;
    case "join": join(); break;
    case "copyLink": navigator.clipboard && navigator.clipboard.writeText(b.dataset.link).then(() => toast("Invite link copied 📋"), () => toast(b.dataset.link)); break;
    case "home": if (app.net) app.net.close(); location.href = location.pathname; break;
    case "stmt": openStatement(b.dataset.id); break;
    case "ROLL": case "PASS": case "END_TURN": case "CHARITY": dispatch({ type: act }); break;
    case "PICK_DREAM": dispatch({ type: "PICK_DREAM", id: b.dataset.id }); break;
    case "SET_401K": dispatch({ type: "SET_401K", rate: Number(b.dataset.rate) }); break;
    case "coach": openCoach(app.game, app.viewerId); break;
    case "DEAL": dispatch({ type: "DEAL", size: b.dataset.size }); break;
    case "BUY": { const q = $("qty"); dispatch({ type: "BUY", qty: q ? Number(q.value) : undefined }); break; }
    case "SELL_STOCK": { const inp = document.querySelector(`[data-sellqty="${CSS.escape(b.dataset.ticker)}"]`); const card = app.game.card; const own = actor(app.game).stocks.find((s) => s.ticker === b.dataset.ticker); const qty = inp ? Number(inp.value) : (card && card.type === "stock" && $("qty") ? Number($("qty").value) : own ? own.shares : 0); dispatch({ type: "SELL_STOCK", ticker: b.dataset.ticker, qty: Math.min(qty, own ? own.shares : 0) || (own ? own.shares : 0) }); break; }
    case "SELL_ASSET": if (app.game.card && app.game.card.type === "offer" || confirm("Fire sale? You get 90% of value minus fees and a 20% speed discount on your equity.")) dispatch({ type: "SELL_ASSET", id: b.dataset.id }); break;
    case "PAYOFF": dispatch({ type: "PAYOFF", key: b.dataset.key }); break;
    case "BORROW": dispatch({ type: "BORROW", amount: Number($("loanAmt").value) }); break;
    case "REPAY": dispatch({ type: "REPAY", amount: Number($("loanAmt").value) }); break;
  }
});
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

// ------------------------------------------------------------------ boot
renderLocalNames();
initCoach();
document.querySelector('[data-act="mute"]').textContent = isMuted() ? "🔇" : "🔊";
$("hostName").value = $("joinName").value = store.get("cf.name", "");
const params = new URLSearchParams(location.search);
if (params.get("join")) { $("joinCode").value = params.get("join"); $("joinName").focus(); }
// migrate the old single "last game" save into the saved-games list
const last = store.get("cf.lastGame", null);
if (last && last.game && !saves().some((x) => x.id === last.game.seed)) { store.set("cf.saves", [{ v: 1, id: last.game.seed, mode: last.mode, savedAt: Date.now(), code: last.code, timer: 0, lobby: null, game: last.game }, ...saves()].slice(0, MAX_SAVES)); }
try { localStorage.removeItem("cf.lastGame"); } catch {}
if (!params.get("join")) renderSaves();
