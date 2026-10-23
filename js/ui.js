// Rendering: turns the game state into HTML. All buttons carry data-act="..." and are handled in main.js.
// Layout: race strip (top) · side rail + slide-over panes (left) · board with the card stage (center) · action dock (bottom).
import { statement, tileInfo, current, actor, money, report, creditScore, creditTier, loanTerms, utilization, playerDate, checksToBills, MONTHS, monthOf,
  TILES, LENGTHS, K401_CHOICES, FAST_WIN_CASHFLOW, DREAMS, FAST_BOARD, BADGES } from "./engine.js";
import { FILING_LABEL } from "./tax.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x * 100)}%`;
const cls = (n) => (n >= 0 ? "pos" : "neg");
const short$ = (n) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : money(n));
const badgeIcons = (p) => p.badges.map((b) => `<span title="${esc(BADGES[b].label)}">${BADGES[b].emoji}</span>`).join("");
const fmtDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const viewer = (app) => app.game.players.find((x) => x.id === app.viewerId) || actor(app.game);

// ---------------------------------------------------------------- charts
let gradId = 0;
/**
 * Small area chart. Same footprint as before, more texture: filled area, faint min/max guides, end dot.
 * minSpan keeps tiny wiggles from looking dramatic (e.g. a stable credit score stays flat-ish).
 */
