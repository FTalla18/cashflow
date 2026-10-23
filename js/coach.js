// "Ask Cash": a money coach. The built-in coach reads your financial statement and gives the
// next best moves (instant, offline, deterministic). If a Botpress bot is configured in
// coach-config.js, a "Chat with Cash" button opens it for free-form questions.
import { COACH } from "./coach-config.js";
import { statement, actor, money, creditScore, creditTier, utilization, playerDate, MONTHS, DREAMS, dreamPrice } from "./engine.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const botReady = () => !!(COACH.inject && COACH.config);
let loading = null;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.defer = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function loadBot() {
  if (!loading) loading = loadScript(COACH.inject).then(() => loadScript(COACH.config)).then(() => new Promise((r) => setTimeout(r, 600)));
  return loading;
}

export function initCoach() {
  $("coachBtn").hidden = false;
}

/** Cash's read on a player's situation: a few prioritized, concrete moves. */
export function advice(g, p) {
  const s = statement(p, g.goal);
  const out = [];
  if (p.fast) {
    const afford = DREAMS.filter((d) => dreamPrice(p, d) <= p.cash);
    out.push(`You're on the Fast Track 🚀 Each Payout Day pays ${money(p.fast.base + p.fast.added)}. ${afford.length ? `You can already afford ${afford.length} of the ${DREAMS.length} dreams. Land on one and buy it to win!` : `The cheapest dream is ${money(Math.min(...DREAMS.map((d) => dreamPrice(p, d))))} and you have ${money(p.cash)}.`}`);
    out.push("Lawsuits and audits take a % of your CASH, so buying businesses protects money and grows Payout Day at the same time.");
    return out;
  }
  if (s.monthlyCashflow < 0) out.push(`🚨 Your monthly cashflow is negative (${money(s.monthlyCashflow)}): two paychecks don't cover the bills on the 1st. First priority: cut a bill (pay down a debt) or add income.`);
  else if (p.cash < s.billsTotal) out.push(`🧾 Heads up: ${money(s.billsTotal)} in bills hits on the 1st and you have ${money(p.cash)}. Keep a cushion so you don't miss a payment (−30 credit).`);
  const debts = Object.entries(p.debts).filter(([k]) => k !== "mortgage").map(([k, d]) => ({ k, ...d })).sort((a, b) => b.rate - a.rate);
  const payable = debts.find((d) => d.balance <= p.cash);
  if (payable && payable.rate >= 0.1) out.push(`✂️ Pay off your ${payable.label.toLowerCase()} (${money(payable.balance)} at ${(payable.rate * 100).toFixed(0)}%). That's a guaranteed ${(payable.rate * 100).toFixed(0)}% return and ${money(payable.monthly)} less in bills every month.`);
  else if (debts.length && debts[0].rate >= 0.15) out.push(`💳 Your ${debts[0].label.toLowerCase()} balance charges ${(debts[0].rate * 100).toFixed(0)}%. Save up ${money(debts[0].balance)} to wipe it out. It's the highest-interest debt you have.`);
  const sc = creditScore(p), tier = creditTier(sc), u = utilization(p);
  if (u >= 0.3 && p.debts.credit) out.push(`💳 Your credit score is ${sc} (${tier.label}) and your cards are ${Math.round(u * 100)}% maxed. Paying off the ${money(p.debts.credit.balance)} card balance drops utilization to 0% and can jump your score fast, which means cheaper mortgages.`);
  else if (sc < 670) out.push(`💳 Your credit score is ${sc} (${tier.label}), so every loan costs you extra (+${(tier.mortgage * 100).toFixed(1)}% on mortgages). Avoid missed payments: keep enough cash so bills never trigger an emergency loan.`);
  else if (p.credit && p.credit.late) out.push(`💳 Credit ${sc}. You've had ${p.credit.late} missed payment${p.credit.late > 1 ? "s" : ""}. Every month of on-time bills slowly rebuilds it.`);
  if (p.job.employed && p.job.match && p.k401Rate < 0.06) out.push(`🏦 Your employer matches 50% of your 401(k) up to 6% of pay, and you're at ${Math.round(p.k401Rate * 100)}%. Bumping to 6% is free money for retirement (it doesn't count toward escaping, though).`);
  if (!p.job.employed) out.push(`💼 You're between jobs. Benefits last ${p.job.benefitsLeft} more checks. Your hiring odds go up every turn, and Opportunity tiles can bring job offers.`);
  const gap = s.target - s.passive;
  if (gap > 0) out.push(`🐀 To escape you need ${money(gap)} more passive income a month. Look for deals with positive cashflow and a cash-on-cash return above 10%.`);
  if (p.tax && p.tax.pending) out.push(p.tax.pending.amount >= 0 ? `📬 A ${money(p.tax.pending.amount)} tax refund lands in April. Have a plan for it: a down payment beats a doodad.` : `📬 You'll owe ${money(-p.tax.pending.amount)} in taxes in April. Set it aside now.`);
  if (p.cash > 15000 && s.passive < s.target * 0.5) out.push(`💰 You have ${money(p.cash)} sitting in cash. Cash doesn't pay you. Consider a big deal next time you land on Opportunity.`);
  const neg = p.properties.filter((a) => a.cashflow < 0);
  if (neg.length) out.push(`⚠️ ${neg.map((a) => a.name).join(", ")} ${neg.length > 1 ? "lose" : "loses"} money every month. Watch for a buyer offer (📨) to sell at a good price.`);
  if (p.stocks.some((h) => !h.div)) out.push("📈 Growth stocks don't pay dividends, so they don't count toward escaping. Sell them high on a stock card and use the cash for cashflow assets.");
  if (!out.length) out.push("You're doing great. Keep buying assets that pay you every month 💅");
  return out.slice(0, 4);
}

