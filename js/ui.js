// Rendering: turns the game state into HTML. All buttons carry data-act="..." and are handled in main.js.
import { statement, tileInfo, current, actor, money, report, TILES, LENGTHS, K401_CHOICES, FAST_WIN_CASHFLOW, DREAMS, FAST_BOARD, BADGES } from "./engine.js";
import { FILING_LABEL } from "./tax.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const pct = (x) => `${Math.round(x * 100)}%`;
const cls = (n) => (n >= 0 ? "pos" : "neg");
const badgeIcons = (p) => p.badges.map((b) => `<span title="${esc(BADGES[b].label)}">${BADGES[b].emoji}</span>`).join("");

/** app = { game, mode, localIds:Set, viewerId, online:Set|null, code, timeLeft:()=>seconds|null } */
export function renderGame(app) {
  const g = app.game;
  renderTop(app);
  renderBoard(g);
  renderFast(g);
  renderTicker(app);
  renderTurn(app);
  renderMe(app);
  renderPlayers(app);
  renderLog(g);
}

function renderTop(app) {
  const g = app.game;
  $("topInfo").innerHTML = g
    ? `${app.code ? `<span class="chip">Room <b>${esc(app.code)}</b></span>` : ""}<span class="chip">Round ${g.round}</span><span class="chip" title="${esc(g.economy.headline)}">🌍 ${esc(g.economy.name)} · mortgage ${(g.economy.mortgage * 100).toFixed(1)}%</span><span class="chip" title="${esc(LENGTHS[g.length].desc)}">${esc(LENGTHS[g.length].label)} game</span><span class="chip" id="timerChip" hidden></span>`
    : app.code ? `<span class="chip">Room <b>${esc(app.code)}</b></span>` : "";
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

export function renderBoard(g, posOverride = null) {
  const cur = current(g);
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
  $("board").innerHTML = html;
}

/** The Fast Track: a ring of 24 tiles for players who escaped (Classic mode). */
function renderFast(g) {
  const el = $("fast");
  if (!g.fastTrack) { el.hidden = true; return; }
  el.hidden = false;
  const cur = current(g);
  const anyone = g.players.some((p) => p.fast);
  el.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">🚀 Fast Track</h3><span class="muted" style="font-size:.8rem">${anyone ? "Buy your dream or add " + money(FAST_WIN_CASHFLOW) + "/mo to win" : "Escape the rat race to get here"}</span></div>
    <div class="fastboard ${anyone ? "" : "is-locked"}">${FAST_BOARD.map((t, i) => {
      const info = tileInfo(t), here = g.players.filter((p) => p.fast && p.fast.pos === i);
      return `<div class="ftile ${cur.fast && cur.fast.pos === i ? "is-current" : ""}" style="--c:${info.color}" title="${esc(`${t}: ${info.tip}`)}"><span>${info.icon}</span>${here.map((p) => `<i class="token" style="--pc:${p.color}" title="${esc(p.name)}"></i>`).join("")}</div>`;
    }).join("")}</div>`;
}

/** Stock ticker with sparklines. */
function sparkline(hist, w = 70, h = 22) {
  if (hist.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const lo = Math.min(...hist), hi = Math.max(...hist), span = hi - lo || 1;
  const pts = hist.map((v, i) => `${((i / (hist.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = hist[hist.length - 1] >= hist[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${up ? "var(--mint)" : "var(--red)"}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function renderTicker(app) {
  const g = app.game, el = $("ticker");
  const me = g.players.find((x) => x.id === app.viewerId) || current(g);
  const rows = Object.entries(g.market).map(([t, m]) => {
    const prev = m.hist.length > 1 ? m.hist[m.hist.length - 2] : m.price;
    const ch = prev ? (m.price - prev) / prev : 0;
    const own = me.stocks.find((s) => s.ticker === t);
    return `<div class="tick ${g.card && g.card.ticker === t ? "is-live" : ""}"><span class="tick__name">${esc(t)}${m.fund ? ` <small class="muted">fund</small>` : ""}${own ? ` <small class="pos">· you: ${own.shares}</small>` : ""}</span>${sparkline(m.hist)}<b>${money(m.price)}</b><small class="${cls(ch)}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(1)}%</small></div>`;
  }).join("");
  el.innerHTML = `<details ${store.get("cf.tickerOpen", true) ? "open" : ""} id="tickerDetails"><summary><h3 style="display:inline">📈 Market</h3> <span class="muted" style="font-size:.8rem">prices drift every round; news moves them</span></summary><div class="ticks">${rows}</div></details>`;
  $("tickerDetails").addEventListener("toggle", (e) => store.set("cf.tickerOpen", e.target.open));
}
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

export function showDice(dice) {
  const el = $("dice");
  if (!dice) { el.innerHTML = ""; return; }
  el.innerHTML = dice.map((d) => `<span class="die">${d}</span>`).join("");
  clearTimeout(showDice.t);
  showDice.t = setTimeout(() => (el.innerHTML = ""), 1400);
}

function renderTurn(app) {
  const g = app.game, el = $("turn");
  if (g.winner) { el.innerHTML = reportCard(g); return; }
  const p = current(g), a = actor(g), mine = app.localIds.has(a.id);
  const head = `<div class="turn__head" style="--pc:${p.color}"><span class="dot"></span><div><h3>${esc(p.name)}'s turn${app.localIds.has(p.id) && app.mode !== "local" ? " (you)" : ""}</h3><span class="muted">${p.fast ? "🚀 On the Fast Track" : esc(p.job.employed ? p.job.title : "Between jobs")} · ${esc(p.life.city)}, ${esc(p.life.state)}</span></div></div>`;
  if (!mine) {
    const off = app.online && !app.online.has(a.id);
    el.innerHTML = head + `<p class="waiting">${g.phase === "share" ? `${esc(a.name)} is deciding whether to buy ${esc(p.name)}'s deal…` : `Waiting for ${esc(a.name)}…`} ${off ? "(offline, will be auto-skipped)" : ""}</p>`;
    return;
  }

  let body = "";
  if (g.phase === "share") {
    body = shareHTML(g, a, p);
  } else if (g.phase === "roll") {
    const two = p.fast || p.charityTurns;
    body = `<div class="actions"><button class="btn btn--accent" data-act="ROLL">🎲 Roll${two ? " 2 dice" : ""}</button></div>${!p.fast && p.charityTurns ? `<p class="muted">💛 Charity bonus: 2 dice for ${p.charityTurns} more turn${p.charityTurns > 1 ? "s" : ""}.</p>` : ""}`;
    if (g.round === 1 && !p.fast) body += dreamPicker(p);
  } else if (g.phase === "choose") {
    body = `<div class="card"><p class="card__kicker">💡 Opportunity</p><h4>Small deal or big deal?</h4>
      <div class="choose"><button data-act="DEAL" data-size="small"><b>Small deal</b><span>Stocks, funds, starter homes, small businesses. Cheaper, smaller cashflow.</span></button>
      <button data-act="DEAL" data-size="big"><b>Big deal</b><span>Apartment buildings, commercial property, bigger businesses. Needs serious cash.</span></button></div>
      <p class="muted" style="margin:10px 0 0">You have ${money(p.cash)} in cash.</p></div>`;
  } else if (g.phase === "decide") {
    body = cardHTML(g, p);
  } else {
    body = `<div class="actions"><button class="btn btn--ghost" data-act="stmt" data-id="${p.id}">💼 Manage money</button><button class="btn btn--accent" data-act="END_TURN">End turn →</button></div>
      <p class="muted" style="margin:10px 0 0">Sell assets, pay off debt or take a loan before you end your turn.</p>`;
  }
  el.innerHTML = head + body;
}

function dreamPicker(p) {
  return `<div class="dreams"><p class="muted" style="margin:12px 0 6px">✨ Pick your dream (what you'll buy once you're financially free):</p>${p.dreamOptions.map((id) => {
    const d = DREAMS.find((x) => x.id === id);
    return `<button class="dream ${p.dream.id === id ? "is-on" : ""}" data-act="PICK_DREAM" data-id="${id}"><span>${d.icon}</span><b>${esc(d.name)}</b><small>${money(d.cost)}</small></button>`;
  }).join("")}</div>`;
}

function shareHTML(g, a, from) {
  const c = g.share.card;
  const fromPlayer = g.players.find((x) => x.id === g.share.from);
  const intro = `<p class="card__kicker">🤝 Deal up for grabs</p><p class="muted" style="margin:0 0 8px">${esc(fromPlayer.name)} ${c.type === "stock" ? "bought this stock, so it's open to everyone at the same price" : "passed on this deal"}. ${esc(a.name)}, want in?</p>`;
  return cardHTML(g, a, c, intro);
}

function cardHTML(g, p, c = g.card, intro = "") {
  if (!c) return "";
  if (c.type === "stock") {
    const own = p.stocks.find((s) => s.ticker === c.ticker);
    const max = Math.floor(p.cash / c.price);
    const div = c.price * c.yield;
    const hist = g.market[c.ticker] ? g.market[c.ticker].hist : [c.price];
    return `<div class="card">${intro}<p class="card__kicker">${c.fund ? "📊 Fund" : "📈 Stock"}</p><h4>${esc(c.ticker)} ${sparkline(hist, 90, 26)}</h4><p class="story">"${esc(c.story)}"</p>
      <dl class="kv"><dt>Price per share</dt><dd>${money(c.price)}</dd><dt>Recent range</dt><dd>${money(Math.min(...hist))} – ${money(Math.max(...hist))}</dd>
      <dt>Dividend</dt><dd>${c.yield ? `${(c.yield * 100).toFixed(1)}% (${money(div, true)}/share/yr)` : "none"}</dd>${own ? `<dt>You own</dt><dd>${own.shares} shares @ ${money(own.cost, true)} avg</dd>` : ""}</dl>
      <div class="qty"><input class="inp" type="number" min="1" max="${Math.max(1, max)}" value="${Math.max(1, Math.min(max, 100))}" id="qty" aria-label="Number of shares" /><span class="muted">shares · max ${max.toLocaleString()} with your cash</span></div>
      <div class="actions"><button class="btn btn--accent" data-act="BUY" ${max < 1 ? "disabled" : ""}>Buy</button>${own && !intro ? `<button class="btn btn--pink" data-act="SELL_STOCK" data-ticker="${esc(c.ticker)}">Sell shares @ ${money(c.price)}</button>` : ""}<button class="btn btn--ghost" data-act="PASS">Pass</button></div></div>`;
  }
  if (c.type === "property") {
    const roi = c.down > 0 ? (c.cashflow * 12) / c.down : 0;
    const short = c.down > p.cash;
    return `<div class="card">${intro}<p class="card__kicker">${c.size === "small" ? "Small deal" : "Big deal"} · ${c.category === "biz" ? "🏪 Business" : "🏠 Real estate"}</p><h4>${esc(c.name)}</h4><p class="story">"${esc(c.story)}"</p>
      <dl class="kv"><dt>Price</dt><dd>${money(c.price)}</dd><dt>Down payment</dt><dd>${money(c.down)}</dd><dt>Loan</dt><dd>${money(c.loan)} @ ${(c.rate * 100).toFixed(1)}%</dd>
      <dt>Income after operating costs</dt><dd>${money(c.noi)}/mo</dd><dt>Loan payment</dt><dd>−${money(c.payment)}/mo</dd>
      <dt><b>Cashflow</b></dt><dd class="${cls(c.cashflow)}">${money(c.cashflow)}/mo</dd><dt>Cash-on-cash return</dt><dd class="${cls(roi)}">${(roi * 100).toFixed(1)}%/yr</dd></dl>
      ${c.cashflow < 0 ? `<p class="neg" style="margin:8px 0 0">⚠️ Negative cashflow: this would cost you money every month.</p>` : ""}
      ${short ? `<p class="muted" style="margin:8px 0 0">You're ${money(c.down - p.cash)} short.${intro ? "" : " Borrow from the bank or sell something in 💼 Manage money."}</p>` : ""}
      <div class="actions" style="margin-top:10px"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy</button>${short && !intro ? `<button class="btn btn--ghost" data-act="stmt" data-id="${p.id}">💼 Raise cash</button>` : ""}<button class="btn btn--ghost" data-act="PASS">Pass</button></div></div>`;
  }
  if (c.type === "job") {
    return `<div class="card"><p class="card__kicker">💼 Job offer</p><h4>${esc(c.title)}</h4>
      <dl class="kv"><dt>Salary</dt><dd class="pos">${money(c.annual)}/yr</dd><dt>Per paycheck (gross)</dt><dd>${money(c.annual / 26)}</dd><dt>Field</dt><dd>${esc(c.category)}</dd></dl>
      <div class="actions" style="margin-top:10px"><button class="btn btn--accent" data-act="BUY">Accept offer</button><button class="btn btn--ghost" data-act="PASS">Keep looking</button></div></div>`;
  }
  if (c.type === "charity") {
    return `<div class="card"><p class="card__kicker">💛 Charity</p><h4>Donate ${money(c.amount)}?</h4><p class="story">That's 10% of a paycheck's income. Giving unlocks 2 dice for your next 3 turns.</p>
      <div class="actions"><button class="btn btn--accent" data-act="CHARITY" ${c.amount > p.cash ? "disabled" : ""}>Donate</button><button class="btn btn--ghost" data-act="PASS">Not this time</button></div></div>`;
  }
  if (c.type === "offer") {
    const mine = p.properties.filter((a) => a.propType === c.propType);
    return `<div class="card"><p class="card__kicker">📨 Buyer offer</p><h4>${Math.round(c.multiplier * 100)}% of value for any ${esc(c.propType.toLowerCase())}</h4>
      ${mine.map((a) => { const sale = Math.round((a.value * c.multiplier) / 500) * 500; return `<div class="row" style="justify-content:space-between;margin:6px 0"><span>${esc(a.name)}<br><small class="muted">sells for ${money(sale)}, loan ${money(a.loan)}</small></span><button class="btn btn--pink btn--sm" data-act="SELL_ASSET" data-id="${a.id}">Sell (net ${money(sale - a.loan)})</button></div>`; }).join("")}
      <div class="actions" style="margin-top:8px"><button class="btn btn--ghost" data-act="PASS">Done</button></div></div>`;
  }
  if (c.type === "venture") {
    const short = c.price > p.cash;
    return `<div class="card"><p class="card__kicker">🏢 Fast Track business</p><h4>${esc(c.name)}</h4>
      <dl class="kv"><dt>Price (all cash)</dt><dd>${money(c.price)}</dd><dt>Adds cashflow</dt><dd class="pos">+${money(c.cashflow)}/mo</dd><dt>Return</dt><dd>${((c.cashflow * 12 / c.price) * 100).toFixed(1)}%/yr</dd><dt>Your Fast Track cashflow</dt><dd>${money(p.fast.added)} → ${money(p.fast.added + c.cashflow)} of ${money(FAST_WIN_CASHFLOW)}</dd></dl>
      <div class="actions" style="margin-top:10px"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy</button><button class="btn btn--ghost" data-act="PASS">Pass</button></div>${short ? `<p class="muted" style="margin:8px 0 0">You need ${money(c.price - p.cash)} more.</p>` : ""}</div>`;
  }
  if (c.type === "dream") {
    const short = c.price > p.cash;
    return `<div class="card card--dream"><p class="card__kicker">✨ Your dream</p><h4>${c.icon} ${esc(c.name)}</h4>
      <dl class="kv"><dt>Cost</dt><dd>${money(c.price)}</dd><dt>Your cash</dt><dd class="${short ? "neg" : "pos"}">${money(p.cash)}</dd></dl>
      <div class="actions" style="margin-top:10px"><button class="btn btn--accent" data-act="BUY" ${short ? "disabled" : ""}>Buy my dream 🏆</button><button class="btn btn--ghost" data-act="PASS">Not yet</button></div></div>`;
  }
  return "";
}

/** End-of-game report card: what everyone did, with a money lesson for each. */
function reportCard(g) {
  const w = g.players.find((x) => x.id === g.winner);
  const rows = report(g);
  const lesson = (r) => r.winner ? "Assets over everything. That's the play." :
    r.passive <= 0 ? "No passive income yet. Next game, buy your first cash-flowing asset early." :
    r.doodads > r.debtPaid && r.doodads > 5000 ? `Doodads cost ${money(r.doodads)}. That's a down payment on a rental!` :
    r.progress >= 0.5 ? "Over halfway out. A couple more good deals and you're free." :
    "Every asset counts. Keep stacking cashflow.";
  return `<div class="winner"><h3>🏆 ${esc(w.name)} wins!</h3><p class="muted">Round ${g.round}. ${g.fastTrack ? "Classic mode: escaped the rat race and won on the Fast Track." : `Passive income covered ${pct(g.goal)} of living expenses.`}</p></div>
    <div class="report"><h4>📋 Report card</h4>${rows.map((r) => `<div class="rc" style="--pc:${r.color}"><div class="row" style="justify-content:space-between"><b><span class="dot" style="display:inline-block;width:10px;height:10px"></span> ${esc(r.name)}${r.winner ? " 🏆" : r.fast ? " 🚀" : ""}</b><span class="muted">${pct(r.progress)} free</span></div>
      <div class="rc__stats"><span>Net worth <b class="${cls(r.netWorth)}">${money(r.netWorth)}</b></span><span>Passive <b class="pos">${money(r.passive)}</b>/check</span><span>Assets <b>${r.assets}</b></span><span>Debt paid <b>${money(r.debtPaid)}</b></span><span>Doodads <b class="neg">${money(r.doodads)}</b></span><span>Trading P/L <b class="${cls(r.profit)}">${money(r.profit)}</b></span>${r.best ? `<span>Best deal <b>${esc(r.best.name)}</b> (${money(r.best.cashflow)}/mo)</span>` : ""}</div>
      <div class="rc__badges">${r.badges.map((b) => `<span title="${esc(BADGES[b].label)}">${BADGES[b].emoji} ${esc(BADGES[b].label)}</span>`).join("") || `<span class="muted">No badges yet</span>`}</div>
      <p class="rc__lesson">💡 ${esc(lesson(r))}</p></div>`).join("")}</div>
    <div class="actions"><button class="btn btn--accent" data-act="stmt" data-id="${w.id}">See ${esc(w.name)}'s statement</button><button class="btn btn--ghost" data-act="home">New game</button></div>`;
}

function renderMe(app) {
  const g = app.game;
  const p = g.players.find((x) => x.id === app.viewerId) || current(g);
  const s = statement(p, g.goal);
  const canSet = app.localIds.has(p.id) && actor(g).id === p.id && g.phase !== "share" && !g.winner && p.job.employed && !p.job.gig && !p.fast;
  const k401 = p.job.employed && !p.job.gig && !p.fast ? `<div class="k401"><span>🏦 401(k)${p.job.match ? ` <small class="muted">(employer matches 50% up to 6%)</small>` : ""}</span><div class="seg">${K401_CHOICES.map((r) => `<button data-act="SET_401K" data-rate="${r}" class="${Math.abs(p.k401Rate - r) < 1e-9 ? "is-on" : ""}" ${canSet ? "" : "disabled"}>${Math.round(r * 100)}%</button>`).join("")}</div></div>` : "";
  const fast = p.fast ? `<div class="fastme"><div class="row" style="justify-content:space-between"><span>💸 CashFlow Day pays</span><b class="pos">${money(p.fast.base + p.fast.added)}</b></div>
      <div class="row" style="justify-content:space-between"><span>${p.dream.icon} Dream: ${esc(p.dream.name)}</span><b>${money(p.dream.cost)}</b></div>
      <div class="progress"><span style="width:${pct(Math.min(1, p.cash / p.dream.cost))}"></span></div>
      <div class="row" style="justify-content:space-between;font-size:.82rem;margin-top:6px"><span class="muted">Or add ${money(FAST_WIN_CASHFLOW)}/mo in businesses</span><span>${money(p.fast.added)}/mo</span></div></div>` :
    `<div class="row" style="justify-content:space-between;font-size:.86rem;margin-bottom:6px"><span>🐀 Rat race escape</span><span><b class="pos">${money(s.passive)}</b> / ${money(s.target)} passive per check</span></div>
    <div class="progress"><span style="width:${pct(s.progress)}"></span></div>
    <p class="muted" style="font-size:.78rem;margin:6px 0 0">✨ Dream: ${p.dream.icon} ${esc(p.dream.name)} (${money(p.dream.cost)})</p>`;
  $("me").innerHTML = `<div class="me__top"><h3 style="margin:0">${app.mode === "local" ? `${esc(p.name)}'s money` : "Your money"} <span class="badges">${badgeIcons(p)}</span></h3><button class="btn btn--ghost btn--sm" data-act="stmt" data-id="${p.id}">Full statement</button></div>
    <p class="muted" style="margin:4px 0 0"><span class="me__job">${esc(p.job.employed ? p.job.title : `Between jobs (was ${p.job.title})`)}</span> · ${esc(p.life.city)}, ${esc(p.life.state)}</p>
    <div class="stats"><div class="stat"><small>Cash</small><b>${money(p.cash)}</b></div><div class="stat"><small>Payday</small><b class="${cls(s.netPay)}">${money(s.netPay)}</b></div><div class="stat"><small>Net worth</small><b class="${cls(s.netWorth)}">${money(s.netWorth)}</b></div></div>
    ${fast}${k401}`;
}

function renderPlayers(app) {
  const g = app.game, cur = current(g);
  $("players").innerHTML = `<h3>Players</h3><div class="plist">${g.players.map((p) => {
    const s = statement(p, g.goal);
    const off = app.online && !app.online.has(p.id);
    const prog = p.fast ? Math.min(1, p.cash / p.dream.cost) : s.progress;
    return `<button class="prow ${p.id === cur.id ? "is-turn" : ""}" style="--pc:${p.color}" data-act="stmt" data-id="${p.id}">
      <span class="dot"></span><span><b>${esc(p.name)}</b> <span class="badges">${badgeIcons(p)}</span> ${off ? `<span class="badge badge--off">offline</span>` : ""}${p.skip ? `<span class="badge">skips a turn</span>` : ""}${p.fast ? `<span class="badge badge--fast">🚀 Fast Track</span>` : ""}<small>${esc(p.job.employed ? p.job.title : "Between jobs")} · cash ${money(p.cash)}</small><span class="progress"><span style="width:${pct(prog)}"></span></span></span><span class="badge">${p.fast ? `${p.dream.icon} ${pct(prog)}` : pct(s.progress)}</span></button>`;
  }).join("")}</div>`;
}

function renderLog(g) {
  const el = $("log");
  const color = Object.fromEntries(g.players.map((p) => [p.id, p.color]));
  el.innerHTML = `<h3>Feed</h3>` + g.log.slice(-60).reverse().map((l) => `<p class="${l.kind}" style="${l.pid ? `--pc:${color[l.pid]}` : ""}">${esc(l.text)}</p>`).join("");
}

/** Full financial statement (dialog). canManage = it's this player's turn on this device and they've rolled. */
export function statementHTML(g, p, canManage) {
  const s = statement(p, g.goal);
  const line = (label, amt, extra = "") => `<tr><td>${esc(label)}${extra}</td><td class="${amt < 0 ? "neg" : ""}">${money(amt, true)}</td></tr>`;
  const taxes = s.expenses.filter((e) => e.kind === "tax"), savings = s.expenses.filter((e) => e.kind === "savings"), living = s.expenses.filter((e) => e.kind === "living");
  const debtKey = Object.fromEntries(Object.entries(p.debts).map(([k, d]) => [d.label, k]));
  const sp = p.life.spouse;
  const bank = p.debts.bank;
  const quick = (st) => g.card && g.card.type === "stock" && g.card.ticker === st.ticker ? "Sell at market" : `Quick sell @ ${money(Math.max(1, Math.round(g.market[st.ticker].price * 0.8)))} (−20%)`;
  return `<button class="modal__close" data-act="close" aria-label="Close">×</button>
  <div class="fs-head"><div><p class="card__kicker" style="color:${p.color}">Financial statement · per paycheck (bi-weekly) · ${p.taxYear} tax tables</p><h2>${esc(p.name)} <span class="badges">${badgeIcons(p)}</span></h2>
    <p class="fs-life">${esc(p.job.employed ? `${p.job.title}, ${money(p.job.annual)}/yr` : `Between jobs (was ${p.job.title})`)} · ${esc(p.life.city)}, ${esc(p.life.state)} · ${esc(FILING_LABEL[p.life.filing])}${sp ? ` · spouse: ${esc(sp.title)} (${money(sp.annual)}/yr)` : ""}${p.life.children ? ` · ${p.life.children} kid${p.life.children > 1 ? "s" : ""}` : ""} · ${p.life.housing === "own" ? "homeowner" : "renter"} · drives a ${esc(p.life.car)}</p></div>
    <div class="stat"><small>Cash on hand</small><b>${money(p.cash, true)}</b></div></div>
  ${p.fast ? `<div class="escape"><div class="row"><span>🚀 <b>Fast Track</b>: CashFlow Day pays ${money(p.fast.base + p.fast.added)}. Dream ${p.dream.icon} ${esc(p.dream.name)}: ${money(p.dream.cost)}</span><span>${money(p.fast.added)} / ${money(FAST_WIN_CASHFLOW)} added</span></div><div class="progress"><span style="width:${pct(Math.min(1, p.cash / p.dream.cost))}"></span></div></div>` :
    `<div class="escape"><div class="row"><span>🐀 <b>Rat race escape</b>: passive income vs ${g.goal < 1 ? `${Math.round(g.goal * 100)}% of ` : ""}living expenses</span><span><b class="pos">${money(s.passive, true)}</b> / ${money(s.target, true)}</span></div><div class="progress"><span style="width:${pct(s.progress)}"></span></div></div>`}
  <div class="fs">
    <section><h4>Income</h4><table>${s.income.map((i) => line(i.label, i.amount)).join("") || `<tr><td class="muted">No income right now</td><td></td></tr>`}<tr class="total"><td>Total income</td><td>${money(s.totalIncome, true)}</td></tr>
      ${s.notes.map((n) => `<tr><td class="muted">+ ${esc(n.label)}</td><td class="pos">${money(n.amount, true)}</td></tr>`).join("")}</table></section>
    <section><h4>Expenses</h4><table>
      ${taxes.length ? `<tr><td class="sub" colspan="2">Taxes</td></tr>${taxes.map((e) => line(e.label, e.amount)).join("")}` : ""}
      ${savings.length ? `<tr><td class="sub" colspan="2">Pre-tax savings</td></tr>${savings.map((e) => line(e.label, e.amount)).join("")}` : ""}
      <tr><td class="sub" colspan="2">Living expenses</td></tr>
      ${living.map((e) => { const k = debtKey[e.label]; const d = k && p.debts[k]; return line(e.label, e.amount, canManage && d && k !== "bank" ? ` <button class="btn btn--ghost btn--sm" data-act="PAYOFF" data-key="${k}" ${d.balance > p.cash ? "disabled" : ""} title="Pay off the ${money(d.balance)} balance">Pay off ${money(d.balance)}</button>` : ""); }).join("")}
      <tr class="total"><td>Total expenses</td><td>${money(s.totalExpenses, true)}</td></tr>
      <tr class="total"><td>Payday (income − expenses)</td><td class="${cls(s.netPay)}">${money(s.netPay, true)}</td></tr></table></section>
    <section><h4>Assets</h4><table>
      ${line("401(k) / retirement (locked until retirement)", p.retirement)}${p.hsaBalance ? line("HSA", p.hsaBalance) : ""}${p.life.home ? line("Home (you live here)", p.life.home.price) : ""}
      ${p.stocks.map((st) => `<tr><td>${esc(st.ticker)} · ${st.shares} sh @ ${money(st.price)} <small class="${cls(st.price - st.cost)}">(paid ${money(st.cost, true)})</small>${st.div ? ` <small class="muted">(${money((st.shares * st.div) / 12, true)}/mo div)</small>` : ""}${canManage ? `<br><span class="loanbox"><input class="inp" type="number" min="1" max="${st.shares}" value="${st.shares}" data-sellqty="${esc(st.ticker)}" aria-label="Shares to sell" /><button class="btn btn--danger btn--sm" data-act="SELL_STOCK" data-ticker="${esc(st.ticker)}">${quick(st)}</button></span>` : ""}</td><td>${money(st.shares * st.price)}</td></tr>`).join("")}
      ${p.properties.map((a) => `<tr><td>${esc(a.name)} <small class="${cls(a.cashflow)}">${money(a.cashflow)}/mo</small>${canManage ? ` <button class="btn btn--danger btn--sm" data-act="SELL_ASSET" data-id="${a.id}">Fire sale</button>` : ""}</td><td>${money(a.value)}</td></tr>`).join("")}
      ${p.fast ? p.fast.ventures.map((v) => `<tr><td>🏢 ${esc(v.name)} <small class="pos">+${money(v.cashflow)}/mo</small></td><td></td></tr>`).join("") : ""}
      <tr class="total"><td>Net worth</td><td class="${cls(s.netWorth)}">${money(s.netWorth)}</td></tr></table></section>
    <section><h4>Liabilities</h4><table>${s.liabilities.map((l) => line(l.label, l.value)).join("") || `<tr><td class="muted">Debt-free 🎉</td><td></td></tr>`}</table>
      ${canManage ? `<div class="loanbox"><input class="inp" type="number" min="1000" step="1000" value="5000" id="loanAmt" aria-label="Loan amount" /><button class="btn btn--ghost btn--sm" data-act="BORROW">Borrow</button>${bank ? `<button class="btn btn--ghost btn--sm" data-act="REPAY">Repay</button>` : ""}</div><p class="muted" style="font-size:.8rem;margin:6px 0 0">Bank loans: $1,000 steps at ${(g.economy.personal * 100).toFixed(0)}% for 5 years.</p>` : ""}
    </section>
  </div>`;
}
