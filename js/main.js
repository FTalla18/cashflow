// App controller: lobby, local (pass-and-play) games, hosting and joining online games.
import { newGame, apply, current, GameError, MAX_PLAYERS } from "./engine.js";
import { renderGame, renderBoard, statementHTML, showDice } from "./ui.js";
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
}
function newSeed() { return crypto.getRandomValues(new Uint32Array(2)).join("-"); }

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
  if (app.mode === "local") app.viewerId = current(next).id;
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
  if (app.mode === "local" || app.mode === "host") store.set("cf.lastGame", { mode: app.mode, game: next, code: app.code });
}

// ------------------------------------------------------------------ actions
function dispatch(action) {
  if (!app.game) return;
  if (app.mode === "guest") { app.net.send({ t: "action", action }); return; }
  try {
    action.by = app.mode === "local" ? current(app.game).id : app.viewerId;
    setGame(apply(app.game, action));
    if (app.mode === "host") broadcastState();
  } catch (e) {
    if (e instanceof GameError) { toast(e.message); sfx.error(); } else { console.error(e); toast("Something went wrong: " + e.message); }
  }
}

function broadcastState() {
  if (!app.net) return;
  app.net.broadcast((pid) => ({ t: "state", state: app.game, you: pid, online: [...app.online] }));
}

// ------------------------------------------------------------------ lobby: local
function renderLocalNames() {
  const names = store.get("cf.localNames", ["Player 1", "Player 2"]);
  $("localNames").innerHTML = names.map((n, i) => `<div class="row"><input class="inp" data-local="${i}" value="${n.replace(/"/g, "&quot;")}" maxlength="18" aria-label="Player ${i + 1} name" />${names.length > 1 ? `<button class="btn btn--ghost btn--sm" data-act="removeLocal" data-i="${i}" aria-label="Remove player">✕</button>` : ""}</div>`).join("");
}
function readLocalNames() { return [...document.querySelectorAll("[data-local]")].map((i, k) => i.value.trim() || `Player ${k + 1}`); }

function startLocal() {
  const names = readLocalNames();
  store.set("cf.localNames", names);
  const players = names.map((name, i) => ({ id: `p${i + 1}`, name }));
  app.mode = "local"; app.code = null; app.online = null;
  app.localIds = new Set(players.map((p) => p.id));
  setGame(newGame({ seed: newSeed(), players, length: document.querySelector('[data-length="local"]').value }));
}

// ------------------------------------------------------------------ lobby: host
async function host() {
  const name = $("hostName").value.trim() || "Host";
  store.set("cf.name", name);
  const box = $("hostLobby");
  box.hidden = false; box.innerHTML = `<p class="status">Creating room…</p>`;
  try {
    app.mode = "host"; app.viewerId = "h"; app.localIds = new Set(["h"]); app.online = new Set(["h"]);
    app.lobby = [{ id: "h", name, key: clientKey }];
    app.net = await hostRoom({
      onHello(conn, msg) {
        const key = String(msg.key || "");
        if (app.game) { // reconnecting to a game in progress
          const seat = app.lobby.find((p) => p.key === key && p.id !== "h");
          if (!seat) { conn.send({ t: "error", msg: "This game already started." }); return null; }
          app.online.add(seat.id); setTimeout(() => { broadcastState(); renderGame(app); }, 50);
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
        if (app.game) { renderGame(app); broadcastState(); } else renderHostLobby();
      },
      onError(e) { console.warn(e); },
    });
    app.code = app.net.code;
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

function startHost() {
  const players = app.lobby.filter((p) => app.online.has(p.id)).map(({ id, name }) => ({ id, name }));
  app.lobby = app.lobby.filter((p) => app.online.has(p.id));
  setGame(newGame({ seed: newSeed(), players, length: document.querySelector('[data-length="host"]').value }));
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
        else if (msg.t === "state") { app.viewerId = msg.you; app.localIds = new Set([msg.you]); app.online = new Set(msg.online || []); setGame(msg.state); }
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
  const canManage = app.localIds.has(p.id) && current(g).id === p.id && !g.winner && g.phase !== "roll" && g.phase !== "choose";
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
    case "join": join(); break;
    case "copyLink": navigator.clipboard && navigator.clipboard.writeText(b.dataset.link).then(() => toast("Invite link copied 📋"), () => toast(b.dataset.link)); break;
    case "home": if (app.net) app.net.close(); location.href = location.pathname; break;
    case "stmt": openStatement(b.dataset.id); break;
    case "ROLL": case "PASS": case "END_TURN": case "CHARITY": dispatch({ type: act }); break;
    case "DEAL": dispatch({ type: "DEAL", size: b.dataset.size }); break;
    case "BUY": { const q = $("qty"); dispatch({ type: "BUY", qty: q ? Number(q.value) : undefined }); break; }
    case "SELL_STOCK": { const inp = document.querySelector(`[data-sellqty="${CSS.escape(b.dataset.ticker)}"]`); const card = app.game.card; const own = current(app.game).stocks.find((s) => s.ticker === b.dataset.ticker); const qty = inp ? Number(inp.value) : (card && card.type === "stock" && $("qty") ? Number($("qty").value) : own ? own.shares : 0); dispatch({ type: "SELL_STOCK", ticker: b.dataset.ticker, qty: Math.min(qty, own ? own.shares : 0) || (own ? own.shares : 0) }); break; }
    case "SELL_ASSET": if (app.game.card && app.game.card.type === "offer" || confirm("Fire sale? You get 90% of value minus fees and a 20% speed discount on your equity.")) dispatch({ type: "SELL_ASSET", id: b.dataset.id }); break;
    case "PAYOFF": dispatch({ type: "PAYOFF", key: b.dataset.key }); break;
    case "BORROW": dispatch({ type: "BORROW", amount: Number($("loanAmt").value) }); break;
    case "REPAY": dispatch({ type: "REPAY", amount: Number($("loanAmt").value) }); break;
  }
});
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

// ------------------------------------------------------------------ boot
renderLocalNames();
document.querySelector('[data-act="mute"]').textContent = isMuted() ? "🔇" : "🔊";
$("hostName").value = $("joinName").value = store.get("cf.name", "");
const params = new URLSearchParams(location.search);
if (params.get("join")) { $("joinCode").value = params.get("join"); $("joinName").focus(); }
const last = store.get("cf.lastGame", null);
if (last && last.mode === "local" && last.game && !last.game.winner && !params.get("join")) {
  // offer to resume a pass-and-play game
  const bar = document.createElement("div");
  bar.className = "panel"; bar.style.marginBottom = "16px";
  bar.innerHTML = `<div class="row" style="justify-content:space-between"><span>You have an unfinished game (round ${last.game.round}, ${last.game.players.map((p) => p.name).join(", ")}).</span><button class="btn btn--accent btn--sm" id="resume">Resume</button></div>`;
  $("lobby").prepend(bar);
  $("resume").onclick = () => { app.mode = "local"; app.localIds = new Set(last.game.players.map((p) => p.id)); setGame(last.game); };
}
