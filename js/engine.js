// =====================================================================================
// CashFlow game engine (deterministic)
//
//   newGame({ seed, players: [{ id, name }], length, taxYear })  -> state
//   apply(state, action)                                          -> new state (throws GameError if not allowed)
//   statement(player, goal)                                       -> the player's financial statement (per paycheck)
//
// The state is plain JSON. All randomness comes from state.rng (a seeded stream), so the same seed
// and the same list of actions always produce exactly the same game, on every player's screen.
// Money: statement amounts are PER BI-WEEKLY PAYCHECK unless named *monthly / *annual.
// =====================================================================================
import { Rng } from "./rng.js";
import { paycheckTaxes, PAYCHECKS_PER_YEAR as PP, FILING_LABEL, bestTaxYear } from "./tax.js";
import { PROFESSIONS } from "./data/professions.js";
import { STOCKS, REAL_ESTATE_STORIES, BUSINESS_STORIES } from "./data/stories.js";
import { CITIES, ECONOMIES, CARS, SPENDING, ECON_EVENTS, PROPERTY_TYPES, STOCK_PRICING, DREAMS, FAST_BOARD, FAST_VENTURES, TIPS, BADGES } from "./data/world.js";
import { say } from "./narrator.js";

export const BOARD_SIZE = 9;
export const TILES = BOARD_SIZE * BOARD_SIZE;
export const FAST_TILES = FAST_BOARD.length;
export const MAX_PLAYERS = 6;
export const PLAYER_COLORS = ["#ff5d5d", "#4f8cff", "#2ecc71", "#f5b700", "#c56cf0", "#17c0eb"];
export const EVENT_TILES = ["New Baby", "Charity", "Personal Spending", "RE Offer", "Downsizing", "Economic Event"];
export const K401_CHOICES = [0, 0.03, 0.06, 0.1, 0.15];
export const FAST_WIN_CASHFLOW = 50000; // Fast Track: win by adding $50k/month of cashflow (or buying your dream)
const DEGREE_FIELDS = new Set(["Healthcare", "Technology", "Finance & Business", "Legal", "Engineering", "Education", "Science"]);
const BENEFIT_CAP = 1100;      // max unemployment benefit per paycheck
const BENEFIT_CHECKS = 12;     // ~6 months of benefits
const MAX_CHILDREN = 4;
const RAISE_EVERY = 12;        // paychecks between "annual" reviews (game time is compressed)
const HIST = 24;               // stock price history kept for the ticker

export class GameError extends Error {}
const r2 = (x) => Math.round(x * 100) / 100;
const nice = (x, step) => Math.round(x / step) * step;
const toPP = (monthly) => (monthly * 12) / PP;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const money = (n, cents = false) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/** Monthly payment for a loan. */
export function amortize(principal, annualRate, years) {
  if (principal <= 0) return 0;
  const r = annualRate / 12, n = years * 12;
  return r ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n;
}

// ---------------------------------------------------------------- setup
export const LENGTHS = {
  quick: { label: "Quick", ratio: 0.6, fast: false, desc: "Passive income covers 60% of expenses = you win" },
  standard: { label: "Standard", ratio: 1, fast: false, desc: "Passive income covers 100% of expenses = you win" },
  classic: { label: "Classic", ratio: 1, fast: true, desc: "Escape the rat race, then win on the Fast Track by buying your dream" },
};

export function newGame({ seed, players, length = "standard", taxYear }) {
  if (!players || players.length < 1 || players.length > MAX_PLAYERS) throw new GameError(`1–${MAX_PLAYERS} players`);
  seed = String(seed);
  const L = LENGTHS[length] ? length : "standard";
  const rng = new Rng(seed);
  const economy = makeEconomy(rng, rng.pick(ECONOMIES));
  const state = {
    v: 2, seed, rng: 0, seq: 0, flavor: 0, round: 1, turn: 0, phase: "roll",
    length: L, goal: LENGTHS[L].ratio, fastTrack: LENGTHS[L].fast, taxYear: taxYear || bestTaxYear(),
    economy, board: makeBoard(rng), market: makeMarket(rng, economy), players: [], card: null, share: null, dice: null, winner: null, log: [],
  };
  players.forEach((p, i) => state.players.push(makePlayer(rng, p, i, economy, state.taxYear)));
  state.rng = rng.s;
  log(state, say(seed, state.flavor++, "start"), "narrator", null, "start");
  log(state, `🌍 Economy: ${economy.name}: "${economy.headline}" (mortgages ${(economy.mortgage * 100).toFixed(1)}%, credit cards ${(economy.credit * 100).toFixed(0)}%). Taxes: ${state.taxYear} federal tables.`, "econ");
  for (const p of state.players) {
    log(state, `${p.name} is a ${p.job.employed ? p.job.title : `former ${p.job.title}, currently between jobs`} in ${p.life.city}, ${p.life.state} (${FILING_LABEL[p.life.filing]}${p.life.spouse ? `, spouse works as a ${p.life.spouse.title}` : ""}${p.life.children ? `, ${p.life.children} kid${p.life.children > 1 ? "s" : ""}` : ""}). Dream: ${p.dream.icon} ${p.dream.name}.`, "setup", p.id);
  }
  return state;
}

function makeEconomy(rng, base) {
  return { id: base.id, name: base.name, headline: rng.pick(base.headlines), mortgage: base.mortgage, credit: base.credit, auto: base.auto, personal: base.personal, appreciation: base.appreciation, stocks: base.stocks };
}

/** Freeman's original board: Start, Pay Day every 8th tile, Opportunity on a checker pattern, events elsewhere. */
function makeBoard(rng) {
  const board = [];
  let count = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    let bag = EVENT_TILES.slice();
    for (let j = 0; j < BOARD_SIZE; j++) {
      let t;
      if (i === 0 && j === 0) t = "Start";
      else if ((count + 1) % (BOARD_SIZE - 1) === 0) t = "Pay Day";
      else if ((i % 2) === (j % 2)) t = "Opportunity";
      else {
        if (!bag.length) bag = EVENT_TILES.slice();
        t = bag.splice(Math.floor(rng.next() * bag.length), 1)[0];
      }
      board.push(t);
      count++;
    }
  }
  return board;
}

// ---------------------------------------------------------------- the stock market (live ticker)
export const FUNDS = [
  { ticker: "Dividend Index Fund", story: "A diversified fund of dividend-paying companies. Boring? Yes. Reliable? Also yes.", yield: 0.038, range: [40, 80] },
  { ticker: "Treasury Bond Fund", story: "Short-term U.S. Treasuries: low risk, steady interest.", yield: 0.044, range: [20, 30] },
  { ticker: "REIT Index Fund", story: "Own a slice of thousands of properties without being a landlord.", yield: 0.05, range: [15, 45] },
];

function makeMarket(rng, econ) {
  const m = {};
  for (const st of STOCKS) {
    const pr = STOCK_PRICING[st.name] || { range: [5, 50], yield: 0 };
    const price = Math.max(1, Math.round(rng.tri(pr.range[0], (pr.range[0] + pr.range[1]) / 2, pr.range[1]) * econ.stocks));
    m[st.name] = { price, hist: [price], yield: pr.yield, range: pr.range, fund: false };
  }
  for (const f of FUNDS) {
    const price = Math.round(rng.tri(f.range[0], (f.range[0] + f.range[1]) / 2, f.range[1]));
    m[f.ticker] = { price, hist: [price], yield: f.yield, range: f.range, fund: true };
  }
  return m;
}

function setPrice(state, ticker, price) {
  const t = state.market[ticker];
  t.price = Math.max(1, Math.round(price));
  t.hist.push(t.price);
  if (t.hist.length > HIST) t.hist.shift();
  for (const p of state.players) for (const h of p.stocks) if (h.ticker === ticker) h.price = t.price;
}

/** Every new round the market drifts a little (funds move less than single stocks). */
function marketDrift(state, rng) {
  for (const [ticker, t] of Object.entries(state.market)) {
    const m = t.fund ? rng.tri(0.985, 1.004, 1.02) : rng.tri(0.94, 1.0, 1.07) * (0.995 + (state.economy.stocks - 1) * 0.02);
    setPrice(state, ticker, t.price * m);
  }
}

