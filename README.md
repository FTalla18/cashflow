# CashFlow: Escape the Rat Race

A multiplayer, browser-based remake of Freeman Talla's CashFlow game. Each player lives a real-life character: a job (or not), a city, rent or a mortgage, a car loan, maybe kids and a working spouse. Players beat the bills, buy assets, and race to be the first whose **passive income covers their living expenses**.

**Play:** https://ftalla18.github.io/cashflow/

## Features
- **Real numbers:**
  - Salaries for 110 professions from the U.S. Bureau of Labor Statistics wage survey (May 2025).
  - 2026 federal tax brackets, FICA, 401(k) and HSA limits.
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
- **Sound effects** synthesized in the browser (with a mute toggle), plus token-hop animation.

## Files
```
index.html            lobby + game screen
css/styles.css        styling
js/engine.js          all game rules (pure, deterministic)
js/tax.js             2026 paycheck taxes
js/rng.js             seeded random numbers
js/narrator.js        Gen Z narrator lines
js/ui.js              rendering
js/net.js             online rooms (PeerJS)
js/sound.js           sound effects (Web Audio)
js/main.js            app controller
js/data/              professions (BLS), original stories, cities/economies/cars/events
tests/                engine tests + 100s of simulated games (open tests/index.html)
```

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Not financial advice. It's a game 💅
