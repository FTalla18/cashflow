// The game world: cities, economies, cars, everyday spending and events.
// These replace the old Gemini calls (city, market conditions, car) with curated data, so games are
// deterministic and need no API key. Rates and prices are realistic approximations for gameplay.

// stateRate = approximate effective state + local income tax rate (simplified, for gameplay).
// col = cost-of-living multiplier for everyday expenses; home = typical home price.
export const CITIES = [
  { city: "Tampa", state: "FL", stateRate: 0, col: 1.0, home: 420000 },
  { city: "Orlando", state: "FL", stateRate: 0, col: 1.0, home: 400000 },
  { city: "Miami", state: "FL", stateRate: 0, col: 1.25, home: 610000 },
  { city: "Houston", state: "TX", stateRate: 0, col: 0.95, home: 330000 },
  { city: "Dallas", state: "TX", stateRate: 0, col: 1.0, home: 400000 },
  { city: "Austin", state: "TX", stateRate: 0, col: 1.1, home: 520000 },
  { city: "Nashville", state: "TN", stateRate: 0, col: 1.05, home: 460000 },
  { city: "Las Vegas", state: "NV", stateRate: 0, col: 1.0, home: 430000 },
  { city: "Seattle", state: "WA", stateRate: 0, col: 1.45, home: 850000 },
  { city: "Atlanta", state: "GA", stateRate: 0.05, col: 1.05, home: 400000 },
  { city: "Charlotte", state: "NC", stateRate: 0.04, col: 1.0, home: 400000 },
  { city: "Raleigh", state: "NC", stateRate: 0.04, col: 1.0, home: 430000 },
  { city: "Phoenix", state: "AZ", stateRate: 0.025, col: 1.0, home: 450000 },
  { city: "Denver", state: "CO", stateRate: 0.044, col: 1.2, home: 600000 },
  { city: "Salt Lake City", state: "UT", stateRate: 0.045, col: 1.05, home: 520000 },
  { city: "Chicago", state: "IL", stateRate: 0.0495, col: 1.1, home: 340000 },
  { city: "Minneapolis", state: "MN", stateRate: 0.06, col: 1.1, home: 350000 },
  { city: "Columbus", state: "OH", stateRate: 0.05, col: 0.9, home: 290000 },
  { city: "Indianapolis", state: "IN", stateRate: 0.048, col: 0.9, home: 260000 },
  { city: "Kansas City", state: "MO", stateRate: 0.05, col: 0.9, home: 280000 },
  { city: "Detroit", state: "MI", stateRate: 0.066, col: 0.85, home: 250000 },
  { city: "Philadelphia", state: "PA", stateRate: 0.068, col: 1.1, home: 280000 },
  { city: "Boston", state: "MA", stateRate: 0.05, col: 1.4, home: 800000 },
  { city: "New York", state: "NY", stateRate: 0.065, col: 1.6, home: 800000 },
  { city: "Los Angeles", state: "CA", stateRate: 0.06, col: 1.5, home: 950000 },
];

// One shared economy per game (fair for everyone); Economic Event tiles can shift it.
// stocks = multiplier on stock prices while this economy lasts.
export const ECONOMIES = [
  { id: "soft", name: "Soft Landing", headlines: ["Inflation cools, jobs hold steady", "Fed: 'cautiously optimistic'"], mortgage: 0.065, credit: 0.22, auto: 0.075, personal: 0.12, appreciation: 0.04, stocks: 1.0 },
  { id: "rally", name: "Rate Cut Rally", headlines: ["Fed cuts rates, markets cheer", "Cheap money is back (for now)"], mortgage: 0.058, credit: 0.20, auto: 0.065, personal: 0.11, appreciation: 0.06, stocks: 1.15 },
  { id: "sticky", name: "Sticky Inflation", headlines: ["Groceries up again, Fed holds rates high", "'Higher for longer' sticks around"], mortgage: 0.072, credit: 0.24, auto: 0.085, personal: 0.14, appreciation: 0.03, stocks: 0.95 },
  { id: "recession", name: "Recession Watch", headlines: ["Layoff headlines spread, consumers pull back", "Economists split on recession odds"], mortgage: 0.060, credit: 0.23, auto: 0.08, personal: 0.13, appreciation: -0.02, stocks: 0.8 },
  { id: "aiboom", name: "AI Boom", headlines: ["Tech stocks rip on AI earnings", "Everyone's a genius in a bull market"], mortgage: 0.068, credit: 0.22, auto: 0.078, personal: 0.12, appreciation: 0.05, stocks: 1.3 },
  { id: "squeeze", name: "Housing Squeeze", headlines: ["Home prices hit record highs", "Bidding wars are back"], mortgage: 0.075, credit: 0.23, auto: 0.08, personal: 0.13, appreciation: 0.07, stocks: 1.0 },
  { id: "crunch", name: "Credit Crunch", headlines: ["Banks tighten lending standards", "Loans get harder to land"], mortgage: 0.078, credit: 0.26, auto: 0.095, personal: 0.16, appreciation: -0.01, stocks: 0.85 },
  { id: "goldilocks", name: "Goldilocks", headlines: ["Not too hot, not too cold", "Steady growth, low unemployment"], mortgage: 0.060, credit: 0.20, auto: 0.07, personal: 0.11, appreciation: 0.045, stocks: 1.1 },
];