// ---------------------------------------------------------------- characters
function pickProfession(rng, category) {
  const pool = category ? PROFESSIONS.filter((p) => p.category === category) : PROFESSIONS;
  return rng.pick(pool.length ? pool : PROFESSIONS);
}

function salaryFor(rng, prof) {
  const [lo, mode, hi] = prof.annual;
  return nice(rng.tri(lo, mode, hi), 100);
}

function makePlayer(rng, { id, name }, index, econ, taxYear) {
  const prof = pickProfession(rng);
  const annual = salaryFor(rng, prof);
  const employed = !rng.chance(0.12); // ~12% of characters start between jobs
  const filing = rng.weighted([["single", 48], ["married_joint", 37], ["head_household", 11], ["married_separate", 4]]);
  const children = filing === "married_joint" ? rng.weighted([[0, 35], [1, 25], [2, 28], [3, 12]])
    : filing === "head_household" ? rng.weighted([[1, 50], [2, 35], [3, 15]]) : rng.weighted([[0, 90], [1, 10]]);
  const place = rng.pick(CITIES);
  const married = filing === "married_joint" || filing === "married_separate";
  // Most married households have two earners (the spouse's pay is taxed jointly for married_joint).
  let spouse = null;
  if (married && rng.chance(0.68)) { const sp = pickProfession(rng); spouse = { title: sp.name, annual: nice(salaryFor(rng, sp) * rng.tri(0.7, 0.9, 1), 100) }; }
  const household = annual + (spouse ? spouse.annual : 0);

  // Housing
  const owns = rng.chance(clamp(0.2 + household / 300000 + (married ? 0.2 : 0), 0.15, 0.85));
  const debts = {};
  const living = {};
  let home = null;
  if (owns) {
    const price = nice(clamp(place.home * rng.tri(0.55, 0.9, 1.4), 110000, Math.max(150000, household * rng.tri(2.5, 3.4, 4.5))), 1000);
    const balance = nice(price * rng.tri(0.5, 0.8, 0.95), 100);
    const rate = clamp(econ.mortgage + rng.tri(-0.025, 0, 0.01), 0.03, 0.09);
    home = { price, rate };
    debts.mortgage = { label: "Home mortgage", balance, monthly: Math.round(amortize(balance, rate, 30) + (price * 0.016) / 12), rate };
  } else {
    // rent: what the city charges, but people pick places they can (mostly) afford: ~22–38% of gross pay
    living.rent = { label: "Rent", monthly: nice(clamp(place.home * 0.0048 * rng.tri(0.7, 1, 1.3), 700 * place.col, Math.max(900, (household / 12) * rng.tri(0.22, 0.3, 0.38))), 10) };
  }

  // Car
  const target = clamp(annual * rng.tri(0.1, 0.25, 0.5), 8000, 85000);
  const car = CARS.reduce((best, c) => (Math.abs(c[1] - target) < Math.abs(best[1] - target) ? c : best));
  if (rng.chance(0.78)) {
    const bal = nice(car[1] * rng.tri(0.2, 0.6, 0.95), 100);
    const rate = clamp(econ.auto + rng.tri(-0.02, 0, 0.05), 0.02, 0.18);
    debts.car = { label: "Car loan", balance: bal, monthly: Math.round(amortize(bal, rate, 5)), rate };
  }

  // Student loans (more likely in degree-heavy fields; bigger for doctors and lawyers)
  if (DEGREE_FIELDS.has(prof.category) && rng.chance(0.45)) {
    const big = annual > 150000 && (prof.category === "Healthcare" || prof.category === "Legal");
    const bal = nice(big ? rng.tri(60000, 160000, 300000) : rng.tri(6000, 32000, 110000), 100);
    debts.student = { label: "Student loans", balance: bal, monthly: Math.round(amortize(bal, 0.065, 10)), rate: 0.065 };
  }

  // Credit cards & retail debt
  const ccBal = nice(annual * rng.tri(0, 0.05, 0.2), 50);
  const ccLimit = nice(Math.max(2000, ccBal * rng.tri(1.2, 2.5, 6), annual * rng.tri(0.05, 0.15, 0.3)), 500);
  const creditBase = Math.round(rng.tri(560, 680, 790) - (employed ? 0 : 20));
  if (ccBal > 0) debts.credit = { label: "Credit cards", balance: ccBal, monthly: Math.max(35, Math.round(ccBal * 0.03)), rate: econ.credit };
  if (rng.chance(0.4)) { const b = nice(rng.tri(400, 1500, 4500), 50); debts.retail = { label: "Retail / BNPL debt", balance: b, monthly: Math.max(25, Math.round(b * 0.05)), rate: 0.3 }; }

  // Everyday life (monthly)
  living.health = { label: "Health insurance", monthly: employed ? Math.round(children || married ? rng.tri(420, 560, 760) : rng.tri(90, 125, 210)) : Math.round(children || married ? rng.tri(700, 950, 1300) : rng.tri(300, 400, 560)) };
  living.other = { label: "Groceries, utilities, phone, gas", monthly: nice(place.col * (married ? 1.7 : 1) * rng.tri(500, 680, 1000) + 100, 10) };
  if (children) living.kids = { label: "Child care & costs", monthly: nice(children * place.col * rng.tri(450, 650, 1150), 10) };

  // Savings habits: employees choose a 401(k) %, most employers match half of it up to 6% of pay
  const k401Rate = employed && !prof.gig ? rng.weighted([[0, 25], [0.03, 20], [0.06, 30], [0.1, 15], [0.15, 10]]) : 0;
  const hsaAnnual = employed && rng.chance(0.3) ? nice(rng.tri(500, 1500, 4400), 50) : 0;
  const dreamOptions = [];
  while (dreamOptions.length < 3) { const d = rng.pick(DREAMS); if (!dreamOptions.includes(d.id)) dreamOptions.push(d.id); }

  const p = {
    id: String(id), name: String(name).slice(0, 18) || `Player ${index + 1}`, color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    pos: 0, skip: 0, charityTurns: 0, cash: 0, taxYear,
    job: { title: prof.name, category: prof.category, soc: prof.soc, annual, employed, gig: !!prof.gig, checksUnemployed: 0, laidOff: false,
      benefit: employed ? 0 : Math.round(Math.min((annual / PP) * 0.45, BENEFIT_CAP)), benefitsLeft: employed ? 0 : BENEFIT_CHECKS,
      match: employed && !prof.gig && rng.chance(0.75) },
    life: { city: place.city, state: place.state, stateRate: place.stateRate, col: place.col, filing, children, housing: owns ? "own" : "rent", home, car: car[0], spouse },
    k401Rate, hsaAnnual,
    retirement: nice(employed ? annual * rng.tri(0, 0.35, 1.4) : annual * rng.tri(0, 0.15, 0.6), 100),
    hsaBalance: hsaAnnual ? nice(hsaAnnual * rng.tri(0.2, 1, 3), 50) : 0,
    stocks: [], properties: [], debts, living, nextId: 1, paychecks: 0,
    dream: DREAMS.find((d) => d.id === dreamOptions[0]), dreamOptions, fast: null,
    credit: { base: creditBase, limit: ccLimit, hist: [], onTime: 0, late: 0 },
    badges: [], tips: [], stats: { bought: 0, sold: 0, profit: 0, debtPaid: 0, doodads: 0, charity: 0, interestBorrowed: 0, best: null, layoffs: 0, raises: 0 },
  };
  const s = statement(p);
  p.credit.hist.push(creditScore(p));
  p.cash = Math.max(300, nice(employed ? Math.abs(s.netPay) * rng.tri(0.5, 1.5, 4) : rng.tri(1000, 3000, 8000), 50));
  return p;
}

