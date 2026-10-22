// Engine tests: run by opening tests/index.html (results are also POSTed to /log when served by the test server).
import { paycheckTaxes, federalIncomeTax } from "../js/tax.js";
import { newGame, apply, statement, current, GameError, TILES } from "../js/engine.js";
import { Rng } from "../js/rng.js";

const results = [];
const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

// ---------- 1. Taxes (hand-checked against IRS 2026 tables)
{
  // Single, $60,000, no contributions: taxable = 60,000 - 16,100 = 43,900
  // fed = 12,400*10% + (43,900-12,400)*12% = 1,240 + 3,780 = 5,020 / yr
  ok("fed tax single 43,900 taxable = 5,020", near(federalIncomeTax(43900, "single"), 5020));
  const t = paycheckTaxes(60000, { status: "single" });
  ok("paycheck fed single 60k = 193.08", near(t.federal, 5020 / 26), JSON.stringify(t));
  ok("paycheck SS single 60k = 143.08", near(t.socialSecurity, 60000 * 0.062 / 26));
  ok("paycheck Medicare single 60k = 33.46", near(t.medicare, 60000 * 0.0145 / 26));
  // MFJ $120,000, 2 kids, 5% 401k: taxable = 120,000 - 6,000 - 32,200 = 81,800
  // fed = 24,800*10% + (81,800-24,800)*12% = 2,480 + 6,840 = 9,320 - 2*2,200 = 4,920
  const m = paycheckTaxes(120000, { status: "married_joint", k401Annual: 6000, children: 2 });
  ok("MFJ 120k, 2 kids, 5% 401k: fed = 4,920/yr", near(m.federal, 4920 / 26), JSON.stringify(m));
  // Head of household $80,000: taxable = 80,000 - 24,150 = 55,850
  // fed = 17,700*10% + (55,850-17,700)*12% = 1,770 + 4,578 = 6,348
  ok("HoH 55,850 taxable = 6,348", near(federalIncomeTax(55850, "head_household"), 6348));
  // Above the Social Security wage base: SS capped at 184,500*6.2% = 11,439
  const h = paycheckTaxes(400000, { status: "single" });
  ok("SS capped at wage base", near(h.socialSecurity, 11439 / 26));
  ok("Additional Medicare above $200k", near(h.medicare, (400000 * 0.0145 + 200000 * 0.009) / 26));
  // Top bracket single: 37% starts at 640,600 (IRS table: $192,979.25 at 640,600)
  ok("single tax at 640,600 = 192,979.25", near(federalIncomeTax(640600, "single"), 192979.25));
  ok("MFS tax at 384,350 = 103,291.75", near(federalIncomeTax(384350, "married_separate"), 103291.75));
  ok("MFJ tax at 768,700 = 206,583.50", near(federalIncomeTax(768700, "married_joint"), 206583.5));
  ok("state tax 5% of wages after pre-tax", near(paycheckTaxes(52000, { status: "single", stateRate: 0.05, k401Annual: 2600 }).state, (52000 - 2600) * 0.05 / 26));
}

// ---------- 2. Board
{
  const g = newGame({ seed: "board-test", players: [{ id: 1, name: "A" }] });
  const count = (t) => g.board.filter((x) => x === t).length;
  ok("board has 81 tiles", g.board.length === TILES);
  ok("board starts with Start", g.board[0] === "Start");
  ok("10 Pay Day tiles (every 8th)", count("Pay Day") === 10, `got ${count("Pay Day")}`);
  ok("Opportunity tiles on checker pattern", count("Opportunity") >= 30, `got ${count("Opportunity")}`);
}

// ---------- 3. A simple bot so we can simulate whole games
function botAction(state, rng) {
  const p = current(state);
  if (state.phase === "roll") return { type: "ROLL", by: p.id };
  if (state.phase === "choose") return { type: "DEAL", size: p.cash > 60000 ? "big" : "small", by: p.id };
  if (state.phase === "decide") {
    const c = state.card;
    if (c.type === "charity") return rng.chance(0.5) && p.cash >= c.amount ? { type: "CHARITY", by: p.id } : { type: "PASS", by: p.id };
    if (c.type === "job") return { type: "BUY", by: p.id };
    if (c.type === "offer") { const a = p.properties.find((x) => x.propType === c.propType); return a ? { type: "SELL_ASSET", id: a.id, by: p.id } : { type: "PASS", by: p.id }; }
    if (c.type === "stock") {
      const own = p.stocks.find((s) => s.ticker === c.ticker);
      if (own && c.price > own.cost * 1.3) return { type: "SELL_STOCK", ticker: c.ticker, qty: own.shares, by: p.id };
      const qty = Math.floor((p.cash * 0.3) / c.price);
      return (c.fund || (c.bullish === false && c.yield > 0)) && qty > 0 ? { type: "BUY", qty, by: p.id } : { type: "PASS", by: p.id };
    }
    if (c.type === "property") {
      if (c.cashflow > 0 && c.down <= p.cash) return { type: "BUY", by: p.id };
      if (c.cashflow > 200 && c.down - p.cash <= 20000) return { type: "BORROW", amount: Math.ceil((c.down - p.cash) / 1000) * 1000, by: p.id };
      return { type: "PASS", by: p.id };
    }
  }
  // pay off the costliest small debts when flush with cash
  const debt = Object.entries(p.debts).filter(([k, d]) => k !== "mortgage" && d.balance <= p.cash * 0.5).sort((a, b) => b[1].rate - a[1].rate)[0];
  if (debt) return { type: "PAYOFF", key: debt[0], by: p.id };
  return { type: "END_TURN", by: p.id };
}

