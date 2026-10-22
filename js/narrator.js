// "Cash": the Gen Z narrator. Lines vary from game to game, but they're picked with a
// flavor stream derived from the seed (see flavorRng), so a replay always shows the same lines and
// narration can never change the game itself.
import { flavorRng } from "./rng.js";

const LINES = {
  start: ["Welcome to the rat race, besties 🐀 First one to make passive income cover their bills wins. No cap.", "Alright y'all, real life just loaded in 🎮 Escape the rat race: make your money work harder than you do.", "New game, new you 💸 Stack assets, dodge doodads, escape the rat race. Let's get it."],
  roll: ["{name} rolled a {n} 🎲", "{name} throws the dice… {n}!", "Dice said {n} for {name} 🎲", "{n}! {name} is on the move"],
  payday: ["Payday hit 💰 {name} pockets {amt} after bills. Love that for you.", "Paycheck secured 🙌 {name} nets {amt}.", "{name}'s direct deposit just landed: {amt}. Budget responsibly, bestie.", "Payday! {name} clears {amt} after expenses ✨"],
  payday_neg: ["Payday… but bills ate it all 😬 {name} is down {amt} this check.", "Oof. {name}'s expenses beat income by {amt}. Time to lock in.", "Not the negative paycheck 💀 {name} loses {amt}."],
  spending: ["{name} couldn't resist {item} for {amt} 🛍️ The doodads always get us.", "Retail therapy moment: {name} spends {amt} on {item}. It's giving financial villain era.", "{name} just dropped {amt} on {item}. Was it worth it? Lowkey no.", "Life happened: {item} cost {name} {amt} 😮‍💨"],
  baby: ["Congrats {name}, it's a baby! 👶 Expenses go up {amt}/check, but so does the love.", "{name} welcomes a new little one 🍼 +{amt} per paycheck in costs. Worth it fr.", "Baby alert 👶 {name}'s budget just got a new line item: {amt}/check."],
  charity_offer: ["Charity tile 💛 {name}, donate {amt} (10% of gross pay) and roll 2 dice for your next 3 turns?", "Giving back hits different 💛 {name} can donate {amt} for 3 turns of double dice."],
  charity_yes: ["{name} donated {amt} 💛 Good karma + 2 dice for 3 turns. Main character behavior.", "Respect. {name} gave {amt} and unlocks 2 dice for 3 turns 🙌"],
  charity_no: ["{name} passed on charity. Valid, the budget is the budget.", "No donation this time for {name}. We move."],
  downsized: ["Plot twist 📉 {name} got laid off. Unemployment checks: {amt} for a while. Sit out 1 turn and regroup.", "{name} just got the 'restructuring' email 💀 Benefits: {amt}/check while job hunting."],
  hired: ["{name} landed a job as a {job} 🎉 New salary: {amt}/yr. We're so back.", "Offer accepted! {name} is now a {job} making {amt}/yr 🙌", "{name} got hired as a {job} ({amt}/yr). The grind paid off fr."],
  bought: ["{name} copped {asset} 🏠 Passive income {cf}/mo. Building that empire.", "Deal closed ✅ {name} owns {asset} now ({cf}/mo).", "{name} said bet and bought {asset}. Cashflow: {cf}/mo 📈"],
  bought_stock: ["{name} bought {n} shares of {ticker} at {price} 📈", "{name} loads up on {ticker}: {n} shares @ {price}. Diamond hands?", "{n} shares of {ticker} for {name}. Let's see if it moons 🚀"],
  sold: ["{name} sold {asset} for {amt} 💰 Bag secured.", "Cash out! {name} gets {amt} from {asset}.", "{name} flipped {asset} for {amt}. W."],
  passed: ["{name} passed. Not every deal is the move.", "{name} said 'nah' to this one 🙅", "Pass. {name} is waiting for a better deal."],
  econ: ["📰 Economic news: {headline}", "🌍 The economy shifted: {headline}", "Breaking: {headline} 📰"],
  win: ["🏆 {name} ESCAPED THE RAT RACE! Passive income {passive} covers expenses {exp}. Financial freedom unlocked. Absolute legend.", "🏆 It's giving FINANCIALLY FREE. {name}'s assets pay {passive}/check vs {exp} in expenses. GG!"],
  skip: ["{name} sits this turn out (job hunting) 🕐", "{name} is skipping a turn to regroup."],
  loan: ["{name} took a {amt} bank loan 🏦 Payment: {pay}/check. Use it wisely.", "Loan approved: {amt} for {name}. That's {pay} more per check 😬"],
  repay: ["{name} paid down {amt} of bank loans. Debt-free arc loading 📉", "{name} repaid {amt}. Less debt, more vibes."],
};

/** Pick a line for `key`, filling {placeholders} from vars. Deterministic per (seed, counter). */
export function say(seed, counter, key, vars = {}) {
  const options = LINES[key] || [key];
  const line = flavorRng(seed, counter).pick(options);
  return line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