// ---------------------------------------------------------------- credit score (simplified FICO: 300–850)
// Score = base (payment history, inquiries, account history) + credit-card utilization (balance ÷ limit), computed live.
export const CREDIT_TIERS = [
  { min: 800, label: "Exceptional", color: "#3cf5a0", mortgage: -0.005, personal: -0.04, limit: 1.25 },
  { min: 740, label: "Very good", color: "#9be564", mortgage: -0.0025, personal: -0.02, limit: 1.1 },
  { min: 670, label: "Good", color: "#ffd23f", mortgage: 0, personal: 0, limit: 1 },
  { min: 580, label: "Fair", color: "#ff9f43", mortgage: 0.01, personal: 0.05, limit: 0.75 },
  { min: 300, label: "Poor", color: "#ff5d6c", mortgage: 0.025, personal: 0.1, limit: 0.5 },
];
export function utilization(p) {
  if (!p.credit || !p.credit.limit) return 0;
  return (p.debts.credit ? p.debts.credit.balance : 0) / p.credit.limit;
}
function utilPoints(u) { return u < 0.1 ? 20 : u < 0.3 ? 5 : u < 0.5 ? -15 : u < 0.8 ? -35 : -55; }
export function creditScore(p) {
  if (!p.credit) return 680;
  return clamp(Math.round(p.credit.base + utilPoints(utilization(p))), 300, 850);
}
export function creditTier(score) { return CREDIT_TIERS.find((t) => score >= t.min); }

/** The loan a specific player would get on a property/business card (rate depends on their credit). */
export function loanTerms(p, card) {
  const t = creditTier(creditScore(p));
  const rate = r2((card.rate + (card.category === "biz" ? t.personal / 2 : t.mortgage)) * 10000) / 10000;
  const years = card.years || (card.category === "biz" ? 10 : 30);
  const payment = Math.round(amortize(card.loan, rate, years));
  return { rate, payment, cashflow: nice(card.noi - payment, 10), tier: t, score: creditScore(p) };
}

function creditChange(state, p, delta, why) {
  if (!p.credit) return;
  const before = creditScore(p);
  p.credit.base = clamp(p.credit.base + delta, 250, 870);
  const after = creditScore(p);
  creditMark(p);
  if (why && after !== before) log(state, `${after > before ? "📈" : "📉"} ${p.name}'s credit score ${after > before ? "rose" : "fell"} to ${after} (${why}).`, after > before ? "credit" : "warn", p.id, "credit");
  if (after >= 800) badge(state, p, "credit_star");
}
function creditMark(p) {
  const sc = creditScore(p);
  const h = p.credit.hist;
  if (h[h.length - 1] !== sc) { h.push(sc); if (h.length > HIST) h.shift(); }
}

// ---------------------------------------------------------------- financial statement
/** The player's financial statement, PER PAYCHECK. goal = share of living expenses passive income must cover. */
export function statement(p, goal = 1) {
  const income = [], expenses = [], notes = [];
  const gross = p.job.employed ? p.job.annual / PP : 0;
  const sp = p.life.spouse;
  let taxes = null;
  if (p.job.employed) income.push({ label: p.job.gig ? `${p.job.title} (avg, varies)` : `${p.job.title} salary`, amount: gross, kind: "salary" });
  if (sp) income.push({ label: `Spouse's pay (${sp.title})`, amount: sp.annual / PP, kind: "salary" });
  const wages = (p.job.employed ? p.job.annual : 0) + (sp ? sp.annual : 0);
  if (wages > 0) {
    const year = p.taxYear;
    taxes = paycheckTaxes(wages, { status: p.life.filing, stateRate: p.life.stateRate, k401Annual: p.job.employed ? p.job.annual * p.k401Rate : 0, hsaAnnual: p.hsaAnnual, children: p.life.children, year });
    // Social Security is capped per worker, not per household: recompute FICA per earner.
    const fica = (w) => paycheckTaxes(w, { status: "single", year });
    if (sp) { const a = p.job.employed ? fica(p.job.annual) : { socialSecurity: 0, medicare: 0 }, b = fica(sp.annual); taxes.socialSecurity = r2(a.socialSecurity + b.socialSecurity); taxes.medicare = r2(Math.max(taxes.medicare, a.medicare + b.medicare)); }
    if (p.job.employed && p.job.gig) { const own = fica(p.job.annual); taxes.socialSecurity = r2(taxes.socialSecurity + own.socialSecurity); taxes.medicare = r2(taxes.medicare + own.medicare); }
    taxes.totalTax = r2(taxes.federal + taxes.socialSecurity + taxes.medicare + taxes.state);
  }
  if (!p.job.employed && p.job.benefitsLeft > 0) income.push({ label: `Unemployment benefits (${p.job.benefitsLeft} checks left)`, amount: p.job.benefit, kind: "benefits" });

  const passiveItems = [];
  for (const s of p.stocks) if (s.div > 0) passiveItems.push({ label: `${s.ticker} dividends (${s.shares} sh)`, amount: (s.shares * s.div) / PP, kind: "passive" });
  for (const a of p.properties) passiveItems.push({ label: a.name, amount: toPP(a.cashflow), kind: "passive" });
  income.push(...passiveItems);

  if (taxes) {
    expenses.push({ label: sp ? "Federal income tax (joint)" : "Federal income tax", amount: taxes.federal, kind: "tax" });
    expenses.push({ label: p.job.gig ? "Self-employment tax (SS + Medicare)" : "Social Security + Medicare (FICA)", amount: r2(taxes.socialSecurity + taxes.medicare), kind: "tax" });
    if (taxes.state) expenses.push({ label: `State & local tax (${p.life.state})`, amount: taxes.state, kind: "tax" });
    if (taxes.k401) expenses.push({ label: `401(k) contribution (${Math.round(p.k401Rate * 100)}%)`, amount: taxes.k401, kind: "savings" });
    if (taxes.hsa) expenses.push({ label: "HSA contribution", amount: taxes.hsa, kind: "savings" });
  }
  const match = employerMatch(p);
  if (match > 0) notes.push({ label: "Employer 401(k) match (free money → retirement)", amount: match });
  for (const d of Object.values(p.debts)) if (d.monthly > 0) expenses.push({ label: d.label, amount: toPP(d.monthly), kind: "living" });
  for (const l of Object.values(p.living)) expenses.push({ label: l.label, amount: toPP(l.monthly), kind: "living" });

  const sum = (arr) => r2(arr.reduce((s, x) => s + x.amount, 0));
  const passive = sum(passiveItems);
  const livingExpenses = sum(expenses.filter((e) => e.kind === "living"));
  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const assets = [
    { label: "Cash", value: p.cash },
    { label: "401(k) / retirement", value: p.retirement },
    ...(p.hsaBalance ? [{ label: "HSA", value: p.hsaBalance }] : []),
    ...(p.life.home ? [{ label: "Home", value: p.life.home.price }] : []),
    ...p.stocks.map((s) => ({ label: `${s.ticker} × ${s.shares}`, value: s.shares * s.price })),
    ...p.properties.map((a) => ({ label: a.name, value: a.value })),
  ];
  const liabilities = [
    ...Object.values(p.debts).map((d) => ({ label: d.label, value: d.balance })),
    ...p.properties.filter((a) => a.loan > 0).map((a) => ({ label: `${a.name} loan`, value: a.loan })),
  ];
  const netWorth = r2(assets.reduce((s, a) => s + a.value, 0) - liabilities.reduce((s, l) => s + l.value, 0));
  return {
    income, expenses, notes, passive, livingExpenses, totalIncome, totalExpenses, match,
    netPay: r2(totalIncome - totalExpenses), assets, liabilities, netWorth,
    progress: livingExpenses > 0 ? clamp(passive / (livingExpenses * goal), 0, 1) : 0,
    target: r2(livingExpenses * goal),
    free: passive > 0 && passive >= livingExpenses * goal,
  };
}

/** Employer match per paycheck: 50% of what you put in, up to 6% of your pay. */
function employerMatch(p) {
  if (!p.job.employed || !p.job.match || !p.k401Rate) return 0;
  return r2((p.job.annual * Math.min(p.k401Rate, 0.06) * 0.5) / PP);
}

// ---------------------------------------------------------------- state helpers
function log(state, text, kind = "info", pid = null, key = null) {
  state.log.push({ n: (state.logN = (state.logN || 0) + 1), text, kind, pid, round: state.round, key });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}
const narrate = (state, key, vars, pid) => log(state, say(state.seed, state.flavor++, key, vars), "narrator", pid, key);
export const current = (state) => state.players[state.turn];
/** Who has to act right now (during deal sharing it's not the current player). */
export const actor = (state) => (state.phase === "share" && state.share ? state.players.find((p) => p.id === state.share.queue[0]) : current(state));