/**
 * A plain-text snapshot of a player's game finances. The AI chat can't see the screen, so "Chat about my numbers"
 * sends this as the opening message (visible to the player, nothing hidden).
 */
export function snapshot(g, p) {
  const s = statement(p, g.goal), d = playerDate(g, p);
  const sc = creditScore(p);
  const job = p.job.employed ? `${p.job.title}, ${money(p.job.annual)}/yr${p.job.gig ? " (gig, pay varies)" : ""}` : `between jobs (was ${p.job.title}), ${p.job.benefitsLeft ? `${money(p.job.benefit)} unemployment per paycheck, ${p.job.benefitsLeft} checks left` : "no benefits left"}`;
  const debts = Object.values(p.debts).map((x) => `${x.label} ${money(x.balance)} at ${(x.rate * 100).toFixed(1)}% (${money(x.monthly)}/mo)`);
  const loans = p.properties.filter((a) => a.loan > 0).map((a) => `${a.name} loan ${money(a.loan)} at ${(a.rate * 100).toFixed(2)}% (${money(a.payment)}/mo)`);
  const assets = [...p.properties.map((a) => `${a.name} (cashflow ${money(a.cashflow)}/mo)`), ...p.stocks.map((h) => `${h.shares} ${h.ticker} @ ${money(h.price)}${h.div ? " (pays dividends)" : ""}`)];
  const lines = [
    `📊 My Rat Race Royale snapshot (${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, round ${g.round}, ${g.length} mode)`,
    `Job: ${job}${p.life.spouse ? `. Spouse: ${p.life.spouse.title}, ${money(p.life.spouse.annual)}/yr` : ""}`,
    `Life: ${p.life.city}, ${p.life.state} · ${p.life.housing === "own" ? "homeowner" : "renter"} · ${p.life.children} ${p.life.children === 1 ? "kid" : "kids"}`,
    `Cash: ${money(p.cash)} · Take-home: ${money(s.takeHome)} per paycheck (every 2 weeks)`,
    `Monthly bills: ${money(s.billsTotal)} · Monthly cashflow: ${money(s.monthlyCashflow)}`,
    p.fast ? `Fast Track: favorite dream ${p.dream.name} costs me ${money(dreamPrice(p, p.dream))}; I can afford ${DREAMS.filter((d) => dreamPrice(p, d) <= p.cash).length} of ${DREAMS.length} dreams; Payout Day pays ${money(p.fast.base + p.fast.added)}; Fast Track businesses add ${money(p.fast.added)}/mo` : `Passive income: ${money(s.passive)}/mo of ${money(s.target)}/mo needed to escape (${Math.round(s.progress * 100)}%)`,
    `Debts: ${[...debts, ...loans].join("; ") || "none"}`,
    `Assets: ${assets.join("; ") || "none yet"} · Net worth ${money(s.netWorth)}`,
    `Credit score: ${sc} (${creditTier(sc).label}), card use ${Math.round(utilization(p) * 100)}%${p.credit && p.credit.late ? `, ${p.credit.late} missed payments` : ""}`,
    `401(k): ${Math.round(p.k401Rate * 100)}%${p.job.match ? " (employer matches 50% up to 6%)" : ""} · Taxes: ${p.tax && p.tax.pending ? `${p.tax.pending.amount >= 0 ? `${money(p.tax.pending.amount)} refund` : `${money(-p.tax.pending.amount)} owed`} coming in April` : "nothing pending"}`,
    `What should I do next?`,
  ];
  return lines.join("\n");
}