function sparkline(hist, w = 70, h = 22, { minSpan = 0, dots = false, color = null } = {}) {
  const pts = hist.length > 1 ? hist : [hist[0] || 0, hist[0] || 0];
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const span = hi - lo || 1, pad = 2;
  const xy = pts.map((v, i) => [((i / (pts.length - 1)) * (w - pad * 2) + pad), (h - pad - ((v - lo) / span) * (h - pad * 2))]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const up = pts[pts.length - 1] >= pts[0];
  const c = color || (up ? "#2ee59d" : "#ff5d6c");
  const id = `g${++gradId}`;
  const [ex, ey] = xy[xy.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".38"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${xy[xy.length - 1][0].toFixed(1)},${h}L${xy[0][0].toFixed(1)},${h}Z" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots ? xy.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3" fill="${c}"/>`).join("") : ""}
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.2" fill="#fff" stroke="${c}" stroke-width="1.2"/></svg>`;
}
/** Credit history: one point per monthly report, plus today's live score. */
function creditChart(p, w = 64, h = 20) {
  const sc = creditScore(p);
  return sparkline([...(p.credit.hist || []), sc], w, h, { minSpan: 40, dots: true, color: creditTier(sc).color });
}

// ---------------------------------------------------------------- top: race strip + info chips
export function renderGame(app) {
  renderTop(app);
  renderRace(app);
  renderBoard(app.game);
  renderStage(app);
  renderDock(app);
  renderPeek(app.game);
  renderPanes(app);
}

function renderTop(app) {
  const g = app.game;
  $("topInfo").innerHTML = g
    ? `${app.code ? `<span class="chip">Room <b>${esc(app.code)}</b></span>` : ""}<span class="chip">Round ${g.round}</span><span class="chip" title="${esc(g.economy.headline)}">🌍 ${esc(g.economy.name)} · mortgage ${(g.economy.mortgage * 100).toFixed(1)}%</span><span class="chip" title="${esc(LENGTHS[g.length].desc)}">${esc(LENGTHS[g.length].label)} game</span><span class="chip" id="timerChip" hidden></span>`
    : app.code ? `<span class="chip">Room <b>${esc(app.code)}</b></span>` : "";
}

/** Everyone's progress out of the rat race, always visible. */
function renderRace(app) {
  const g = app.game, cur = current(g);
  $("race").innerHTML = g.players.map((p) => {
    const s = statement(p, g.goal);
    const prog = p.fast ? Math.min(1, p.cash / p.dream.cost) : s.progress;
    const label = p.fast ? `🚀 ${p.dream.icon} ${short$(p.cash)} / ${short$(p.dream.cost)}` : `${short$(s.passive)} / ${short$(s.target)} a month`;
    const off = app.online && !app.online.has(p.id);
    return `<button class="racer ${p.id === cur.id ? "is-turn" : ""}" style="--pc:${p.color}" data-act="stmt" data-id="${p.id}" title="${esc(p.name)}: ${pct(prog)} of the way out">
      <span class="dot"></span><b>${esc(p.name)}${off ? " 💤" : ""}</b><small>${label}</small><span class="progress"><span style="width:${pct(prog)}"></span></span></button>`;
  }).join("");
}

/** Countdown chip (online games with a turn timer, or while waiting on an offline player). */
export function renderTimer(app) {
  const el = $("timerChip");
  if (!el) return;
  const t = app.timeLeft ? app.timeLeft() : null;
  if (t === null || !app.game || app.game.winner) { el.hidden = true; return; }
  const a = actor(app.game);
  el.hidden = false;
  el.className = `chip ${t <= 10 ? "chip--hot" : ""}`;
  el.textContent = `⏱ ${a.name}: ${Math.max(0, Math.ceil(t))}s`;
}

function renderPeek(g) {
  const l = [...g.log].reverse().find((x) => x.kind !== "move" && x.kind !== "setup");
  const color = l && l.pid ? (g.players.find((p) => p.id === l.pid) || {}).color : null;
  const el = $("peek");
  if (!l || el.dataset.n === String(l.n)) return;
  el.dataset.n = l.n;
  el.innerHTML = `<p style="${color ? `--pc:${color}` : ""}">${esc(l.text)}</p>`;
}

// ---------------------------------------------------------------- board (rat race 9×9, or the Fast Track ring)
const RING = (() => { // 24 perimeter cells of a 7×7 grid, clockwise from the top-left
  const out = [];
  for (let c = 0; c < 7; c++) out.push([0, c]);
  for (let r = 1; r < 7; r++) out.push([r, 6]);
  for (let c = 5; c >= 0; c--) out.push([6, c]);
  for (let r = 5; r >= 1; r--) out.push([r, 0]);
  return out;
})();

export function renderBoard(g, posOverride = null) {
  const cur = current(g);
  const board = $("board");
  if (cur.fast && !g.winner) { renderFastBoard(g, cur); return; }
  board.className = "board";
  const posOf = (p) => (posOverride && posOverride[p.id] !== undefined ? posOverride[p.id] : p.pos);
  let html = "";
  for (let i = 0; i < TILES; i++) {
    const t = g.board[i], info = tileInfo(t);
    const here = g.players.filter((p) => !p.fast && posOf(p) === i);
    html += `<div class="tile ${!cur.fast && i === posOf(cur) ? "is-current" : ""}" style="--c:${info.color}" title="${esc(`${i + 1}. ${t}: ${info.tip}`)}">
      <span class="tile__icon">${info.icon}</span><span class="tile__name">${esc(t === "Personal Spending" ? "Spending" : t === "Economic Event" ? "Economy" : t)}</span>
      ${here.length ? `<span class="tokens">${here.map((p) => `<i class="token ${p.id === cur.id ? "is-turn" : ""}" style="--pc:${p.color}" title="${esc(p.name)}">${esc(p.name)}</i>`).join("")}</span>` : ""}
    </div>`;
  }
  board.innerHTML = html;
}

function renderFastBoard(g, cur) {
  const board = $("board");
  board.className = "board board--fast";
  board.innerHTML = FAST_BOARD.map((t, i) => {
    const info = tileInfo(t), [r, c] = RING[i];
    const here = g.players.filter((p) => p.fast && p.fast.pos === i);
    return `<div class="tile ${cur.fast.pos === i ? "is-current" : ""}" style="--c:${info.color};grid-row:${r + 1};grid-column:${c + 1}" title="${esc(`${t}: ${info.tip}`)}">
      <span class="tile__icon">${info.icon}</span><span class="tile__name">${esc(t)}</span>
      ${here.length ? `<span class="tokens">${here.map((p) => `<i class="token ${p.id === cur.id ? "is-turn" : ""}" style="--pc:${p.color}"></i>`).join("")}</span>` : ""}</div>`;
  }).join("") + `<div class="hub"><p class="card__kicker">🚀 The Fast Track</p><h3>${cur.dream.icon} ${esc(cur.dream.name)}</h3>
    <p class="muted" style="margin:0">${esc(cur.name)}: ${money(cur.cash)} of ${money(cur.dream.cost)} · Payout Day ${money(cur.fast.base + cur.fast.added)}</p>
    <div class="progress" style="width:min(320px,90%)"><span style="width:${pct(Math.min(1, cur.cash / cur.dream.cost))}"></span></div></div>`;
}

export function showDice(dice) {
  const el = $("dice");
  if (!dice) { el.innerHTML = ""; return; }
  el.innerHTML = dice.map((d) => `<span class="die">${d}</span>`).join("");
  clearTimeout(showDice.t);
  showDice.t = setTimeout(() => (el.innerHTML = ""), 1400);
}

// ---------------------------------------------------------------- the card stage (middle of the board)
function renderStage(app) {
  const g = app.game, el = $("stage");
  let html = "";
  if (g.winner) html = `<div class="card">${reportCard(g)}</div>`;
  else {
    const p = current(g), a = actor(g), mine = app.localIds.has(a.id);
    if (mine) {
      if (g.phase === "share") html = shareHTML(g, a, p);
      else if (g.phase === "choose") html = `<div class="card"><p class="card__kicker">💡 Opportunity</p><h4>Small deal or big deal?</h4>
        <div class="choose"><button data-act="DEAL" data-size="small"><b>Small deal</b><span>Stocks, funds, starter homes, small businesses. Cheaper, smaller cashflow.</span></button>
        <button data-act="DEAL" data-size="big"><b>Big deal</b><span>Apartment buildings, commercial property, bigger businesses. Needs serious cash.</span></button></div>
        <p class="muted" style="margin:10px 0 0">You have ${money(p.cash)} in cash.</p></div>`;
      else if (g.phase === "decide") html = cardHTML(g, p);
      else if (g.phase === "roll" && g.round === 1 && !p.fast) html = `<div class="card">${dreamPicker(p)}<p class="muted" style="margin:10px 0 0;font-size:.8rem">Then hit 🎲 Roll below.</p></div>`;
    }
  }
  el.innerHTML = html;
  el.hidden = !html;
}

// ---------------------------------------------------------------- bottom dock
const shown = {}; // last cash shown per player (for the count-up)
function renderDock(app) {
  const g = app.game, el = $("dock");
  if (g.winner) {
    const w = g.players.find((x) => x.id === g.winner);
    el.innerHTML = `<div class="dock__who" style="--pc:${w.color}"><span class="dot"></span><div><b>🏆 ${esc(w.name)} wins!</b><small>Round ${g.round}</small></div></div><span></span>
      <div class="dock__btns"><button class="btn btn--ghost" data-act="stmt" data-id="${w.id}">Statement</button><button class="btn btn--accent" data-act="home">New game</button></div>`;
    return;
  }
  const p = current(g), a = actor(g), mine = app.localIds.has(a.id), me = viewer(app);
  const you = app.localIds.has(p.id) && app.mode !== "local" ? " (you)" : "";
  const hint = {
    roll: p.fast ? "🚀 Fast Track · roll 2 dice" : p.charityTurns ? `💛 2 dice for ${p.charityTurns} more turn${p.charityTurns > 1 ? "s" : ""}` : `📅 ${fmtDate(playerDate(g, p))} · roll to move`,
    choose: "Pick a small or big deal ↑", decide: "Decide on the card ↑", share: `${esc(a.name)}: buy the shared deal? ↑`,
    manage: "Manage your money, then end your turn",
  }[g.phase] || "";
  let btns = "";
  if (!mine) {
    const off = app.online && !app.online.has(a.id);
    btns = `<span class="waiting">Waiting for ${esc(a.name)}…${off ? " (offline)" : ""}</span>`;
  } else if (g.phase === "roll") {
    btns = `<button class="btn btn--accent btn--big" data-act="ROLL">🎲 Roll${p.fast || p.charityTurns ? " 2 dice" : ""}</button>`;
  } else if (g.phase === "manage") {
    btns = `<button class="btn btn--ghost" data-act="stmt" data-id="${p.id}">💼 Manage money</button><button class="btn btn--accent btn--big" data-act="END_TURN">End turn →</button>`;
  } else if (g.phase === "decide" || g.phase === "choose") {
    btns = `<button class="btn btn--ghost" data-act="stmt" data-id="${p.id}">💼 Manage money</button>`;
  }
  el.innerHTML = `<div class="dock__who" style="--pc:${p.color}"><span class="dot"></span><div><b>${esc(p.name)}'s turn${you}</b><small>${hint}</small></div></div>
    <div class="dock__cash"><small>${app.mode === "local" ? `${esc(me.name)}'s cash` : "Your cash"}</small><b id="dockCash">${money(shown[me.id] ?? me.cash)}</b></div>
    <div class="dock__btns">${btns}</div>`;
  countUp($("dockCash"), shown[me.id] ?? me.cash, me.cash);
  shown[me.id] = me.cash;
}

function countUp(el, from, to) {
  if (!el || from === to) return;
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.max(0, Math.min(1, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3); // rAF time can be slightly before t0
    el.textContent = money(from + (to - from) * e);
    el.className = to > from ? "pos" : "neg";
    if (k < 1) requestAnimationFrame(step); else setTimeout(() => (el.className = ""), 400);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- side panes
function renderPanes(app) {
  const g = app.game;
  $("railFast").hidden = !g.fastTrack;
  $("drawer").hidden = !app.pane;
  document.querySelectorAll("#drawer .pane").forEach((el) => el.classList.toggle("is-on", el.dataset.pane === app.pane));
  document.querySelectorAll("#rail [data-pane]").forEach((b) => b.classList.toggle("is-on", b.dataset.pane === app.pane));
  renderMe(app);
  renderCredit(app);
  renderTicker(app);
  renderPlayers(app);
  renderLog(g);
  renderFast(g);
}

function lifeChips(p) {
  const fam = p.life.filing === "married_joint" || p.life.filing === "married_separate" ? "💍 Married" : p.life.filing === "head_household" ? "🏡 Head of household" : "👤 Single";
  return `<div class="lifechips"><span>💼 ${esc(p.job.employed ? p.job.title : `Between jobs (was ${p.job.title})`)}</span><span>📍 ${esc(p.life.city)}, ${esc(p.life.state)}</span>
    <span>${p.life.housing === "own" ? "🏠 Homeowner" : "🔑 Renter"}</span><span>🚗 ${esc(p.life.car)}</span><span>${fam}</span>${p.life.children ? `<span>👶 ${p.life.children} ${p.life.children > 1 ? "Kids" : "Kid"}</span>` : ""}${p.life.spouse ? `<span>💑 Spouse: ${esc(p.life.spouse.title)}</span>` : ""}</div>`;
}

function renderMe(app) {
  const g = app.game, p = viewer(app), s = statement(p, g.goal);
  const canSet = app.localIds.has(p.id) && actor(g).id === p.id && g.phase !== "share" && !g.winner && p.job.employed && !p.job.gig && !p.fast;
  const k401 = p.job.employed && !p.job.gig && !p.fast ? `<div class="k401"><span>🏦 401(k)${p.job.match ? ` <small class="muted">(employer matches 50% up to 6%)</small>` : ""}</span><div class="seg">${K401_CHOICES.map((r) => `<button data-act="SET_401K" data-rate="${r}" class="${Math.abs(p.k401Rate - r) < 1e-9 ? "is-on" : ""}" ${canSet ? "" : "disabled"}>${Math.round(r * 100)}%</button>`).join("")}</div></div>` : "";
  const when = checksToBills(p);
  const billDate = MONTHS[(monthOf((p.checks || 0) + when)) % 12];
  const t = p.tax || {};
  const taxLine = t.pending ? `${t.pending.amount >= 0 ? `<b class="pos">+${money(t.pending.amount)}</b> refund` : `<b class="neg">${money(t.pending.amount)}</b> owed`} for ${t.pending.year}, in April`
    : `${t.year} so far: ${money(t.withheld || 0)} withheld`;
  const escape = p.fast
    ? `<div class="fastme"><div class="row" style="justify-content:space-between"><span>💸 Payout Day pays</span><b class="pos">${money(p.fast.base + p.fast.added)}</b></div>
      <div class="row" style="justify-content:space-between"><span>${p.dream.icon} ${esc(p.dream.name)}</span><b>${money(p.dream.cost)}</b></div>
      <div class="progress"><span style="width:${pct(Math.min(1, p.cash / p.dream.cost))}"></span></div>
      <div class="row" style="justify-content:space-between;font-size:.82rem"><span class="muted">Or add ${money(FAST_WIN_CASHFLOW)}/mo in businesses</span><span>${money(p.fast.added)}/mo</span></div></div>`
    : `<div class="row" style="justify-content:space-between;font-size:.86rem;margin-bottom:6px"><span>🐀 Rat race escape</span><span><b class="pos">${money(s.passive)}</b> / ${money(s.target)} a month</span></div>
      <div class="progress"><span style="width:${pct(s.progress)}"></span></div>`;
  $("me").innerHTML = `<h3>${app.mode === "local" ? `${esc(p.name)}'s money` : "Your money"} <span class="badges">${badgeIcons(p)}</span></h3>
    ${lifeChips(p)}
    <div class="stats"><div class="stat"><small>Cash</small><b>${money(p.cash)}</b></div><div class="stat"><small>Net worth</small><b class="${cls(s.netWorth)}">${money(s.netWorth)}</b></div>
      <div class="stat"><small>Take-home per paycheck</small><b>${money(s.takeHome)}</b></div><div class="stat"><small>Monthly cashflow</small><b class="${cls(s.monthlyCashflow)}">${money(s.monthlyCashflow)}</b></div></div>
    ${escape}
    ${p.fast ? "" : `<div class="timeline">
      <div><span>📅 Today</span><b>${fmtDate(playerDate(g, p))}</b></div>
      <div><span>🧾 ${billDate} 1st bills</span><b>−${money(s.billsTotal)} · in ${when} paycheck${when > 1 ? "s" : ""}</b></div>
      ${s.passive ? `<div><span>💰 Passive income</span><b class="pos">+${money(s.passive)}/mo</b></div>` : ""}
      <div><span>📬 Taxes</span><b>${taxLine}</b></div></div>`}
    ${k401}
    ${p.fast ? "" : `<p class="muted" style="font-size:.8rem;margin:10px 0 0">✨ Dream: ${p.dream.icon} ${esc(p.dream.name)} (${money(p.dream.cost)})</p>`}
    <div class="actions"><button class="btn btn--accent" data-act="stmt" data-id="${p.id}">📄 Full statement</button></div>`;
}

function creditHTML(p, big = false) {
  if (!p.credit) return "";
  const sc = creditScore(p), t = creditTier(sc), u = utilization(p);
  const pos = ((sc - 300) / 550) * 100;
  return `<div class="credit ${big ? "credit--big" : ""}" style="--cc:${t.color}"><div class="row" style="justify-content:space-between"><span>💳 Credit score <b class="credit__score">${sc}</b> <span class="credit__tier">${t.label}</span></span>${creditChart(p)}</div>
    <div class="credit__bar"><i style="left:${pos.toFixed(1)}%"></i></div>
    <div class="credit__meta"><span>Card use ${Math.round(u * 100)}% of ${money(p.credit.limit)}</span><span>✅ ${p.credit.onTime} on-time months</span><span>${p.credit.late ? `⚠️ ${p.credit.late} missed` : "0 missed"}</span>${big ? `<span>Loan rates: ${t.mortgage === 0 ? "standard" : `${t.mortgage > 0 ? "+" : ""}${(t.mortgage * 100).toFixed(2)}% mortgages, ${t.personal > 0 ? "+" : ""}${(t.personal * 100).toFixed(0)}% bank loans`}</span>` : ""}</div></div>`;
}

function renderCredit(app) {
  const p = viewer(app);
  $("credit").innerHTML = `<h3>💳 Credit score</h3>${creditHTML(p, true)}
    <ul class="howto"><li><b>Bills paid on time</b> every month: +4 (payment history is ~35% of a real FICO score)</li>
    <li><b>Running out of cash</b> = a missed payment: −30</li>
    <li><b>Card balance</b> under 10% of your limit helps, over 30% hurts (pay it down in your statement)</li>
    <li><b>New bank loan</b> = hard inquiry: −6</li>
    <li>Better tiers get cheaper mortgages and loans. Every deal card shows <b>your</b> rate.</li></ul>`;
}

function renderTicker(app) {
  const g = app.game, me = viewer(app);
  const rows = Object.entries(g.market).map(([t, m]) => {
    const prev = m.hist.length > 4 ? m.hist[m.hist.length - 5] : m.hist[0];
    const ch = prev ? (m.price - prev) / prev : 0;
    const own = me.stocks.find((s) => s.ticker === t);
    return `<div class="tick ${g.card && g.card.ticker === t ? "is-live" : ""}"><span class="tick__name">${esc(t)}${m.fund ? ` <small class="muted">fund</small>` : ""}${own ? ` <small class="pos">· you: ${own.shares}</small>` : ""}</span>${sparkline(m.hist.slice(-32), 70, 22, { minSpan: m.price * 0.04 })}<b>${money(m.price)}</b><small class="${cls(ch)}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}%</small></div>`;
  }).join("");
  $("ticker").innerHTML = `<h3>📈 Market</h3><p class="muted" style="font-size:.8rem;margin:-6px 0 10px">Last 8 rounds of prices. Change vs. last round.</p><div class="ticks">${rows}</div>`;
}