function tip(state, p, key) {
  if (p.tips.includes(key) || !TIPS[key]) return;
  p.tips.push(key);
  log(state, TIPS[key], "tip", p.id, "tip");
}

function badge(state, p, id) {
  if (p.badges.includes(id) || !BADGES[id]) return;
  p.badges.push(id);
  narrate(state, "badge", { name: p.name, badge: `${BADGES[id].emoji} ${BADGES[id].label}` }, p.id);
}

function payCash(state, p, amount, reason) {
  p.cash = r2(p.cash - amount);
  if (p.cash < 0) {
    // Automatic bank loan in $1,000 steps to cover the shortfall (classic CashFlow rule).
    const need = Math.ceil(-p.cash / 1000) * 1000;
    borrow(state, p, need, true);
    log(state, `${p.name} was short for ${reason}, so the bank lent ${money(need)} automatically.`, "warn", p.id);
    if (p.credit && !p.fast) { p.credit.late += 1; p.credit.missed = true; creditChange(state, p, -30, "missed payment"); tip(state, p, "credit_late"); }
  }
}

function borrow(state, p, amount, auto = false) {
  const rate = r2((state.economy.personal + creditTier(creditScore(p)).personal) * 10000) / 10000;
  const d = p.debts.bank || { label: "Bank loan", balance: 0, monthly: 0, rate };
  d.balance += amount; d.rate = rate;
  d.monthly = Math.round(amortize(d.balance, rate, 5));
  p.debts.bank = d;
  p.cash = r2(p.cash + amount);
  p.stats.interestBorrowed += amount;
  if (!auto) narrate(state, "loan", { name: p.name, amt: money(amount), pay: money(toPP(d.monthly)) }, p.id);
  tip(state, p, "loan");
}

function checkProgress(state, p) {
  if (state.winner || p.fast) return;
  const s = statement(p, state.goal);
  if (s.progress >= 0.5) badge(state, p, "halfway");
  const consumer = ["credit", "retail", "bank", "car"];
  if (p.stats.debtPaid > 0 && !consumer.some((k) => p.debts[k])) badge(state, p, "debt_free");
  if (!s.free) return;
  badge(state, p, "escaped");
  if (!state.fastTrack) {
    state.winner = p.id; state.phase = "over";
    narrate(state, "win", { name: p.name, passive: money(s.passive), exp: money(state.goal < 1 ? s.target : s.livingExpenses) }, p.id);
    return;
  }
  // Classic: move to the Fast Track. CashFlow Day pays 100x your monthly passive income (classic rule).
  const monthlyPassive = (s.passive * PP) / 12;
  p.fast = { pos: 0, base: nice(monthlyPassive * 100, 100), added: 0, ventures: [] };
  p.cash = r2(p.cash + p.fast.base);
  narrate(state, "escaped", { name: p.name, passive: money(s.passive), dream: `${p.dream.icon} ${p.dream.name} (${money(p.dream.cost)})` }, p.id);
  log(state, `${p.name} starts the Fast Track with ${money(p.fast.base)} (CashFlow Day = 100× monthly passive income). Win by buying the dream, or by adding ${money(FAST_WIN_CASHFLOW)}/mo of cashflow.`, "good", p.id);
}
const checkWin = checkProgress;

// ---------------------------------------------------------------- cards
function makeStockCard(state, rng) {
  const st = rng.pick(STOCKS);
  const storyIdx = rng.int(0, 2);
  const t = state.market[st.name];
  const bullish = storyIdx < 2;
  const move = bullish ? rng.tri(1.03, 1.12, 1.35) : rng.tri(0.55, 0.8, 0.96);
  const price = Math.round(clamp(t.price * move, Math.max(1, t.range[0] * 0.4), t.range[1] * 1.8));
  setPrice(state, st.name, price);
  return { type: "stock", ticker: st.name, story: st.stories[storyIdx], bullish, price, yield: t.yield, range: [Math.min(...t.hist), Math.max(...t.hist)] };
}

function makeFundCard(state, rng) {
  const f = rng.pick(FUNDS);
  const t = state.market[f.ticker];
  setPrice(state, f.ticker, t.price * rng.tri(0.97, 1.0, 1.04));
  return { type: "stock", ticker: f.ticker, story: f.story, bullish: true, fund: true, price: t.price, yield: f.yield, range: [Math.min(...t.hist), Math.max(...t.hist)] };
}

function makePropertyCard(rng, econ) {
  const kind = rng.weighted([["HOUSE FOR SALE", 45], ["APARTMENT BUILDING", 20], ["commercial", 35]]);
  const type = kind === "commercial" ? rng.pick(Object.keys(PROPERTY_TYPES).filter((k) => k !== "HOUSE FOR SALE" && k !== "APARTMENT BUILDING")) : kind;
  const spec = PROPERTY_TYPES[type];
  let price, name;
  if (type === "HOUSE FOR SALE") {
    const br = rng.int(2, 5), ba = Math.max(1, br - rng.int(0, 2));
    price = nice(rng.tri(spec.price[0], spec.price[0] * 1.8, spec.price[1]), 500);
    name = `${br}BR/${ba}BA House`;
  } else if (type === "APARTMENT BUILDING") {
    const units = rng.int(spec.units[0], spec.units[1]);
    price = nice(units * rng.tri(spec.perUnit[0], spec.perUnit[0] * 1.4, spec.perUnit[1]), 1000);
    name = `${units}-Unit Apartment Building`;
  } else {
    price = nice(rng.tri(spec.price[0], spec.price[0] * 1.6, spec.price[1]), 1000);
    name = type;
  }
  const down = nice(price * rng.tri(spec.down[0], spec.down[0] + 0.03, spec.down[1]), 500);
  const rate = clamp(econ.mortgage + (type === "HOUSE FOR SALE" ? 0.003 : 0.01), 0.03, 0.12);
  const payment = amortize(price - down, rate, spec.years);
  const noi = (price * rng.tri(spec.cap[0] + 0.005, (spec.cap[0] + spec.cap[1]) / 2 + 0.01, spec.cap[1] + 0.015)) / 12;
  return { type: "property", category: "re", propType: type, name, story: rng.pick(REAL_ESTATE_STORIES[type]), price, down, loan: price - down, rate, years: spec.years, payment: Math.round(payment), noi: Math.round(noi), cashflow: nice(noi - payment, 10) };
}

const SMALL_HOMES = ["2BR/1BA Condo", "2BR/1BA House", "3BR/2BA House", "Duplex", "Townhome"];
function makeSmallDeal(state, rng) {
  const econ = state.economy;
  const k = rng.weighted([["stock", 35], ["fund", 15], ["home", 32], ["biz", 18]]);
  if (k === "stock") return makeStockCard(state, rng);
  if (k === "fund") return makeFundCard(state, rng);
  if (k === "home") {
    const name = rng.pick(SMALL_HOMES);
    const price = nice(rng.tri(95000, 170000, 320000) * (name === "Duplex" ? 1.35 : 1), 500);
    const down = nice(price * rng.tri(0.035, 0.08, 0.15), 500);
    const rate = clamp(econ.mortgage + 0.003, 0.03, 0.12);
    const payment = amortize(price - down, rate, 30);
    const noi = (price * rng.tri(0.06, 0.088, 0.12)) / 12;
    return { type: "property", category: "re", propType: "HOUSE FOR SALE", name, story: rng.pick(REAL_ESTATE_STORIES["HOUSE FOR SALE"]), price, down, loan: price - down, rate, years: 30, payment: Math.round(payment), noi: Math.round(noi), cashflow: nice(noi - payment, 10), size: "small" };
  }
  return { ...makeBusinessCard(rng, econ, [6000, 25000, 90000]), size: "small" };
}

function makeBigDeal(state, rng) {
  const econ = state.economy;
  if (rng.weighted([["re", 65], ["biz", 35]]) === "biz") return { ...makeBusinessCard(rng, econ, [120000, 350000, 2000000]), size: "big" };
  let card;
  do { card = makePropertyCard(rng, econ); } while (card.propType === "HOUSE FOR SALE");
  return { ...card, size: "big" };
}

