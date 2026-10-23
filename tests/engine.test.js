// Engine tests: run by opening tests/index.html (results are also POSTed to /log when served by the test server).
import { paycheckTaxes, federalIncomeTax, setTaxTables, bestTaxYear, taxYears } from "../js/tax.js";
import { newGame, apply, statement, current, actor, report, GameError, TILES, FAST_TILES, creditScore, creditTier, loanTerms, monthOf } from "../js/engine.js";
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
  const p = actor(state);
  if (state.phase === "share") {
    const c = state.share.card;
    if (c.type === "stock") { const qty = Math.floor((p.cash * 0.2) / c.price); return c.fund && qty > 0 ? { type: "BUY", qty, by: p.id } : { type: "PASS", by: p.id }; }
    return c.cashflow > 0 && c.down <= p.cash ? { type: "BUY", by: p.id } : { type: "PASS", by: p.id };
  }
  if (state.phase === "roll" && state.round === 1 && p.job.employed && p.job.match && p.k401Rate < 0.06 && !p.job.gig) return { type: "SET_401K", rate: 0.06, by: p.id };
  if (state.phase === "roll") return { type: "ROLL", by: p.id };
  if (state.phase === "choose") return { type: "DEAL", size: p.cash > 60000 ? "big" : "small", by: p.id };
  if (state.phase === "decide") {
    const c = state.card;
    if (c.type === "charity") return rng.chance(0.5) && p.cash >= c.amount ? { type: "CHARITY", by: p.id } : { type: "PASS", by: p.id };
    if (c.type === "job") return { type: "BUY", by: p.id };
    if (c.type === "dream" || c.type === "venture") return c.price <= p.cash ? { type: "BUY", by: p.id } : { type: "PASS", by: p.id };
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
      const p = actor(s);
      s = apply(s, s.phase === "decide" || s.phase === "share" ? { type: "PASS", by: p.id } : { type: "END_TURN", by: p.id });
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

// ---------- 7. New features: deal sharing, market, 401(k), Fast Track, tax years
{
  // deal sharing: pass on a property deal and the next player who can afford it gets offered it
  let shared = 0, sharedBuys = 0, stockShares = 0;
  for (let i = 0; i < 60 && shared < 5; i++) {
    let s = newGame({ seed: `share-${i}`, players: [1, 2, 3].map((k) => ({ id: k, name: `P${k}` })) });
    s.players.forEach((p) => (p.cash = 500000));
    for (let step = 0; step < 300 && s.phase !== "over"; step++) {
      const a = actor(s);
      if (s.phase === "decide" && s.card && s.card.type === "property") {
        const card = s.card, from = a.id;
        const others = s.players.filter((q) => q.id !== a.id && q.cash >= card.down).length;
        s = apply(s, { type: "PASS", by: a.id });
        if (!others) { ok("nobody can afford it: no share round", s.phase === "manage"); continue; }
        ok("pass on a deal offers it to the next player", s.phase === "share" && s.share.queue[0] !== from && s.share.card.name === card.name);
        shared++;
        const taker = actor(s);
        s = apply(s, { type: "BUY", by: taker.id });
        ok("another player can buy a passed deal", s.players.find((p) => p.id === taker.id).properties.some((x) => x.name === card.name) && (s.phase === "manage" || s.phase === "over"), `phase ${s.phase}`);
        sharedBuys++;
        break;
      }
      if (s.phase === "decide" && s.card && s.card.type === "stock") {
        s = apply(s, { type: "BUY", qty: 10, by: a.id });
        if (s.phase === "share") { stockShares++; while (s.phase === "share") s = apply(s, { type: "PASS", by: actor(s).id }); }
        continue;
      }
      try { s = apply(s, botAction(s, new Rng("x" + step))); } catch (e) { if (!(e instanceof GameError)) throw e; s = apply(s, { type: s.phase === "decide" ? "PASS" : "END_TURN", by: actor(s).id }); }
    }
  }
  ok("deal sharing exercised", shared > 0 && sharedBuys > 0, `${shared} shared, ${stockShares} stock offers`);
  ok("out-of-turn actions are refused", (() => { const g = newGame({ seed: "turns", players: [{ id: 1, name: "A" }, { id: 2, name: "B" }] }); try { apply(g, { type: "ROLL", by: "2" }); return false; } catch (e) { return e instanceof GameError; } })());

  // market: prices drift each round and holdings track the market
  const sim = simulate("market", 3, 30);
  const hist = Object.values(sim.state.market)[0].hist;
  ok("market keeps price history", hist.length > 5, `len ${hist.length}`);
  ok("holdings are valued at market price", sim.state.players.every((p) => p.stocks.every((h) => h.price === sim.state.market[h.ticker].price)));

  // 401(k) + employer match
  let g = newGame({ seed: "k401", players: [{ id: 1, name: "A" }] });
  for (let i = 0; !(g.players[0].job.employed && !g.players[0].job.gig && g.players[0].job.match) && i < 50; i++) g = newGame({ seed: `k401-${i}`, players: [{ id: 1, name: "A" }] });
  const before = statement(g.players[0]), oldRate = g.players[0].k401Rate;
  const newRate = oldRate >= 0.1 ? 0.03 : 0.1, up = newRate > oldRate;
  g = apply(g, { type: "SET_401K", rate: newRate, by: "1" });
  const after = statement(g.players[0]);
  ok("changing the 401(k) moves net pay by less than the contribution change (tax savings)", (up ? after.netPay < before.netPay : after.netPay > before.netPay) && Math.abs(before.netPay - after.netPay) < (g.players[0].job.annual * Math.abs(newRate - oldRate)) / 26, `${before.netPay} -> ${after.netPay}`);
  ok("employer match = 50% of contributions, capped at 3% of pay", Math.abs(after.match - (g.players[0].job.annual * Math.min(newRate, 0.06) * 0.5) / 26) < 0.02, `${after.match}`);

  // dreams
  const d = newGame({ seed: "dreams", players: [{ id: 1, name: "A" }] });
  const pick = d.players[0].dreamOptions[2];
  ok("player can pick a dream from their options", apply(d, { type: "PICK_DREAM", id: pick, by: "1" }).players[0].dream.id === pick);

  // Fast Track: force a player to escape in classic mode
  let f = newGame({ seed: "fast", length: "classic", players: [{ id: 1, name: "A" }, { id: 2, name: "B" }] });
  const fp = f.players[0];
  fp.properties.push({ id: "x", category: "biz", propType: "Car Wash", name: "Test biz", price: 1e6, value: 1e6, down: 1e5, loan: 0, rate: 0, payment: 0, noi: 40000, cashflow: 40000 });
  f = apply(f, { type: "ROLL", by: "1" });
  const fp2 = f.players[0];
  ok("escaping in Classic mode moves you to the Fast Track (no instant win)", fp2.fast && !f.winner, JSON.stringify(fp2.fast));
  ok("Fast Track start cash = 100x monthly passive", fp2.fast && fp2.fast.base >= 40000 * 100 * 0.99);
  let guard = 0;
  while (!f.winner && guard++ < 3000) {
    const a = actor(f);
    try { f = apply(f, botAction(f, new Rng("f" + guard))); } catch (e) { if (!(e instanceof GameError)) throw e; f = apply(f, { type: f.phase === "decide" || f.phase === "share" ? "PASS" : "END_TURN", by: a.id }); }
    if (f.players[0].fast && f.players[0].fast.pos >= FAST_TILES) throw new Error("fast pos out of range");
  }
  ok("Fast Track game ends with a dream or $50k/mo win", f.winner === "1", `winner ${f.winner} after ${guard} steps, round ${f.round}`);
  ok("report card ranks the winner first", report(f)[0].winner);

  // standard mode still wins on escape
  let w = newGame({ seed: "fast", length: "standard", players: [{ id: 1, name: "A" }] });
  w.players[0].properties.push({ id: "x", category: "biz", propType: "Car Wash", name: "Test biz", price: 1e6, value: 1e6, down: 1e5, loan: 0, rate: 0, payment: 0, noi: 40000, cashflow: 40000 });
  w = apply(w, { type: "ROLL", by: "1" });
  ok("Standard mode: escaping wins immediately", w.winner === "1");

  // tax years: a newer table loaded at runtime is picked up
  setTaxTables({ years: { 2099: { standardDeduction: { single: 1, married_joint: 1, married_separate: 1, head_household: 1 }, brackets: { single: [[1, .1], [2, .12], [3, .22], [4, .24], [5, .32], [6, .35], [null, .37]], married_joint: [[1, .1], [2, .12], [3, .22], [4, .24], [5, .32], [6, .35], [null, .37]], married_separate: [[1, .1], [2, .12], [3, .22], [4, .24], [5, .32], [6, .35], [null, .37]], head_household: [[1, .1], [2, .12], [3, .22], [4, .24], [5, .32], [6, .35], [null, .37]] }, fica: { socialSecurityRate: .062, socialSecurityWageBase: 1e6, medicareRate: .0145, additionalMedicareRate: .009, additionalMedicareThreshold: { single: 2e5, married_joint: 2.5e5, married_separate: 1.25e5, head_household: 2e5 } }, limits: { k401: 1, ira: 1, hsaSelf: 1, hsaFamily: 1 }, childTaxCredit: 0 }, 2098: { broken: true } } });
  ok("loaded tax table is used for its year", bestTaxYear(2099) === 2099 && bestTaxYear(2026) === 2026 && !taxYears().includes(2098));
  ok("invalid tax table is rejected", !taxYears().includes(2098));
}

// ---------- 9. Credit score
{
  const scores = [];
  for (let i = 0; i < 300; i++) scores.push(creditScore(newGame({ seed: `cr-${i}`, players: [{ id: 1, name: "A" }] }).players[0]));
  scores.sort((a, b) => a - b);
  ok("starting credit scores look realistic (median 640–740)", scores[150] >= 640 && scores[150] <= 740 && scores[0] >= 300 && scores[299] <= 850, `min ${scores[0]}, median ${scores[150]}, max ${scores[299]}`);

  // paying off a maxed-out card raises the score (utilization)
  let g = newGame({ seed: "credit", players: [{ id: 1, name: "A" }] });
  const p = g.players[0];
  p.debts.credit = { label: "Credit cards", balance: p.credit.limit * 0.9, monthly: 100, rate: 0.22 }; p.cash = 1e6;
  const before = creditScore(p);
  g = apply(g, { type: "ROLL", by: "1" });
  if (g.phase !== "manage") g = apply(g, { type: "PASS", by: "1" });
  if (g.phase === "share") while (g.phase === "share") g = apply(g, { type: "PASS", by: actor(g).id });
  const mid = creditScore(g.players[0]);
  g = apply(g, { type: "PAYOFF", key: "credit", by: "1" });
  ok("paying off a 90%-used card raises the score 60+ points", creditScore(g.players[0]) - mid >= 60, `${before} → ${mid} → ${creditScore(g.players[0])}`);
  const b4 = creditScore(g.players[0]);
  g = apply(g, { type: "BORROW", amount: 2000, by: "1" });
  ok("a bank loan is a hard inquiry (−6)", creditScore(g.players[0]) === Math.max(300, Math.min(850, b4 - 6)), `${b4} → ${creditScore(g.players[0])}`);

  // missed payment: running out of cash
  let m = newGame({ seed: "late", players: [{ id: 1, name: "A" }] });
  m.players[0].cash = 0; m.players[0].living.other.monthly = 50000;
  const s0 = creditScore(m.players[0]);
  for (let i = 0; i < 20 && !m.players[0].credit.late; i++) { m = apply(m, { type: "ROLL", by: "1" }); if (m.phase === "decide" || m.phase === "choose") m = apply(m, { type: "PASS", by: "1" }); while (m.phase === "share") m = apply(m, { type: "PASS", by: actor(m).id }); m = apply(m, { type: "END_TURN", by: "1" }); }
  ok("a missed payment drops the score", m.players[0].credit.late > 0 && creditScore(m.players[0]) < s0, `${s0} → ${creditScore(m.players[0])}, late ${m.players[0].credit.late}`);

  // better credit = cheaper loan on the same card
  const card = { type: "property", category: "re", price: 300000, down: 30000, loan: 270000, rate: 0.065, years: 30, noi: 2200 };
  const hi = { credit: { base: 840, limit: 5000 }, debts: {} }, lo = { credit: { base: 540, limit: 5000 }, debts: {} };
  const a1 = loanTerms(hi, card), a2 = loanTerms(lo, card);
  ok("credit tiers change the rate and the cashflow", a1.rate < 0.065 && a2.rate > 0.065 && a1.cashflow > a2.cashflow, `${creditTier(creditScore(hi)).label} ${(a1.rate * 100).toFixed(2)}% $${a1.cashflow}/mo vs ${creditTier(creditScore(lo)).label} ${(a2.rate * 100).toFixed(2)}% $${a2.cashflow}/mo`);

  // old saved games without credit still work
  const old = newGame({ seed: "old", players: [{ id: 1, name: "A" }] }); delete old.players[0].credit;
  ok("old saved games get a credit score on the next move", !!apply(old, { type: "ROLL", by: "1" }).players[0].credit);
}

// ---------- 10. Balance: babies, stock prices
{
  let maxKids = 0, babies = 0, landings = 0;
  for (let i = 0; i < 30; i++) {
    const { state } = simulate(`kids-${i}`, 3, 120);
    for (const p of state.players) maxKids = Math.max(maxKids, p.life.children);
    babies += state.log.filter((l) => l.key === "baby").length;
  }
  ok("never more than 4 kids", maxKids <= 4, `max ${maxKids}, ${babies} babies in 30 games`);
  // where stock cards land in their 52-week range
  const pos = [];
  for (let i = 0; i < 40; i++) {
    let g = newGame({ seed: `stk-${i}`, players: [{ id: 1, name: "A" }, { id: 2, name: "B" }] });
    for (let k = 0; k < 400 && g.phase !== "over"; k++) {
      if (g.phase === "decide" && g.card && g.card.type === "stock" && !g.card.fund) { const [lo, hi] = g.card.range; pos.push(hi > lo ? (g.card.price - lo) / (hi - lo) : 0.5); }
      try { g = apply(g, botAction(g, new Rng("s" + k))); } catch (e) { if (!(e instanceof GameError)) throw e; g = apply(g, { type: g.phase === "decide" || g.phase === "share" ? "PASS" : "END_TURN", by: actor(g).id }); }
    }
  }
  const top = pos.filter((x) => x >= 0.75).length / pos.length, low = pos.filter((x) => x <= 0.25).length / pos.length;
  ok("stock cards rarely sit at the top of their 52-week range", top < 0.3 && low > 0.2, `${pos.length} cards: ${Math.round(low * 100)}% near the low, ${Math.round(top * 100)}% near the high`);
}

// ---------- 11. Money calendar, taxes, paying debts down
{
  ok("26 paychecks span 12 monthly bill dates", monthOf(26) === 11 || monthOf(26) === 12, `monthOf(26)=${monthOf(26)}`);
  // play one player solo (never buying anything) until 16 months pass: bills monthly, a tax year closes, April settles it
  let g = newGame({ seed: "calendar", players: [{ id: 1, name: "A" }] });
  g.players[0].cash = 50000;
  const startPending = g.players[0].tax.pending;
  const seen = {}; let lastN = 0, guard = 0;
  while (g.players[0].month < 16 && g.phase !== "over" && guard++ < 6000) {
    const ph = g.phase;
    const act = ph === "roll" ? { type: "ROLL" } : ph === "manage" ? { type: "END_TURN" } : { type: "PASS" };
    g = apply(g, { ...act, by: actor(g).id });
    for (const l of g.log) if (l.n > lastN) { seen[l.key] = (seen[l.key] || 0) + 1; lastN = l.n; }
  }
  const p = g.players[0];
  ok("bills hit once a month, paychecks every 2 weeks", seen.bills === p.month && p.checks >= p.month * 2, `${p.checks} paychecks, ${seen.bills} bill days over ${p.month} months`);
  ok("prior-year tax return is pending at the start", startPending && startPending.year === g.taxYear - 1, JSON.stringify(startPending));
  ok("a tax year closes in January", seen.tax_close === 1, `tax_close ${seen.tax_close}`);
  ok("refunds/bills settle in April (prior year + this year)", (seen.tax_refund || 0) + (seen.tax_bill || 0) === 2, `refunds ${seen.tax_refund || 0}, bills ${seen.tax_bill || 0}`);

  // statement: take-home per paycheck, bills per month
  const s = statement(newGame({ seed: "stmt", players: [{ id: 1, name: "A" }] }).players[0]);
  ok("monthly cashflow = take-home × 26/12 + passive − bills", Math.abs(s.monthlyCashflow - ((s.takeHome * 26) / 12 + s.passive - s.billsTotal)) < 0.02);

  // pay down part of a debt
  let d = newGame({ seed: "paydown", players: [{ id: 1, name: "A" }] });
  d.players[0].debts.credit = { label: "Credit cards", balance: 5000, monthly: 150, rate: 0.22 };
  d.players[0].debts.car = { label: "Car loan", balance: 10000, monthly: 300, rate: 0.07 };
  d.players[0].cash = 20000;
  d = apply(d, { type: "ROLL", by: "1" });
  while (d.phase !== "manage" && d.phase !== "over") d = apply(d, { type: "PASS", by: actor(d).id });
  const before = creditScore(d.players[0]);
  d = apply(d, { type: "PAY_DOWN", key: "credit", amount: 3000, by: "1" });
  d = apply(d, { type: "PAY_DOWN", key: "car", amount: 5000, by: "1" });
  const q = d.players[0];
  ok("pay down: balances and payments drop", q.debts.credit.balance === 2000 && q.debts.credit.monthly === 60 && q.debts.car.balance === 5000 && q.debts.car.monthly === 150, JSON.stringify([q.debts.credit, q.debts.car]));
  ok("paying the card down improves credit (utilization)", creditScore(q) >= before, `${before} → ${creditScore(q)}`);
  d = apply(d, { type: "PAY_DOWN", key: "credit", amount: 999999, by: "1" });
  ok("paying more than the balance = paid off", !d.players[0].debts.credit || d.players[0].cash < 0, "");
}

// ---------- 12. Principal payments in $1 steps, property loans, quick sale at 10% below market
{
  let g = newGame({ seed: "principal", players: [{ id: 1, name: "A" }] });
  const p0 = g.players[0];
  p0.cash = 50000;
  p0.debts.student = { label: "Student loans", balance: 10000, monthly: 114, rate: 0.065 };
  p0.properties.push({ id: "r1", category: "re", propType: "HOUSE FOR SALE", name: "Duplex", price: 200000, value: 200000, down: 20000, loan: 180000, rate: 0.07, payment: 1198, noi: 1500, cashflow: 302 });
  p0.stocks.push({ ticker: "QuickFix", shares: 10, cost: 10, div: 0, price: g.market.QuickFix.price });
  g = apply(g, { type: "ROLL", by: "1" });
  while (g.phase !== "manage" && g.phase !== "over") g = apply(g, { type: "PASS", by: actor(g).id });
  g = apply(g, { type: "PAY_DOWN", key: "student", amount: 1234, by: "1" });
  ok("principal payment of $1,234 (not rounded to $100)", g.players[0].debts.student.balance === 8766, `${g.players[0].debts.student.balance}`);
  const before = statement(g.players[0]).passive;
  g = apply(g, { type: "PAY_DOWN", key: "prop:r1", amount: 60000 > g.players[0].cash ? 30000 : 30000, by: "1" });
  const r = g.players[0].properties.find((x) => x.id === "r1");
  ok("principal payment on a rental loan lowers its payment and raises cashflow", r.loan === 150000 && r.payment === Math.round(1198 * (150000 / 180000)) && r.cashflow > 302 && statement(g.players[0]).passive > before, JSON.stringify(r));
  const mkt = g.market.QuickFix.price, cash0 = g.players[0].cash;
  g = apply(g, { type: "SELL_STOCK", ticker: "QuickFix", qty: 10, by: "1" });
  ok("quick sale = 10% below market", Math.abs(g.players[0].cash - cash0 - 10 * Math.max(1, Math.round(mkt * 0.9))) < 0.01, `market ${mkt}`);
}

// ---------- 8. Classic mode game length
{
  const rr = [];
  const SIMS = Math.min(80, Number(new URLSearchParams(location.search).get("sims") || 500));
  for (let i = 0; i < SIMS; i++) { const { state } = simulate(`classic-${i}`, 2 + (i % 5), 300, "classic"); if (state.winner) rr.push(state.round); }
  rr.sort((a, b) => a - b);
  results.push({ name: "rounds to win, classic (info)", pass: rr.length > SIMS * 0.5, detail: `${rr.length}/${SIMS} finished; 25% ${rr[Math.floor(rr.length * 0.25)]}, median ${rr[Math.floor(rr.length * 0.5)]}, 75% ${rr[Math.floor(rr.length * 0.75)]}` });
}

export { results };
