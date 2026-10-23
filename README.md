# CashFlow: Escape the Rat Race

A multiplayer, browser-based remake of Freeman Talla's CashFlow game. Each player lives a real-life character: a job (or not), a city, rent or a mortgage, a car loan, maybe kids and a working spouse. Players beat the bills, buy assets, and race to be the first whose **passive income covers their living expenses**.

**Play:** https://ftalla18.github.io/cashflow/

## Features
- **Real numbers:**
  - Salaries for 110 professions from the U.S. Bureau of Labor Statistics wage survey (May 2025).
  - The latest IRS federal tax brackets, FICA, 401(k) and HSA limits. A monthly GitHub Action imports new IRS tables automatically and only publishes them if they pass validation (see below).
  - Approximate state taxes for 25 cities.
- **Real lives:**
  - About 12% of characters start between jobs, with unemployment benefits and job hunting.
  - Gig workers with variable pay, and working spouses taxed jointly.
  - Renters and homeowners, student loans, credit cards, kids.
- **The original content:** 12 stocks with storylines, 11 real-estate types and 29 businesses with seller stories, plus the 9×9 board (Pay Day, Opportunity, New Baby, Charity, Personal Spending, RE Offer, Downsizing, Economic Event).
- **Classic mechanics:**
  - Small deals or big deals, and buyer offers.
  - Quick sales with a 20% penalty, paying off debt, and bank loans.
  - Charity gives 2 dice for 3 turns.
  - Economy-wide events: crashes, booms, rate changes, inflation, layoffs.
- **Multiplayer:**
  - Pass-and-play on one device, or online rooms with a 5-letter code.
  - Online play is browser-to-browser (WebRTC via PeerJS), so there's no server to run.
  - The host's browser referees every move.
- **Deterministic:** every game comes from a seed, and the same seed plus the same moves always replay identically. Gen Z narration ("Cash") varies from game to game but never changes the outcome.
- **Three modes:** Quick (60%), Standard (100%), and **Classic**: escape the rat race, then win on the 🚀 **Fast Track** (CashFlow Day, big business ventures, lawsuits, audits) by buying the dream you picked.
- **Live stock market:** every ticker has a price history with sparklines. Prices drift each round and react to news and economic events.
- **Credit score (300–850):** built from payment history, card utilization and hard inquiries. Your tier sets your mortgage and bank-loan rates, so the same deal can cash-flow for one player and lose money for another.
- **Shared deals:** pass on a deal and the next player can grab it. Stocks are open to everyone at the same price.
- **Financial literacy built in:**
  - Your 401(k) % is up to you, and most employers match 50% up to 6%.
  - Raises come at annual reviews.
  - One-time money tips when things happen (first stock, negative cashflow, a layoff…).
  - Badges, plus an end-of-game report card with a lesson for each player.
  - **Ask Cash 💬**: a built-in coach that reads your statement and suggests your next best moves. An optional Botpress AI chat can be added (see [botpress/](botpress/)).
- **Online turn timer:** the host can set 60s, 90s or 3 minutes. Disconnected players get auto-skipped.
- **Sound effects** synthesized in the browser (with a mute toggle), plus token-hop animation.

## Files
```
index.html            lobby + game screen
css/styles.css        styling
js/engine.js          all game rules (pure, deterministic)
js/tax.js             paycheck taxes (table-driven by tax year)
js/coach.js           Ask Cash coach (+ coach-config.js for Botpress)
js/data/tax-tables.json  IRS tables by year (auto-updated)
scripts/update_tax.py IRS tax-table importer + validator
.github/workflows/    monthly tax-table update
botpress/             Cash AI bot: instructions + knowledge base
js/rng.js             seeded random numbers
js/narrator.js        Gen Z narrator lines
js/ui.js              rendering
js/net.js             online rooms (PeerJS)
js/sound.js           sound effects (Web Audio)
js/main.js            app controller
js/data/              professions (BLS), original stories, cities/economies/cars/events
tests/                engine tests + 100s of simulated games (open tests/index.html)
```

## Automatic tax updates
`.github/workflows/update-tax.yml` runs on the 1st of every month (and the 15th in Oct–Dec). It:
1. Finds the IRS Revenue Procedure with next year's inflation adjustments.
2. Parses the four bracket tables and the standard deductions.
3. Checks that every base-tax amount the IRS prints matches the game's own calculation.
4. Commits the new year to `js/data/tax-tables.json`.

The game then uses the newest table for the current year automatically. If validation fails, nothing is published and a GitHub issue is opened instead. If Congress changes the numbers after the IRS publishes, run the workflow manually ("Run workflow") with the new PDF URL.

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Not financial advice. It's a game 💅