function makeBusinessCard(rng, econ, priceRange) {
  const type = rng.pick(Object.keys(BUSINESS_STORIES));
  const price = nice(Math.exp(rng.tri(Math.log(priceRange[0]), Math.log(priceRange[1]), Math.log(priceRange[2]))), 500);
  const down = nice(price * rng.tri(0.15, 0.25, 0.45), 500);
  const rate = econ.personal + 0.02;
  const payment = amortize(price - down, rate, 10);
  const noi = (price * rng.tri(0.16, 0.26, 0.42)) / 12;
  return { type: "property", category: "biz", propType: type, name: type, story: rng.pick(BUSINESS_STORIES[type]), price, down, loan: price - down, rate, years: 10, payment: Math.round(payment), noi: Math.round(noi), cashflow: nice(noi - payment, 10) };
}

function makeJobCard(rng, p) {
  const prof = pickProfession(rng, rng.chance(0.6) ? p.job.category : null);
  return { type: "job", title: prof.name, category: prof.category, soc: prof.soc, gig: !!prof.gig, annual: salaryFor(rng, prof) };
}

function makeVentureCard(rng) {
  const price = nice(Math.exp(rng.tri(Math.log(100000), Math.log(400000), Math.log(2500000))), 1000);
  return { type: "venture", name: rng.pick(FAST_VENTURES), price, cashflow: nice((price * rng.tri(0.06, 0.1, 0.18)) / 12, 100) };
}