/** Open the Botpress chat; optionally send a first message once the chat has a conversation going. */
let convoReady = null;
async function openChat(message) {
  await loadBot();
  if (!convoReady) convoReady = new Promise((res) => {
    try { window.botpress.on("conversation", () => res(true)); } catch {}
    setTimeout(() => res(false), 12000);
  });
  window.botpress.open();
  if (!message) return true;
  await convoReady;
  await new Promise((r) => setTimeout(r, 400));
  try {
    await Promise.race([window.botpress.sendMessage(message), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
    return true;
  } catch { return false; }
}

export async function openCoach(g, viewerId) {
  const dlg = $("coachDialog");
  const p = g ? g.players.find((x) => x.id === viewerId) || actor(g) : null;
  $("coachBody").innerHTML = `<button class="modal__close" data-act="close" aria-label="Close">×</button>
    <p class="card__kicker">💬 Ask Cash</p><h2>${p ? `Cash's take on ${esc(p.name)}'s money` : "Hey, I'm Cash 👋"}</h2>
    ${p ? `<ul class="advice">${advice(g, p).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : `<p class="muted">Start a game and I'll read your financial statement and tell you the next best move. No cap.</p>`}
    ${botReady() ? `<div class="actions">${p ? `<button class="btn btn--accent" id="chatMine">📊 Chat about my numbers</button>` : ""}<button class="btn btn--ghost" id="chatCash">💬 Just chat</button></div>
      ${p ? `<p class="muted" style="font-size:.76rem;margin:8px 0 0">"Chat about my numbers" sends Cash a snapshot of ${esc(p.name)}'s game finances (job, cash, bills, debts, credit) as your first message.</p>` : ""}` : ""}
    <p class="muted" style="font-size:.78rem;margin:12px 0 0">Cash is a game coach, not a financial advisor 💅</p>`;
  dlg.showModal();
  const go = (btn, msg) => btn && (btn.onclick = async () => {
    btn.disabled = true; const label = btn.textContent; btn.textContent = "Loading Cash…";
    try {
      const sent = await openChat(msg); dlg.close();
      if (msg && !sent) { try { await navigator.clipboard.writeText(msg); } catch {} alert("Cash's chat opened, but the snapshot couldn't be sent automatically. It's copied: paste it into the chat."); }
    } catch { btn.textContent = "Couldn't load the chat. Try again later."; return; }
    btn.disabled = false; btn.textContent = label;
  });
  go($("chatMine"), p ? snapshot(g, p) : null);
  go($("chatCash"), null);
}