export const CARS = [
  ["2014 Toyota Camry SE", 9500], ["2016 Honda Civic LX", 12500], ["2018 Kia Sorento LX", 15000], ["2019 Toyota Corolla LE", 17000],
  ["2020 Kia Optima LX", 16000], ["2020 Nissan Altima S", 19000], ["2021 Honda CR-V EX", 26000], ["2022 Kia Sorento LX", 28000],
  ["2022 Toyota RAV4 XLE", 31000], ["2023 Hyundai Tucson SEL", 27000], ["2024 Tesla Model Y", 41000], ["2023 Ford F-150 XLT", 46000],
  ["2022 Chevy Tahoe LT", 52000], ["2023 BMW X5 xDrive40i", 62000], ["2024 Mercedes-Benz GLE 350", 68000], ["2025 Porsche Macan", 80000],
];

// "Personal Spending" tiles (the classic doodads). cost = typical cost; scaled by the player's income.
export const SPENDING = [
  ["a new phone (the old one was 'too slow')", 1100], ["concert tickets + merch", 450], ["a spontaneous weekend in Miami", 900],
  ["limited-drop sneakers", 350], ["a gaming PC build", 1800], ["brunch with the group chat (again)", 140],
  ["new tires after a pothole", 800], ["a dental emergency", 1400], ["a vet bill for the dog", 650],
  ["flights + gift for a friend's wedding", 1100], ["streaming subscriptions you forgot about", 120], ["an impulse online shopping haul", 320],
  ["a fridge that suddenly died", 1300], ["a designer bag", 1600], ["a home gym setup", 950], ["a bachelor/bachelorette trip", 1250],
];

// Economic Event tiles (affect the whole table).
export const ECON_EVENTS = [
  { id: "stock_boom", weight: 3 }, { id: "stock_crash", weight: 3 }, { id: "housing_up", weight: 2 }, { id: "housing_down", weight: 2 },
  { id: "rate_shift", weight: 3 }, { id: "inflation", weight: 2 }, { id: "rent_spike", weight: 2 }, { id: "layoffs", weight: 1 },
];

// Real estate types (story keys match REAL_ESTATE_STORIES). price in USD; cap = net operating yield per year.
export const PROPERTY_TYPES = {
  "HOUSE FOR SALE": { price: [140000, 650000], cap: [0.045, 0.085], down: [0.05, 0.2], years: 30 },
  "APARTMENT BUILDING": { perUnit: [85000, 175000], units: [4, 60], cap: [0.05, 0.09], down: [0.2, 0.3], years: 30 },
  "Office Building": { price: [1200000, 9000000], cap: [0.06, 0.1], down: [0.25, 0.35], years: 25 },
  "Big Retail Space": { price: [1500000, 8000000], cap: [0.06, 0.095], down: [0.25, 0.35], years: 25 },
  "Small Retail Space": { price: [300000, 1800000], cap: [0.06, 0.1], down: [0.2, 0.3], years: 25 },
  "Storage Unit": { price: [700000, 5000000], cap: [0.06, 0.1], down: [0.2, 0.3], years: 25 },
  "Warehouse": { price: [600000, 6000000], cap: [0.055, 0.09], down: [0.2, 0.3], years: 25 },
  "Strip Mall": { price: [1200000, 7000000], cap: [0.065, 0.1], down: [0.25, 0.35], years: 25 },
  "Mixed-Use Building": { price: [800000, 5000000], cap: [0.055, 0.09], down: [0.2, 0.3], years: 25 },
  "Office Park": { price: [2500000, 12000000], cap: [0.06, 0.1], down: [0.25, 0.35], years: 25 },
  "Parking Lot": { price: [250000, 2500000], cap: [0.05, 0.09], down: [0.2, 0.3], years: 25 },
};

// Stocks: price range + dividend yield. Story 1 & 2 are bullish (price near the top), story 3 bearish.
export const STOCK_PRICING = {
  "Greentech": { range: [8, 60], yield: 0 }, "QuickFix": { range: [5, 40], yield: 0 }, "Edutech Ltd.": { range: [4, 35], yield: 0 },
  "CleanWater Solutions": { range: [20, 90], yield: 0.025 }, "EcoTransprt": { range: [3, 30], yield: 0 }, "HealthFirst Clinics": { range: [25, 120], yield: 0.015 },
  "HealthPets Inc.": { range: [10, 70], yield: 0.01 }, "Bright Energy": { range: [15, 80], yield: 0.035 }, "FreshFarms Foods": { range: [12, 55], yield: 0.03 },
  "TechGlobe Inc.": { range: [40, 400], yield: 0 }, "Lala Goods": { range: [6, 45], yield: 0 }, "FitLife Equipment": { range: [5, 50], yield: 0.01 },
};