// ---------------------------------------------------------------- tiles
function resolveTile(state, rng, p) {
  const tile = state.board[p.pos];
  state.card = null;
  switch (tile) {
    case "Opportunity": {
      if (!p.job.employed && rng.chance(0.3)) { state.card = makeJobCard(rng, p); state.phase = "decide"; }
      else { state.card = { type: "choose" }; state.phase = "choose"; } // classic: small deal or big deal?
      break;
    }
    case "Charity": {
      const amt = Math.max(50, nice(statement(p).totalIncome * 0.1, 10));
      state.card = { type: "charity", amount: amt };
      state.phase = "decide";
      narrate(state, "charity_offer", { name: p.name, amt: money(amt) }, p.id);
      break;
    }
    case "Personal Spending": {
      const [item, base] = rng.pick(SPENDING);
      const scale = clamp(Math.max(p.job.annual + (p.life.spouse ? p.life.spouse.annual * 0.5 : 0), 30000) / 70000, 0.5, 3);
      const amt = nice(base * scale * rng.tri(0.8, 1, 1.3), 10);
      payCash(state, p, amt, item);
      p.stats.doodads += amt;
      narrate(state, "spending", { name: p.name, item, amt: money(amt) }, p.id);
      tip(state, p, "doodad");
      state.phase = "manage";
      break;
    }
    case "New Baby": {
      if (p.life.children >= MAX_CHILDREN) log(state, `${p.name} landed on New Baby but the house is already full (${MAX_CHILDREN} kids). No change.`, "info", p.id);
      else {
        p.life.children += 1;
        const add = nice(p.life.col * rng.tri(450, 650, 1150), 10);
        if (!p.living.kids) p.living.kids = { label: "Child care & costs", monthly: 0 };
        p.living.kids.monthly += add;
        if (p.life.filing === "single") p.life.filing = "head_household"; // a single parent files as head of household
        narrate(state, "baby", { name: p.name, amt: money(toPP(add)) }, p.id);
        tip(state, p, "baby");
      }
      state.phase = "manage";
      break;
    }
    case "Downsizing": {
      if (p.job.employed) layoff(state, p, true);
      else {
        const s = statement(p);
        payCash(state, p, s.livingExpenses, "a rough patch");
        log(state, `${p.name} is already job hunting. Tough break: pay one check of expenses (${money(s.livingExpenses)}).`, "warn", p.id);
      }
      state.phase = "manage";
      break;
    }
    case "RE Offer": {
      const owned = p.properties.filter((a) => a.category === "re");
      const propType = owned.length && rng.chance(0.7) ? rng.pick(owned).propType : rng.pick(Object.keys(PROPERTY_TYPES));
      state.card = { type: "offer", propType, multiplier: r2(rng.tri(1.05, 1.25, 1.6)) };
      state.phase = owned.some((a) => a.propType === propType) ? "decide" : "manage";
      log(state, `📨 Market offer: a buyer pays ${Math.round(state.card.multiplier * 100)}% of value for any ${propType.toLowerCase()}.${state.phase === "manage" ? ` ${p.name} doesn't own one. Next time!` : ""}`, "card", p.id);
      if (state.phase === "manage") state.card = null;
      break;
    }
    case "Economic Event": econEvent(state, rng); state.phase = "manage"; break;
    default: state.phase = "manage"; // Start, Pay Day (paycheck already collected while moving)
  }
}

function resolveFastTile(state, rng, p) {
  const tile = FAST_BOARD[p.fast.pos];
  state.card = null;
  state.phase = "manage";
  switch (tile) {
    case "Business": state.card = makeVentureCard(rng); state.phase = "decide"; break;
    case "Dream":
      state.card = { type: "dream", name: p.dream.name, icon: p.dream.icon, price: p.dream.cost };
      state.phase = "decide";
      break;
    case "Lawsuit": { const amt = nice(p.cash / 2, 1); p.cash = r2(p.cash - amt); narrate(state, "lawsuit", { name: p.name, amt: money(amt) }, p.id); break; }
    case "Tax Audit": { const amt = nice(p.cash * 0.3, 1); p.cash = r2(p.cash - amt); narrate(state, "audit", { name: p.name, amt: money(amt) }, p.id); break; }
    case "Market Crash": { const amt = nice(p.cash * 0.25, 1); p.cash = r2(p.cash - amt); narrate(state, "fast_crash", { name: p.name, amt: money(amt) }, p.id); break; }
    default: break; // CashFlow Day: collected while moving
  }
}

function layoff(state, p, skipTurn) {
  p.job.employed = false;
  p.job.laidOff = true;
  p.job.checksUnemployed = 0;
  p.job.benefit = Math.round(Math.min((p.job.annual / PP) * 0.45, BENEFIT_CAP));
  p.job.benefitsLeft = BENEFIT_CHECKS;
  p.k401Rate = 0; p.hsaAnnual = 0;
  if (p.living.health) p.living.health.monthly = Math.round(p.living.health.monthly * 2.2); // losing employer coverage
  if (skipTurn) p.skip = 1;
  p.stats.layoffs += 1;
  narrate(state, "downsized", { name: p.name, amt: money(p.job.benefit) }, p.id);
  tip(state, p, "layoff");
}

function hire(state, p, job) {
  if (p.living.health) p.living.health.monthly = Math.round(p.living.health.monthly / 2.2);
  const wasLaidOff = p.job.laidOff;
  Object.assign(p.job, { title: job.title, category: job.category, soc: job.soc, gig: job.gig, annual: job.annual, employed: true, benefit: 0, benefitsLeft: 0, checksUnemployed: 0, laidOff: false, match: !job.gig && p.job.match !== false });
  if (!job.gig && !p.k401Rate) p.k401Rate = 0.06;
  narrate(state, "hired", { name: p.name, job: job.title, amt: money(job.annual) }, p.id);
  if (wasLaidOff) badge(state, p, "comeback");
}

function econEvent(state, rng) {
  const ev = rng.weighted(ECON_EVENTS.map((e) => [e.id, e.weight]));
  const ps = state.players;
  const shiftMarket = (m) => { for (const [t, v] of Object.entries(state.market)) setPrice(state, t, v.price * (v.fund ? 1 + (m - 1) * 0.3 : m)); };
  let headline;
  switch (ev) {
    case "stock_boom": { const m = r2(rng.tri(1.2, 1.35, 1.7)); shiftMarket(m); headline = `Stocks surge ${Math.round((m - 1) * 100)}%! Every ticker is green.`; break; }
    case "stock_crash": { const m = r2(rng.tri(0.45, 0.65, 0.85)); shiftMarket(m); headline = `Market crash: stocks drop ${Math.round((1 - m) * 100)}%. Hold or fold?`; break; }
    case "housing_up": { const m = r2(rng.tri(1.06, 1.1, 1.18)); ps.forEach((p) => { p.properties.forEach((a) => (a.value = nice(a.value * m, 500))); if (p.life.home) p.life.home.price = nice(p.life.home.price * m, 1000); }); headline = `Property values climb ${Math.round((m - 1) * 100)}%.`; break; }
    case "housing_down": { const m = r2(rng.tri(0.82, 0.9, 0.95)); ps.forEach((p) => { p.properties.forEach((a) => (a.value = nice(a.value * m, 500))); if (p.life.home) p.life.home.price = nice(p.life.home.price * m, 1000); }); headline = `Housing cools: property values fall ${Math.round((1 - m) * 100)}%.`; break; }
    case "rate_shift": { const next = rng.pick(ECONOMIES.filter((e) => e.id !== state.economy.id)); state.economy = makeEconomy(rng, next); headline = `New economy: ${state.economy.name}: ${state.economy.headline}. New loans now at ${(state.economy.mortgage * 100).toFixed(1)}% (mortgage) / ${(state.economy.personal * 100).toFixed(0)}% (bank).`; break; }
    case "inflation": { const m = r2(rng.tri(1.03, 1.05, 1.09)); ps.forEach((p) => { p.living.other.monthly = nice(p.living.other.monthly * m, 10); }); headline = `Inflation bites: everyday costs up ${Math.round((m - 1) * 100)}% for everyone.`; break; }
    case "rent_spike": { const m = r2(rng.tri(1.05, 1.08, 1.14)); const renters = ps.filter((p) => p.living.rent); renters.forEach((p) => (p.living.rent.monthly = nice(p.living.rent.monthly * m, 10))); headline = `Landlords raise rents ${Math.round((m - 1) * 100)}%.${renters.length ? ` Renters affected: ${renters.map((p) => p.name).join(", ")}.` : " Luckily nobody here rents."}`; break; }
    case "layoffs": { const hit = ps.filter((p) => p.job.employed && !p.job.gig && !p.fast && rng.chance(0.2)); headline = `Layoff wave across industries.${hit.length ? ` Hit: ${hit.map((p) => p.name).join(", ")}.` : " Everyone at this table survived 😮‍💨"}`; hit.forEach((p) => layoff(state, p, false)); break; }
  }
  narrate(state, "econ", { headline }, null);
  ps.forEach((p) => checkProgress(state, p));
}

// ---------------------------------------------------------------- paycheck
function payday(state, rng, p) {
  const s = statement(p);
  let net = s.netPay;
  if (p.job.employed && p.job.gig) {
    const swing = r2(rng.tri(0.6, 1, 1.4));
    net = r2(net + (swing - 1) * (p.job.annual / PP));
    log(state, `${p.name}'s gig income this check: ${Math.round(swing * 100)}% of average.`, "info", p.id);
  }
  // pre-tax savings (and the employer match) land in retirement / HSA accounts
  for (const e of s.expenses) { if (e.label.startsWith("401(k)")) p.retirement = r2(p.retirement + e.amount); if (e.label === "HSA contribution") p.hsaBalance = r2(p.hsaBalance + e.amount); }
  if (s.match) { p.retirement = r2(p.retirement + s.match); tip(state, p, "match"); }
  else if (p.job.employed && p.job.match && !p.k401Rate) tip(state, p, "no_match");
  if (net >= 0) { p.cash = r2(p.cash + net); narrate(state, "payday", { name: p.name, amt: money(net) }, p.id); }
  else { narrate(state, "payday_neg", { name: p.name, amt: money(-net) }, p.id); payCash(state, p, -net, "bills"); tip(state, p, "negative_paycheck"); }
  // Every check where all the bills got paid without emergency borrowing builds payment history.
  if (p.credit && !p.credit.missed) { p.credit.onTime += 1; creditChange(state, p, 2, null); }
  if (p.credit) p.credit.missed = false;
  if (!p.job.employed) {
    p.job.checksUnemployed += 1;
    if (p.job.benefitsLeft > 0) p.job.benefitsLeft -= 1;
  } else if (!p.job.gig && ++p.paychecks % RAISE_EVERY === 0) {
    const pct = r2(rng.tri(0.0, 0.03, 0.08));
    if (pct >= 0.005) {
      p.job.annual = nice(p.job.annual * (1 + pct), 100);
      p.stats.raises += 1;
      narrate(state, "raise", { name: p.name, pct: `${(pct * 100).toFixed(1)}%`, amt: money(p.job.annual) }, p.id);
    }
  }
}

// ---------------------------------------------------------------- buying (also used for shared deals)
function buyCard(state, p, card, qty) {
  if (card.type === "stock") {
    qty = Math.floor(Number(qty));
    if (!(qty > 0)) throw new GameError("Enter how many shares.");
    const cost = qty * card.price;
    if (cost > p.cash) throw new GameError(`Not enough cash: ${money(cost)} needed. Borrow from the bank or sell something first.`);
    p.cash = r2(p.cash - cost);
    let h = p.stocks.find((s) => s.ticker === card.ticker);
    if (!h) { h = { ticker: card.ticker, shares: 0, cost: 0, div: 0, price: card.price }; p.stocks.push(h); }
    const divNew = card.price * card.yield;
    h.div = r2((h.div * h.shares + divNew * qty) / (h.shares + qty));
    h.cost = r2((h.cost * h.shares + card.price * qty) / (h.shares + qty));
    h.shares += qty; h.price = card.price;
    p.stats.bought += 1;
    narrate(state, "bought_stock", { name: p.name, n: qty, ticker: card.ticker, price: money(card.price) }, p.id);
    badge(state, p, "first_asset");
    tip(state, p, card.fund ? "dividends" : "first_stock");
    if (h.div > 0) badge(state, p, "dividends");
    return;
  }
  if (card.type === "property") {
    if (card.down > p.cash) throw new GameError(`Down payment is ${money(card.down)}. You have ${money(p.cash)}. Borrow or sell to raise cash.`);
    p.cash = r2(p.cash - card.down);
    const lt = loanTerms(p, card);
    p.properties.push({ id: `a${p.nextId++}`, category: card.category, propType: card.propType, name: card.name, price: card.price, value: card.price, down: card.down, loan: card.loan, rate: lt.rate, payment: lt.payment, noi: card.noi, cashflow: lt.cashflow });
    p.stats.bought += 1;
    if (!p.stats.best || lt.cashflow > p.stats.best.cashflow) p.stats.best = { name: card.name, cashflow: lt.cashflow };
    narrate(state, "bought", { name: p.name, asset: card.name, cf: money(lt.cashflow) }, p.id);
    if (Math.abs(lt.rate - card.rate) > 1e-6) { log(state, `🏦 ${p.name}'s ${lt.tier.label.toLowerCase()} credit (${lt.score}) got a ${(lt.rate * 100).toFixed(2)}% rate instead of ${(card.rate * 100).toFixed(2)}%.`, lt.rate < card.rate ? "credit" : "warn", p.id); tip(state, p, "credit_rates"); }
    badge(state, p, "first_asset");
    badge(state, p, card.category === "biz" ? "boss" : "landlord");
    tip(state, p, lt.cashflow < 0 ? "negative_cashflow" : card.category === "biz" ? "business" : "first_property");
    return;
  }
  throw new GameError("Nothing to buy on this card.");
}

/** Offer a deal the current player passed on (or a stock they bought) to the other players, in turn order. */
function startShare(state, from, card) {
  const order = state.players.map((_, i) => state.players[(state.turn + 1 + i) % state.players.length]).filter((q) => q.id !== from.id && !q.fast);
  const queue = order.filter((q) => (card.type === "stock" ? q.cash >= card.price : q.cash >= card.down)).map((q) => q.id);
  if (!queue.length) return false;
  state.share = { card, queue, from: from.id };
  state.phase = "share";
  const next = state.players.find((q) => q.id === queue[0]);
  narrate(state, "share_offer", { name: next.name, from: from.name }, next.id);
  return true;
}

function nextShare(state) {
  state.share.queue.shift();
  if (!state.share.queue.length) { state.share = null; state.phase = "manage"; return; }
  const next = state.players.find((q) => q.id === state.share.queue[0]);
  log(state, `${next.name}, want in on this deal?`, "card", next.id);
}

// ---------------------------------------------------------------- actions
/**
 * Apply one action. Never mutates the given state. Throws GameError when the action isn't allowed.
 * action.by = id of the player sending it (in online games the host fills this from the connection).
 */
export function apply(prev, action) {
  if (prev.phase === "over") throw new GameError("The game is over.");
  const state = JSON.parse(JSON.stringify(prev));
  for (const q of state.players) if (!q.credit) q.credit = { base: 680, limit: 5000, hist: [680], onTime: 0, late: 0 };
  const rng = Rng.from(state.rng);
  const p = current(state);
  const who = actor(state);
  if (action.by !== undefined && String(action.by) !== who.id) throw new GameError(`It's ${who.name}'s move.`);
  const card = state.card;

  // ---- deal sharing: other players respond to a deal
  if (state.phase === "share") {
    const c = state.share.card;
    if (action.type === "BUY") {
      if (c.type === "property" && state.share.taken) throw new GameError("Someone already bought it.");
      buyCard(state, who, c, action.qty);
      if (c.type === "property") { state.share.taken = true; state.share.queue = [who.id]; }
      nextShare(state);
    } else if (action.type === "PASS") {
      log(state, `${who.name} passes.`, "info", who.id);
      nextShare(state);
    } else throw new GameError(`Waiting for ${who.name} to decide on the shared deal.`);
    state.players.forEach((q) => checkProgress(state, q));
    return finish(state, rng);
  }

  switch (action.type) {
    case "PICK_DREAM": {
      const d = DREAMS.find((x) => x.id === action.id);
      if (!d || !p.dreamOptions.includes(d.id)) throw new GameError("Pick one of your dream options.");
      if (p.fast) throw new GameError("You're already chasing your dream on the Fast Track!");
      p.dream = d;
      log(state, `${p.name}'s dream: ${d.icon} ${d.name} (${money(d.cost)}).`, "info", p.id);
      break;
    }

    case "SET_401K": {
      const rate = Number(action.rate);
      if (!K401_CHOICES.includes(rate)) throw new GameError("Choose 0%, 3%, 6%, 10% or 15%.");
      if (!p.job.employed || p.job.gig) throw new GameError("You need an employer 401(k) for that.");
      p.k401Rate = rate;
      log(state, `${p.name} sets their 401(k) contribution to ${Math.round(rate * 100)}%${p.job.match ? (rate >= 0.06 ? " and gets the full employer match 🙌" : rate > 0 ? " (the employer match goes up to 6%)" : ". No match without contributing!") : ""}.`, "info", p.id);
      break;
    }

    case "ROLL": {
      if (state.phase !== "roll") throw new GameError("You've already rolled.");
      const two = p.fast || p.charityTurns > 0; // the Fast Track always uses 2 dice
      const dice = two ? [rng.int(1, 6), rng.int(1, 6)] : [rng.int(1, 6)];
      if (!p.fast && p.charityTurns > 0) p.charityTurns -= 1;
      const steps = dice.reduce((a, b) => a + b, 0);
      state.dice = dice;
      narrate(state, "roll", { name: p.name, n: two ? `${steps} (${dice.join(" + ")})` : steps }, p.id);
      if (p.fast) {
        for (let k = 1; k <= steps; k++) {
          p.fast.pos = (p.fast.pos + 1) % FAST_TILES;
          if (FAST_BOARD[p.fast.pos] === "CashFlow Day") { const amt = p.fast.base + p.fast.added; p.cash = r2(p.cash + amt); narrate(state, "cashflow_day", { name: p.name, amt: money(amt) }, p.id); }
        }
        log(state, `📍 ${p.name} lands on ${FAST_BOARD[p.fast.pos]} (Fast Track).`, "move", p.id);
        resolveFastTile(state, rng, p);
      } else {
        for (let k = 1; k <= steps; k++) {
          p.pos = (p.pos + 1) % TILES;
          if (state.board[p.pos] === "Pay Day") payday(state, rng, p);
        }
        log(state, `📍 ${p.name} lands on ${state.board[p.pos]}.`, "move", p.id);
        resolveTile(state, rng, p);
      }
      checkProgress(state, p);
      break;
    }

    case "DEAL": {
      if (state.phase !== "choose") throw new GameError("Pick a deal when you land on Opportunity.");
      state.card = action.size === "big" ? makeBigDeal(state, rng) : makeSmallDeal(state, rng);
      state.phase = "decide";
      log(state, `${p.name} draws a ${action.size === "big" ? "BIG" : "small"} deal: ${state.card.type === "stock" ? state.card.ticker : state.card.name}.`, "card", p.id);
      break;
    }

    case "BUY": {
      if (state.phase !== "decide" || !card) throw new GameError("Nothing to buy right now.");
      if (card.type === "job") { hire(state, p, card); state.card = null; state.phase = "manage"; break; }
      if (card.type === "venture") {
        if (card.price > p.cash) throw new GameError(`You need ${money(card.price)}. You have ${money(p.cash)}.`);
        p.cash = r2(p.cash - card.price); p.fast.added += card.cashflow; p.fast.ventures.push({ name: card.name, cashflow: card.cashflow });
        narrate(state, "bought", { name: p.name, asset: card.name, cf: money(card.cashflow) }, p.id);
        if (p.fast.added >= FAST_WIN_CASHFLOW) { state.winner = p.id; state.phase = "over"; narrate(state, "fast_win", { name: p.name, amt: money(p.fast.added) }, p.id); return finish(state, rng); }
        state.card = null; state.phase = "manage";
        break;
      }
      if (card.type === "dream") {
        if (card.price > p.cash) throw new GameError(`Your dream costs ${money(card.price)}. You have ${money(p.cash)}. Keep collecting CashFlow Days!`);
        p.cash = r2(p.cash - card.price);
        state.winner = p.id; state.phase = "over";
        narrate(state, "dream_win", { name: p.name, dream: `${card.icon} ${card.name}` }, p.id);
        return finish(state, rng);
      }
      buyCard(state, p, card, action.qty);
      state.card = null; state.phase = "manage";
      // Stocks are open to everyone at this price (classic rule): offer them around the table.
      if (card.type === "stock") startShare(state, p, card);
      checkProgress(state, p);
      break;
    }

    case "PASS": {
      if (state.phase !== "decide" && state.phase !== "choose") throw new GameError("Nothing to pass on.");
      if (card && card.type === "charity") narrate(state, "charity_no", { name: p.name }, p.id);
      else narrate(state, "passed", { name: p.name }, p.id);
      state.card = null; state.phase = "manage";
      if (card && (card.type === "stock" || card.type === "property")) startShare(state, p, card); // someone else may want it
      break;
    }

    case "CHARITY": {
      if (state.phase !== "decide" || !card || card.type !== "charity") throw new GameError("No charity offer right now.");
      if (card.amount > p.cash) throw new GameError(`You need ${money(card.amount)} in cash to donate.`);
      p.cash = r2(p.cash - card.amount); p.charityTurns = 3; p.stats.charity += card.amount;
      narrate(state, "charity_yes", { name: p.name, amt: money(card.amount) }, p.id);
      badge(state, p, "generous"); tip(state, p, "charity");
      state.card = null; state.phase = "manage";
      break;
    }

    case "SELL_STOCK": {
      if (state.phase === "roll" || state.phase === "choose") throw new GameError("Roll first, then manage your assets.");
      const h = p.stocks.find((s) => s.ticker === action.ticker);
      const qty = Math.floor(Number(action.qty));
      if (!h || !(qty > 0) || qty > h.shares) throw new GameError("Choose a valid number of shares to sell.");
      const atMarket = card && card.type === "stock" && card.ticker === h.ticker;
      const price = atMarket ? card.price : Math.max(1, Math.round(state.market[h.ticker].price * 0.8)); // quick sale outside a market card: 20% discount
      const proceeds = qty * price;
      const gain = qty * (price - h.cost);
      p.cash = r2(p.cash + proceeds); h.shares -= qty;
      if (!h.shares) p.stocks = p.stocks.filter((s) => s !== h);
      p.stats.sold += 1; p.stats.profit = r2(p.stats.profit + gain);
      narrate(state, "sold", { name: p.name, asset: `${qty} ${h.ticker} shares${atMarket ? "" : " (quick sale, -20%)"}`, amt: money(proceeds) }, p.id);
      if (gain > 0) badge(state, p, "flipper");
      if (!atMarket) tip(state, p, "quick_sale");
      checkProgress(state, p);
      break;
    }

    case "SELL_ASSET": {
      if (state.phase === "roll" || state.phase === "choose") throw new GameError("Roll first, then manage your assets.");
      const a = p.properties.find((x) => x.id === action.id);
      if (!a) throw new GameError("Asset not found.");
      const offer = card && card.type === "offer" && card.propType === a.propType;
      // Market offer: full offer price. Otherwise a fire sale: 90% of value, 5% fees, then 20% off the equity for speed.
      const sale = offer ? nice(a.value * card.multiplier, 500) : nice(a.value * 0.9, 500);
      let proceeds = sale - a.loan - (offer ? 0 : sale * 0.05);
      if (!offer && proceeds > 0) proceeds *= 0.8;
      proceeds = nice(proceeds, 10);
      p.properties = p.properties.filter((x) => x !== a);
      if (proceeds >= 0) p.cash = r2(p.cash + proceeds); else payCash(state, p, -proceeds, `paying off ${a.name}'s loan`);
      const gain = proceeds - a.down;
      p.stats.sold += 1; p.stats.profit = r2(p.stats.profit + gain);
      narrate(state, "sold", { name: p.name, asset: `${a.name}${offer ? "" : " (fire sale)"}`, amt: money(proceeds) }, p.id);
      if (gain > 0) badge(state, p, "flipper");
      if (!offer) tip(state, p, "quick_sale");
      if (offer && !p.properties.some((x) => x.propType === card.propType)) { state.card = null; state.phase = "manage"; }
      checkProgress(state, p);
      break;
    }

    case "PAYOFF": {
      if (state.phase === "roll" || state.phase === "choose") throw new GameError("Pay off debts after you roll.");
      const d = p.debts[action.key];
      if (!d) throw new GameError("Debt not found.");
      if (d.balance > p.cash) throw new GameError(`You need ${money(d.balance)} to pay off ${d.label}.`);
      p.cash = r2(p.cash - d.balance);
      delete p.debts[action.key];
      p.stats.debtPaid += d.balance;
      if (action.key === "credit") { creditMark(p); tip(state, p, "credit_util"); log(state, `📈 Credit card paid off: utilization 0%, so ${p.name}'s credit score is now ${creditScore(p)}.`, "credit", p.id, "credit"); if (creditScore(p) >= 800) badge(state, p, "credit_star"); }
      else creditChange(state, p, 6, `${d.label.toLowerCase()} paid in full`);
      log(state, `✂️ ${p.name} paid off ${d.label} (${money(d.balance)}). That's ${money(toPP(d.monthly))} less in expenses every paycheck.`, "good", p.id, "payoff");
      badge(state, p, "debt_slayer");
      tip(state, p, "payoff");
      checkProgress(state, p);
      break;
    }

    case "BORROW": {
      const amt = Math.floor(Number(action.amount) / 1000) * 1000;
      if (!(amt >= 1000)) throw new GameError("Borrow in $1,000 steps.");
      const total = (p.debts.bank ? p.debts.bank.balance : 0) + amt;
      const tier = creditTier(creditScore(p));
      const limit = Math.max(5000, Math.round(((p.job.employed ? p.job.annual : p.job.benefit * PP) * 0.5 + statement(p).passive * PP * 3) * tier.limit));
      if (total > limit) throw new GameError(`The bank caps your loans at ${money(limit)} based on your income and ${tier.label.toLowerCase()} credit.`);
      borrow(state, p, amt);
      creditChange(state, p, -6, "hard inquiry for a new loan");
      tip(state, p, "credit_inquiry");
      break;
    }

    case "REPAY": {
      const d = p.debts.bank;
      const amt = Math.floor(Number(action.amount) / 1000) * 1000;
      if (!d || !(amt >= 1000) || amt > d.balance) throw new GameError("Repay in $1,000 steps, up to your loan balance.");
      if (amt > p.cash) throw new GameError("Not enough cash.");
      p.cash = r2(p.cash - amt); d.balance -= amt; p.stats.debtPaid += amt;
      if (d.balance <= 0) { delete p.debts.bank; creditChange(state, p, 5, "bank loan paid in full"); } else d.monthly = Math.round(amortize(d.balance, d.rate, 5));
      narrate(state, "repay", { name: p.name, amt: money(amt) }, p.id);
      checkProgress(state, p);
      break;
    }

    case "END_TURN": {
      if (state.phase === "roll") throw new GameError("Roll the dice first.");
      if (state.phase === "decide" || state.phase === "choose") throw new GameError("Decide on the card first.");
      state.card = null; state.dice = null;
      advance(state, rng);
      break;
    }

    default: throw new GameError(`Unknown action ${action.type}`);
  }
  return finish(state, rng);
}

function finish(state, rng) {
  state.seq += 1;
  state.rng = rng.s;
  return state;
}

function advance(state, rng) {
  for (let guard = 0; guard < state.players.length * 3; guard++) {
    state.turn = (state.turn + 1) % state.players.length;
    if (state.turn === 0) { state.round += 1; marketDrift(state, rng); }
    const p = current(state);
    if (p.skip > 0) { p.skip -= 1; narrate(state, "skip", { name: p.name }, p.id); continue; }
    // Job hunting: the longer you look, the better your odds.
    if (!p.job.employed && !p.fast) {
      const odds = clamp(0.12 + p.job.checksUnemployed * 0.06, 0.12, 0.6);
      if (rng.chance(odds)) hire(state, p, makeJobCard(rng, p));
    }
    break;
  }
  state.phase = "roll";
}

/** End-of-game report card. */
export function report(state) {
  return state.players.map((p) => {
    const s = statement(p, state.goal);
    return { id: p.id, name: p.name, color: p.color, winner: state.winner === p.id, job: p.job.title, netWorth: s.netWorth, passive: s.passive, progress: s.progress, assets: p.properties.length + p.stocks.length, fast: !!p.fast, badges: p.badges.slice(), credit: creditScore(p), late: p.credit ? p.credit.late : 0, ...p.stats };
  }).sort((a, b) => (b.winner - a.winner) || (b.fast - a.fast) || (b.progress - a.progress) || (b.netWorth - a.netWorth));
}

// ---------------------------------------------------------------- views
export function tileInfo(name) {
  return {
    "Start": { icon: "🏁", color: "#2ecc71", tip: "Start" },
    "Pay Day": { icon: "💰", color: "#f5b700", tip: "Collect a paycheck when you land on or pass this" },
    "Opportunity": { icon: "💡", color: "#4f8cff", tip: "Pick a small or big deal: stocks, funds, real estate, businesses (or a job offer if you're between jobs)" },
    "New Baby": { icon: "👶", color: "#ff9ff3", tip: "A new child: expenses go up" },
    "Charity": { icon: "💛", color: "#feca57", tip: "Donate 10% of income to roll 2 dice for 3 turns" },
    "Personal Spending": { icon: "🛍️", color: "#ff6b6b", tip: "A doodad you have to pay for" },
    "RE Offer": { icon: "📨", color: "#1dd1a1", tip: "A buyer wants a property type. Sell if you own one" },
    "Downsizing": { icon: "📉", color: "#576574", tip: "Layoff: unemployment benefits, skip a turn" },
    "Economic Event": { icon: "📰", color: "#a29bfe", tip: "Market-wide news that affects everyone" },
    // Fast Track
    "CashFlow Day": { icon: "💸", color: "#3cf5a0", tip: "Collect 100× your monthly passive income + your Fast Track business cashflow" },
    "Business": { icon: "🏢", color: "#4f8cff", tip: "Buy a big business: adds monthly cashflow. Add $50k/mo to win" },
    "Dream": { icon: "✨", color: "#ff4fa3", tip: "Buy YOUR dream here to win" },
    "Lawsuit": { icon: "⚖️", color: "#ff5d6c", tip: "Lose half your cash" },
    "Tax Audit": { icon: "🧾", color: "#ff9f43", tip: "Pay 30% of your cash" },
    "Market Crash": { icon: "📉", color: "#576574", tip: "Lose 25% of your cash" },
  }[name] || { icon: "•", color: "#999", tip: name };
}

export { DREAMS, FAST_BOARD, BADGES };