function renderPlayers(app) {
  const g = app.game, cur = current(g);
  $("players").innerHTML = `<h3>👥 Players</h3><div class="plist">${g.players.map((p) => {
    const s = statement(p, g.goal);
    const off = app.online && !app.online.has(p.id);
    const prog = p.fast ? Math.min(1, p.cash / p.dream.cost) : s.progress;
    return `<button class="prow ${p.id === cur.id ? "is-turn" : ""}" style="--pc:${p.color}" data-act="stmt" data-id="${p.id}">
      <span class="dot"></span><span><b>${esc(p.name)}</b> <span class="badges">${badgeIcons(p)}</span> ${off ? `<span class="badge badge--off">offline</span>` : ""}${p.skip ? `<span class="badge">skips a turn</span>` : ""}${p.fast ? `<span class="badge badge--fast">🚀 Fast Track</span>` : ""}<small>${esc(p.job.employed ? p.job.title : "Between jobs")} · cash ${money(p.cash)}${p.credit ? ` · 💳 <span style="color:${creditTier(creditScore(p)).color}">${creditScore(p)}</span>` : ""}</small><span class="progress"><span style="width:${pct(prog)}"></span></span></span><span class="badge">${pct(prog)}</span></button>`;
  }).join("")}</div>`;
}

function renderLog(g) {
  const color = Object.fromEntries(g.players.map((p) => [p.id, p.color]));
  $("log").innerHTML = `<h3>📰 Feed</h3>` + g.log.slice(-80).reverse().map((l) => `<p class="${l.kind}" style="${l.pid ? `--pc:${color[l.pid]}` : ""}">${esc(l.text)}</p>`).join("");
}

