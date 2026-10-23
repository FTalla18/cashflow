// Federal, FICA and state tax for one bi-weekly paycheck: Freeman's original design
// (intentionally detailed for financial education).
//
// Tax tables live in js/data/tax-tables.json, keyed by tax year. A scheduled GitHub Action
// (.github/workflows/update-tax.yml) adds new years automatically when the IRS publishes them.
// The 2026 table is also embedded below so the game works even if the JSON can't load.
// Sources: IRS Rev. Proc. 2025-32 (2026 brackets & standard deduction), SSA 2026 wage base,
// IRS 2026 retirement / HSA limits.

export const PAYCHECKS_PER_YEAR = 26;
export const FILING_LABEL = { single: "Single", married_joint: "Married filing jointly", married_separate: "Married filing separately", head_household: "Head of household" };

const FALLBACK = {
  2026: {
    source: "IRS Rev. Proc. 2025-32; SSA; IRS COLA notices",
    standardDeduction: { single: 16100, married_joint: 32200, married_separate: 16100, head_household: 24150 },
    // [upper limit, rate]; the last bracket has no upper limit (null)
    brackets: {
      single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [null, 0.37]],
      married_joint: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [null, 0.37]],
      married_separate: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [384350, 0.35], [null, 0.37]],
      head_household: [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [null, 0.37]],
    },
    fica: { socialSecurityRate: 0.062, socialSecurityWageBase: 184500, medicareRate: 0.0145, additionalMedicareRate: 0.009,
      additionalMedicareThreshold: { single: 200000, head_household: 200000, married_joint: 250000, married_separate: 125000 } },
    limits: { k401: 24500, ira: 7500, hsaSelf: 4400, hsaFamily: 8750 },
    childTaxCredit: 2200,
  },
};

const TABLES = { ...FALLBACK };

/** Merge tax tables loaded from tax-tables.json ({ years: { "2027": {...} } }). */
export function setTaxTables(json) {
  if (!json || !json.years) return;
  for (const [y, t] of Object.entries(json.years)) if (validTable(t)) TABLES[y] = t;
}

function validTable(t) {
  try {
    return ["single", "married_joint", "married_separate", "head_household"].every((s) => t.brackets[s].length === 7 && t.standardDeduction[s] > 0);
  } catch { return false; }
}

export const taxYears = () => Object.keys(TABLES).map(Number).sort((a, b) => a - b);

/** The newest table for `year` or earlier (falls back to the oldest one available). */
export function bestTaxYear(year = new Date().getFullYear()) {
  const ys = taxYears();
  return ys.filter((y) => y <= year).pop() || ys[0];
}

export function taxTable(year) { return TABLES[year] || TABLES[bestTaxYear(year)]; }

/** Federal income tax on an annual taxable income. */
export function federalIncomeTax(taxable, status, year = bestTaxYear()) {
  const T = taxTable(year);
  let tax = 0, prev = 0;
  for (const [limit, rate] of T.brackets[status]) {
    const top = limit === null ? Infinity : limit;
    if (taxable <= prev) break;
    tax += (Math.min(taxable, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

/**
 * Taxes withheld from ONE bi-weekly paycheck (annualized method).
 * o = { status, stateRate, k401Annual, hsaAnnual, children, year }
 * Pre-tax 401(k) and HSA lower federal and state taxable income (HSA also skips FICA, as in a cafeteria plan).
 */
export function paycheckTaxes(annualGross, { status = "single", stateRate = 0, k401Annual = 0, hsaAnnual = 0, children = 0, year = bestTaxYear() } = {}) {
  const T = taxTable(year), F = T.fica;
  const k401 = Math.min(k401Annual, T.limits.k401);
  const hsa = Math.min(hsaAnnual, children > 0 || status === "married_joint" ? T.limits.hsaFamily : T.limits.hsaSelf);
  const ficaWages = Math.max(0, annualGross - hsa);
  const socialSecurity = Math.min(ficaWages, F.socialSecurityWageBase) * F.socialSecurityRate;
  const medicare = ficaWages * F.medicareRate + Math.max(0, ficaWages - F.additionalMedicareThreshold[status]) * F.additionalMedicareRate;
  const taxable = Math.max(0, annualGross - k401 - hsa - T.standardDeduction[status]);
  const federal = Math.max(0, federalIncomeTax(taxable, status, year) - children * T.childTaxCredit);
  const state = Math.max(0, annualGross - k401 - hsa) * stateRate;
  const per = (x) => Math.round((x / PAYCHECKS_PER_YEAR) * 100) / 100;
  const out = { federal: per(federal), socialSecurity: per(socialSecurity), medicare: per(medicare), state: per(state), k401: per(k401), hsa: per(hsa) };
  out.totalTax = Math.round((out.federal + out.socialSecurity + out.medicare + out.state) * 100) / 100;
  return out;
}

/** Top bracket rate that applies to the next dollar of taxable income. */
export function marginalRate(taxable, status, year = bestTaxYear()) {
  for (const [limit, rate] of taxTable(year).brackets[status]) if (limit === null || taxable <= limit) return rate;
  return 0.37;
}

/** Annual taxable income after pre-tax savings and the standard deduction. */
export function taxableIncome(annualGross, { status = "single", k401Annual = 0, hsaAnnual = 0, children = 0, year = bestTaxYear() } = {}) {
  const T = taxTable(year);
  const hsa = Math.min(hsaAnnual, children > 0 || status === "married_joint" ? T.limits.hsaFamily : T.limits.hsaSelf);
  return Math.max(0, annualGross - Math.min(k401Annual, T.limits.k401) - hsa - T.standardDeduction[status]);
}

/**
 * Refundable part of the Child Tax Credit ("Additional Child Tax Credit"): when your tax is smaller than the
 * credit, up to $1,700 per child (2025–26) comes back at tax time, phased in at 15% of earnings above $2,500.
 */
export function refundableChildCredit(annualGross, opts = {}) {
  const children = opts.children || 0;
  if (!children) return 0;
  const T = taxTable(opts.year || bestTaxYear());
  const before = federalIncomeTax(taxableIncome(annualGross, opts), opts.status || "single", opts.year);
  const unused = Math.max(0, children * T.childTaxCredit - before);
  return Math.round(Math.min(unused, children * (T.refundableChildCredit || 1700), Math.max(0, (annualGross - 2500) * 0.15)));
}