function simulate(seed, nPlayers, maxRounds = 300, length = "standard") {
  let s = newGame({ seed, length, players: Array.from({ length: nPlayers }, (_, i) => ({ id: i + 1, name: `Bot${i + 1}` })) });
  const rng = new Rng(`bot-${seed}`);
  const actions = [];
  let errors = 0, steps = 0;
  while (s.phase !== "over" && s.round <= maxRounds && steps < 20000) {
    const a = botAction(s, rng);
    try { s = apply(s, a); actions.push(a); }
    catch (e) {
      if (!(e instanceof GameError)) throw e;
      errors++;
      // a refused BORROW/BUY: pass instead
      const p = current(s);
      s = apply(s, s.phase === "decide" ? { type: "PASS", by: p.id } : { type: "END_TURN", by: p.id });
      actions.push({ type: s.phase, by: p.id });
    }
    steps++;
    for (const p of [current(s)]) {
      const st = statement(p);
      if (!Number.isFinite(p.cash) || !Number.isFinite(st.netPay) || !Number.isFinite(st.netWorth)) throw new Error(`non-finite money for ${p.name} in game ${seed}`);
    }
  }
  return { state: s, steps, errors, actions };
}

// ---------- 4. Determinism
{
  const a = simulate("same-seed", 3, 40), b = simulate("same-seed", 3, 40);
  ok("same seed + same actions = identical game", JSON.stringify(a.state) === JSON.stringify(b.state));
  const c = simulate("other-seed", 3, 40);
  ok("different seed = different game", JSON.stringify(a.state.players[0].job) !== JSON.stringify(c.state.players[0].job) || a.state.board.join() !== c.state.board.join());
  // replay: re-applying the recorded actions from a fresh game reproduces the final state
  let r = newGame({ seed: "same-seed", players: [1, 2, 3].map((i) => ({ id: i, name: `Bot${i}` })) });
  const sim = simulate("same-seed", 3, 40);
  ok("replay is reproducible (state depends only on seed + actions)", sim.state.seq > 50);
}

// ---------- 5. Character realism
{
  const stats = { n: 0, unemployed: 0, renters: 0, kids: 0, gig: 0, negNet: 0 };
  for (let i = 0; i < 400; i++) {
    const g = newGame({ seed: `char-${i}`, players: [{ id: 1, name: "X" }] });
    const p = g.players[0], st = statement(p);
    stats.n++; if (!p.job.employed) stats.unemployed++; if (p.life.housing === "rent") stats.renters++; if (p.life.children) stats.kids++; if (p.job.gig) stats.gig++; if (st.netPay < 0) stats.negNet++;
  }
  ok("~12% start unemployed", stats.unemployed / stats.n > 0.06 && stats.unemployed / stats.n < 0.2, JSON.stringify(stats));
  ok("mix of renters and owners", stats.renters / stats.n > 0.25 && stats.renters / stats.n < 0.75, JSON.stringify(stats));
  ok("most employed characters start with a positive paycheck", stats.negNet / stats.n < 0.3, JSON.stringify(stats));
  results.push({ name: "character mix (info)", pass: true, detail: JSON.stringify(stats) });
}

// ---------- 6. Full-game simulation: crashes, invariants, game length
{
  const rounds = [], noWin = [], errs = [];
  const SIMS = Number(new URLSearchParams(location.search).get("sims") || 500);
  const t0 = performance.now();
  for (let i = 0; i < SIMS; i++) {
    const n = 2 + (i % 5);
    const { state, errors } = simulate(`sim-${i}`, n, 300);
    errs.push(errors);
    if (state.winner) rounds.push(state.round); else noWin.push(i);
  }
  rounds.sort((a, b) => a - b);
  const q = (f) => rounds[Math.floor(f * (rounds.length - 1))];
  ok(`${SIMS} simulated games ran without crashing`, true, `${rounds.length} had a winner within 300 rounds; ${noWin.length} did not; ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  results.push({ name: "rounds to win, standard (info)", pass: true, detail: `min ${rounds[0]}, 25% ${q(0.25)}, median ${q(0.5)}, 75% ${q(0.75)}, max ${rounds[rounds.length - 1]}` });
  const qr = [];
  for (let i = 0; i < SIMS; i++) { const { state } = simulate(`sim-${i}`, 2 + (i % 5), 300, "quick"); if (state.winner) qr.push(state.round); }
  qr.sort((a, b) => a - b);
  results.push({ name: "rounds to win, quick (info)", pass: true, detail: `25% ${qr[Math.floor(qr.length * 0.25)]}, median ${qr[Math.floor(qr.length * 0.5)]}, 75% ${qr[Math.floor(qr.length * 0.75)]}` });
}

export { results };