function renderFast(g) {
  const cur = current(g);
  const anyone = g.players.some((p) => p.fast);
  $("fast").innerHTML = `<h3>🚀 Fast Track</h3><p class="muted" style="font-size:.84rem;margin:-4px 0 0">${anyone ? `Buy your dream or add ${money(FAST_WIN_CASHFLOW)}/mo of business cashflow to win.` : "Escape the rat race to get here. When it's your turn on the Fast Track, the board switches to this ring."}</p>
    <div class="fastboard ${anyone ? "" : "is-locked"}">${FAST_BOARD.map((t, i) => {
      const info = tileInfo(t), here = g.players.filter((p) => p.fast && p.fast.pos === i);
      return `<div class="ftile ${cur.fast && cur.fast.pos === i ? "is-current" : ""}" style="--c:${info.color}" title="${esc(`${t}: ${info.tip}`)}"><span>${info.icon}</span>${here.map((p) => `<i class="token" style="--pc:${p.color}" title="${esc(p.name)}"></i>`).join("")}</div>`;
    }).join("")}</div>`;
}

// ---------------------------------------------------------------- cards
function dreamPicker(p) {
  return `<div class="dreams"><p class="card__kicker">✨ Pick your dream</p><p class="muted" style="margin:0 0 6px">What you'll buy once you're financially free:</p>${p.dreamOptions.map((id) => {
    const d = DREAMS.find((x) => x.id === id);
    return `<button class="dream ${p.dream.id === id ? "is-on" : ""}" data-act="PICK_DREAM" data-id="${id}"><span>${d.icon}</span><b>${esc(d.name)}</b><small>${money(d.cost)}</small></button>`;
  }).join("")}</div>`;
}

function shareHTML(g, a) {
  const c = g.share.card;
  const fromPlayer = g.players.find((x) => x.id === g.share.from);
  const intro = `<p class="card__kicker">🤝 Deal up for grabs</p><p class="muted" style="margin:0 0 8px">${esc(fromPlayer.name)} ${c.type === "stock" ? "bought this stock, so it's open to everyone at the same price" : "passed on this deal"}. ${esc(a.name)}, want in?</p>`;
  return cardHTML(g, a, c, intro);
}

/** Where a price sits in its 52-week range, with a plain-English read. */
function rangeBar(price, [lo, hi]) {
  const pos = hi > lo ? (price - lo) / (hi - lo) : 0.5;
  const read = pos <= 0.25 ? `<span class="pos">near the 52-week low 🔥</span>` : pos >= 0.75 ? `<span class="neg">near the 52-week high ⚠️</span>` : `<span class="muted">mid-range</span>`;
  return `<span class="rbar"><i style="left:${(pos * 100).toFixed(0)}%"></i></span> ${read}`;
}

function cardHTML(g, p, c = g.card, intro = "") {
  if (!c) return "";
  if (c.type === "stock") {
    const own = p.stocks.find((s) => s.ticker === c.ticker);
    const max = Math.floor(p.cash / c.price);
    const div = c.price * c.yield;
    const hist = g.market[c.ticker] ? g.market[c.ticker].hist : [c.price];
    const rg = c.range || [Math.min(...hist), Math.max(...hist)];
    return `<div class="card">${intro}<p class="card__kicker">${c.fund ? "📊 Fund" : "📈 Stock"}</p><h4>${esc(c.ticker)} ${sparkline(hist.slice(-32), 90, 26, { minSpan: c.price * 0.04 })}</h4><p class="story">"${esc(c.story)}"</p>
      <dl class="kv"><dt>Price per share</dt><dd>${money(c.price)}</dd><dt>52-week range</dt><dd>${money(rg[0])} – ${money(rg[1])}</dd><dt>Where it trades</dt><dd>${rangeBar(c.price, rg)}</dd>
      <dt>Dividend</dt><dd>${c.yield ? `${(c.yield * 100).toFixed(1)}% (${money(div, true)}/share/yr)` : "None"}</dd>${own ? `<dt>You own</dt><dd>${own.shares} shares @ ${money(own.cost, true)} avg</dd>` : ""}</dl>
      <div class="qty"><input class="inp" type="number" min="1" max="${Math.max(1, max)}" value="${Math.max(1, Math.min(max, 100))}" id="qty" aria-label="Number of shares" /><span class="muted">shares · max ${max.toLocaleString()} with your cash</span></div>
      <div class="actions"><button class="btn btn--accent" data-act="BUY" ${max < 1 ? "disabled" : ""}>Buy</button>${own && !intro ? `<button class="btn btn--pink" data-act="SELL_STOCK" data-ticker="${esc(c.ticker)}">Sell @ ${money(c.price)}</button>` : ""}<button class="btn btn--ghost" data-act="PASS">Pass</button></div></div>`;
  }
  if (c.type === "property") {
    const lt = loanTerms(p, c);
    const roi = c.down > 0 ? (lt.cashflow * 12) / c.down : 0;
    const short = c.down > p.cash;
    const diff = Math.abs(lt.rate - c.rate) > 1e-6;
    return `<div class="card">${intro}<p class="card__kicker">${c.size === "small" ? "Small deal" : "Big deal"} · ${c.category === "biz" ? "🏪 Business" : "🏠 Real estate"}</p><h4>${esc(c.name)}</h4><p class="story">"${esc(c.story)}"</p>
      <dl class="kv"><dt>Price</dt><dd>${money(c.price)}</dd><dt>Down payment</dt><dd>${money(c.down)}</dd><dt>Loan</dt><dd>${money(c.loan)} @ ${diff ? `<s class="muted">${(c.rate * 100).toFixed(2)}%</s> ` : ""}<b class="${diff ? (lt.rate < c.rate ? "pos" : "neg") : ""}">${(lt.rate * 100).toFixed(2)}%</b></dd>
      ${diff ? `<dt>Why your rate</dt><dd style="color:${lt.tier.color}">💳 ${lt.score} · ${lt.tier.label} credit</dd>` : ""}
      <dt>Income after operating costs</dt><dd>${money(c.noi)}/mo</dd><dt>Loan payment</dt><dd>−${money(lt.payment)}/mo</dd>
      <dt><b>Cashflow</b></dt><dd class="${cls(lt.cashflow)}">${money(lt.cashflow)}/mo</dd><dt>Cash-on-cash return</dt><dd class="${cls(roi)}">${(roi * 100).toFixed(1)}%/yr</dd></dl>
      ${lt.cashflow < 0 ? `<p class="neg" style="margin:8px 0 0">⚠️ Negative cashflow: this would cost you money every month.</p>` : ""}
      ${short ? `<p class="muted" style="margin:8px 0 0">You're ${money(c.down - p.cash)} short.${intro ? "" : " Borrow from the bank or sell something in 💼 Manage money."}</p>` : ""}
      <div class="actions"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy</button>${short && !intro ? `<button class="btn btn--ghost" data-act="stmt" data-id="${p.id}">💼 Raise cash</button>` : ""}<button class="btn btn--ghost" data-act="PASS">Pass</button></div></div>`;
  }
  if (c.type === "job") {
    return `<div class="card"><p class="card__kicker">💼 Job offer</p><h4>${esc(c.title)}</h4>
      <dl class="kv"><dt>Salary</dt><dd class="pos">${money(c.annual)}/yr</dd><dt>Per paycheck (gross)</dt><dd>${money(c.annual / 26)}</dd><dt>Field</dt><dd>${esc(c.category)}</dd></dl>
      <div class="actions"><button class="btn btn--accent" data-act="BUY">Accept offer</button><button class="btn btn--ghost" data-act="PASS">Keep looking</button></div></div>`;
  }
  if (c.type === "charity") {
    return `<div class="card"><p class="card__kicker">💛 Charity</p><h4>Donate ${money(c.amount)}?</h4><p class="story">That's 10% of a paycheck's income. Giving unlocks 2 dice for your next 3 turns.</p>
      <div class="actions"><button class="btn btn--accent" data-act="CHARITY" ${c.amount > p.cash ? "disabled" : ""}>Donate</button><button class="btn btn--ghost" data-act="PASS">Not this time</button></div></div>`;
  }
  if (c.type === "offer") {
    const mine = p.properties.filter((a) => a.propType === c.propType);
    return `<div class="card"><p class="card__kicker">📨 Buyer offer</p><h4>${Math.round(c.multiplier * 100)}% of value for any ${esc(c.propType.toLowerCase())}</h4>
      ${mine.map((a) => { const sale = Math.round((a.value * c.multiplier) / 500) * 500; return `<div class="row" style="justify-content:space-between;margin:6px 0"><span>${esc(a.name)}<br><small class="muted">Sells for ${money(sale)}, loan ${money(a.loan)}</small></span><button class="btn btn--pink btn--sm" data-act="SELL_ASSET" data-id="${a.id}">Sell (net ${money(sale - a.loan)})</button></div>`; }).join("")}
      <div class="actions"><button class="btn btn--ghost" data-act="PASS">Done</button></div></div>`;
  }
  if (c.type === "venture") {
    const short = c.price > p.cash;
    return `<div class="card"><p class="card__kicker">🏢 Fast Track business</p><h4>${esc(c.name)}</h4>
      <dl class="kv"><dt>Price (all cash)</dt><dd>${money(c.price)}</dd><dt>Adds cashflow</dt><dd class="pos">+${money(c.cashflow)}/mo</dd><dt>Return</dt><dd>${((c.cashflow * 12 / c.price) * 100).toFixed(1)}%/yr</dd><dt>Your Fast Track cashflow</dt><dd>${money(p.fast.added)} → ${money(p.fast.added + c.cashflow)} of ${money(FAST_WIN_CASHFLOW)}</dd></dl>
      <div class="actions"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy</button><button class="btn btn--ghost" data-act="PASS">Pass</button></div>${short ? `<p class="muted" style="margin:8px 0 0">You need ${money(c.price - p.cash)} more.</p>` : ""}</div>`;
  }
  if (c.type === "dream") {
    const short = c.price > p.cash;
    return `<div class="card card--dream"><p class="card__kicker">✨ Your dream</p><h4>${c.icon} ${esc(c.name)}</h4>
      <dl class="kv"><dt>Cost</dt><dd>${money(c.price)}</dd><dt>Your cash</dt><dd class="${short ? "neg" : "pos"}">${money(p.cash)}</dd></dl>
      <div class="actions"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy my dream 🏆</button><button class="btn btn--ghost" data-act="PASS">Not yet</button></div></div>`;
  }
  return "";
}

/** End-of-game report card: what everyone did, with a money lesson for each. */
function reportCard(g) {
  const w = g.players.find((x) => x.id === g.winner);
  const rows = report(g);
  const lesson = (r) => r.winner ? "Assets over everything. That's the play." :
    r.late >= 3 ? `${r.late} missed payments tanked your credit to ${r.credit}. Keep a cash cushion so bills never bounce.` :
    r.passive <= 0 ? "No passive income yet. Next game, buy your first cash-flowing asset early." :
    r.doodads > r.debtPaid && r.doodads > 5000 ? `Doodads cost ${money(r.doodads)}. That's a down payment on a rental!` :
    r.progress >= 0.5 ? "Over halfway out. A couple more good deals and you're free." :
    "Every asset counts. Keep stacking cashflow.";
  return `<div class="winner"><h3>🏆 ${esc(w.name)} wins!</h3><p class="muted">Round ${g.round}. ${g.fastTrack ? "Classic mode: escaped the rat race and won on the Fast Track." : `Passive income covered ${pct(g.goal)} of living expenses.`}</p></div>
    <div class="report"><h4>📋 Report card</h4>${rows.map((r) => `<div class="rc" style="--pc:${r.color}"><div class="row" style="justify-content:space-between"><b><span class="dot"></span> ${esc(r.name)}${r.winner ? " 🏆" : r.fast ? " 🚀" : ""}</b><span class="muted">${pct(r.progress)} free</span></div>
      <div class="rc__stats"><span>Net worth <b class="${cls(r.netWorth)}">${money(r.netWorth)}</b></span><span>Passive <b class="pos">${money(r.passive)}</b>/mo</span><span>Assets <b>${r.assets}</b></span><span>Debt paid <b>${money(r.debtPaid)}</b></span><span>Doodads <b class="neg">${money(r.doodads)}</b></span><span>Credit <b style="color:${creditTier(r.credit).color}">${r.credit}</b>${r.late ? ` (${r.late} missed)` : ""}</span><span>Trading P/L <b class="${cls(r.profit)}">${money(r.profit)}</b></span>${r.best ? `<span>Best deal <b>${esc(r.best.name)}</b> (${money(r.best.cashflow)}/mo)</span>` : ""}</div>
      <div class="rc__badges">${r.badges.map((b) => `<span title="${esc(BADGES[b].label)}">${BADGES[b].emoji} ${esc(BADGES[b].label)}</span>`).join("") || `<span class="muted">No badges yet</span>`}</div>
      <p class="rc__lesson">💡 ${esc(lesson(r))}</p></div>`).join("")}</div>
    <div class="actions"><button class="btn btn--accent" data-act="stmt" data-id="${w.id}">See ${esc(w.name)}'s statement</button><button class="btn btn--ghost" data-act="home">New game</button></div>`;
}

// ---------------------------------------------------------------- full statement (dialog)
/** canManage = it's this player's turn on this device and they've rolled. */
export function statementHTML(g, p, canManage) {
  const s = statement(p, g.goal);
  const line = (label, amt, cl = "") => `<tr><td>${esc(label)}</td><td class="${cl || (amt < 0 ? "neg" : "")}">${money(amt, true)}</td></tr>`;
  const bank = p.debts.bank;
  const quick = (st) => g.card && g.card.type === "stock" && g.card.ticker === st.ticker ? "Sell at market" : `Quick sell @ ${money(Math.max(1, Math.round(g.market[st.ticker].price * 0.8)))} (−20%)`;
  const t = p.tax || {};
  const debtRow = ([k, d]) => `<tr><td>${esc(d.label)} <small class="muted">${(d.rate * 100).toFixed(1)}% · ${money(d.monthly)}/mo</small>
      ${canManage ? `<div class="debtctl"><input class="inp inp--sm" type="number" min="100" step="100" value="${Math.max(100, Math.min(Math.floor(d.balance / 100) * 100, Math.floor(p.cash / 100) * 100) || 100)}" data-paydown="${k}" aria-label="Amount to pay toward ${esc(d.label)}" />
        <button class="btn btn--ghost btn--xs" data-act="PAY_DOWN" data-key="${k}">Pay down</button>${k !== "bank" ? `<button class="btn btn--ghost btn--xs" data-act="PAYOFF" data-key="${k}" ${d.balance > p.cash ? "disabled" : ""}>Pay off ${money(d.balance)}</button>` : ""}</div>` : ""}</td><td>${money(d.balance)}</td></tr>`;
  return `<button class="modal__close" data-act="close" aria-label="Close">×</button>
  <div class="fs-head"><div><p class="card__kicker" style="color:${p.color}">Financial statement · ${fmtDate(playerDate(g, p))} · ${p.taxYear} tax tables</p><h2>${esc(p.name)} <span class="badges">${badgeIcons(p)}</span></h2>
    ${lifeChips(p)}</div>
    <div class="stat"><small>Cash on hand</small><b>${money(p.cash, true)}</b></div></div>
  ${p.fast ? `<div class="escape"><div class="row"><span>🚀 <b>Fast Track</b>: Payout Day pays ${money(p.fast.base + p.fast.added)}. Dream ${p.dream.icon} ${esc(p.dream.name)}: ${money(p.dream.cost)}</span><span>${money(p.fast.added)} / ${money(FAST_WIN_CASHFLOW)} added</span></div><div class="progress"><span style="width:${pct(Math.min(1, p.cash / p.dream.cost))}"></span></div></div>` :
    `<div class="escape"><div class="row"><span>🐀 <b>Rat race escape</b>: monthly passive income vs ${g.goal < 1 ? `${Math.round(g.goal * 100)}% of ` : ""}monthly living expenses</span><span><b class="pos">${money(s.passive)}</b> / ${money(s.target)}</span></div><div class="progress"><span style="width:${pct(s.progress)}"></span></div></div>`}
  ${p.fast ? "" : `<div style="margin-top:14px">${creditHTML(p, true)}</div>`}
  <div class="fs">
    <section><h4>💵 Every paycheck</h4><p>Every 2 weeks, 26 times a year</p><table>
      ${s.paycheck.map((i) => line(i.label, i.amount)).join("") || `<tr><td class="muted">No paycheck right now</td><td></td></tr>`}
      ${s.deductions.length ? `<tr><td class="sub" colspan="2">Taken out before you see it</td></tr>${s.deductions.map((d) => line(d.label, -d.amount)).join("")}` : ""}
      <tr class="total"><td>Take-home pay</td><td class="${cls(s.takeHome)}">${money(s.takeHome, true)}</td></tr>
      ${s.notes.map((n) => `<tr><td class="muted">+ ${esc(n.label)}</td><td class="pos">${money(n.amount, true)}</td></tr>`).join("")}</table></section>
    <section><h4>🗓️ Every month</h4><p>On the 1st: passive income in, bills out</p><table>
      ${s.monthlyIn.length ? `<tr><td class="sub" colspan="2">Passive income</td></tr>${s.monthlyIn.map((i) => line(i.label, i.amount, i.amount >= 0 ? "pos" : "neg")).join("")}` : ""}
      <tr><td class="sub" colspan="2">Bills</td></tr>${s.bills.map((b) => line(b.label, -b.amount)).join("")}
      <tr class="total"><td>Bills total</td><td class="neg">${money(-s.billsTotal, true)}</td></tr>
      <tr class="total"><td>Monthly cashflow <small class="muted">(take-home × 26 ÷ 12 + passive − bills)</small></td><td class="${cls(s.monthlyCashflow)}">${money(s.monthlyCashflow, true)}</td></tr></table></section>
    <section><h4>📦 Assets</h4><p>What you own</p><table>
      ${line("401(k) / retirement (locked until retirement)", p.retirement)}${p.hsaBalance ? line("HSA", p.hsaBalance) : ""}${p.life.home ? line("Home (you live here)", p.life.home.price) : ""}
      ${p.stocks.map((st) => `<tr><td>${esc(st.ticker)} · ${st.shares} sh @ ${money(st.price)} <small class="${cls(st.price - st.cost)}">(paid ${money(st.cost, true)})</small>${st.div ? ` <small class="muted">(${money((st.shares * st.div) / 12, true)}/mo div)</small>` : ""}${canManage ? `<div class="debtctl"><input class="inp inp--sm" type="number" min="1" max="${st.shares}" value="${st.shares}" data-sellqty="${esc(st.ticker)}" aria-label="Shares to sell" /><button class="btn btn--danger btn--xs" data-act="SELL_STOCK" data-ticker="${esc(st.ticker)}">${quick(st)}</button></div>` : ""}</td><td>${money(st.shares * st.price)}</td></tr>`).join("")}
      ${p.properties.map((a) => `<tr><td>${esc(a.name)} <small class="${cls(a.cashflow)}">${money(a.cashflow)}/mo</small>${canManage ? ` <button class="btn btn--danger btn--xs" data-act="SELL_ASSET" data-id="${a.id}">Fire sale</button>` : ""}</td><td>${money(a.value)}</td></tr>`).join("")}
      ${p.fast ? p.fast.ventures.map((v) => `<tr><td>🏢 ${esc(v.name)} <small class="pos">+${money(v.cashflow)}/mo</small></td><td></td></tr>`).join("") : ""}
      <tr class="total"><td>Net worth</td><td class="${cls(s.netWorth)}">${money(s.netWorth)}</td></tr></table></section>
    <section><h4>🧾 Liabilities</h4><p>${canManage ? "Pay a debt off, or just pay part of it down" : "What you owe"}</p><table>
      ${Object.entries(p.debts).map(debtRow).join("")}
      ${p.properties.filter((a) => a.loan > 0).map((a) => line(`${a.name} loan`, a.loan)).join("")}
      ${!Object.keys(p.debts).length && !p.properties.some((a) => a.loan > 0) ? `<tr><td class="muted">Debt-free 🎉</td><td></td></tr>` : ""}</table>
      ${canManage ? `<div class="loanbox"><input class="inp" type="number" min="1000" step="1000" value="5000" id="loanAmt" aria-label="Loan amount" /><button class="btn btn--ghost btn--sm" data-act="BORROW">Borrow</button>${bank ? `<button class="btn btn--ghost btn--sm" data-act="REPAY">Repay</button>` : ""}</div><p class="muted" style="font-size:.78rem;margin:6px 0 0">Bank loans: $1,000 steps at ${((g.economy.personal + creditTier(creditScore(p)).personal) * 100).toFixed(1)}% for 5 years (${creditTier(creditScore(p)).label} credit). Each new loan is a hard inquiry (−6 points).</p>` : ""}
      ${p.tax ? `<p class="muted" style="font-size:.8rem;margin:12px 0 0">📬 <b>Taxes:</b> ${t.year} so far ${money(t.withheld || 0)} federal tax withheld vs ${money(t.owed || 0)} owed on wages${t.passive ? `, plus tax on ${money(t.passive)} of investment income` : ""}. ${t.pending ? `${t.pending.year} return: ${t.pending.amount >= 0 ? `<b class="pos">${money(t.pending.amount)} refund</b>` : `<b class="neg">${money(-t.pending.amount)} owed</b>`} in April.` : "Settles in April."}</p>` : ""}
    </section>
  </div>`;
}
