"""
Automatic tax-table updater for Rat Race Royale.

Run by .github/workflows/update-tax.yml every month. For each tax year it doesn't have yet, it:
  1. finds the IRS Revenue Procedure with that year's inflation adjustments (irs.gov/pub/irs-drop/rp-YY-NN.pdf),
  2. extracts the 4 bracket tables + standard deductions,
  3. VERIFIES them: rates must be 10/12/22/24/32/35/37%, thresholds must increase, and the tax the IRS
     prints at the start of every bracket must match what our own calculation gives (to the dollar),
  4. adds the year to js/data/tax-tables.json (Social Security wage base from ssa.gov; contribution limits carried
     forward from the previous year unless found).
If anything fails validation the script exits with an error, and the workflow opens a GitHub issue instead of
publishing bad numbers.

Usage: python scripts/update_tax.py [--year 2027] [--pdf path_or_url] [--dry-run]
"""
import argparse, datetime, io, json, re, sys, urllib.request
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "js" / "data" / "tax-tables.json"
UA = {"User-Agent": "Mozilla/5.0 (Rat Race Royale tax updater; https://github.com/FTalla18/rat-race-royale)"}
RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]
STATUSES = ["single", "married_joint", "married_separate", "head_household"]


def fetch(url, timeout=40):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def money(s):
    return float(s.replace(",", ""))


def find_rev_proc(year):
    """Locate the Rev. Proc. PDF for `year` (published in year-1)."""
    # 1) the IRS newsroom announcement links to it
    try:
        html = fetch(f"https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-{year}").decode("utf-8", "ignore")
        m = re.search(r"/pub/irs-drop/(rp-\d\d-\d+\.pdf)", html)
        if m:
            return "https://www.irs.gov/pub/irs-drop/" + m.group(1)
    except Exception as e:
        print(f"newsroom lookup failed: {e}")
    # 2) otherwise try the likely Rev. Proc. numbers for that year
    yy = str(year - 1)[2:]
    for n in range(25, 70):
        url = f"https://www.irs.gov/pub/irs-drop/rp-{yy}-{n:02d}.pdf"
        try:
            text = pdf_text(fetch(url), pages=3)
            if f"taxable years beginning in {year}" in text and "Tax Rate Tables" in text:
                return url
        except Exception:
            continue
    return None


def pdf_text(data, pages=None):
    r = PdfReader(io.BytesIO(data))
    ps = r.pages if pages is None else r.pages[:pages]
    return re.sub(r"\s+", " ", " ".join(p.extract_text() or "" for p in ps))


def tax_at(chain, income):
    tax, prev = 0.0, 0.0
    for upper, rate in chain:
        top = float("inf") if upper is None else upper
        if income <= prev:
            break
        tax += (min(income, top) - prev) * rate
        prev = top
    return tax


def parse_brackets(text):
    firsts = [money(x) for x in re.findall(r"Not over \$([\d,]+) 10% of the taxable income", text)]
    mids = [(money(a), money(b), money(base), int(r) / 100) for a, b, base, r, _ in
            re.findall(r"Over \$([\d,]+) but not over \$([\d,]+) \$([\d,]+(?:\.\d+)?) plus (\d+)% of the excess over \$([\d,]+)", text)]
    tops = [(money(a), money(base)) for a, base in re.findall(r"Over \$([\d,]+) \$([\d,]+(?:\.\d+)?) plus 37% of the excess over", text)]
    if len(set(firsts)) < 3:
        raise ValueError(f"could not find the bracket tables (10% thresholds found: {firsts})")

    def chains_from(first):
        """Every way to chain brackets 10% -> 37% starting at `first`; each step keeps the IRS base tax it printed."""
        out = []
        def walk(chain, bases, lower, i):
            if i == 6:  # 37% bracket
                for a, base in tops:
                    if abs(a - lower) < 0.5:
                        out.append((chain + [[None, 0.37]], bases + [(lower, base)]))
                return
            for a, b, base, rate in mids:
                if abs(a - lower) < 0.5 and abs(rate - RATES[i]) < 1e-9:
                    walk(chain + [[b, rate]], bases + [(a, base)], b, i + 1)
        walk([[first, 0.10]], [], first, 1)
        return out

    # Keep only chains whose every printed base tax matches our own calculation (to the dollar).
    chains = []
    for f in sorted(set(firsts)):
        for c, bases in chains_from(f):
            if all(abs(tax_at(c, lower) - base) <= 1.0 for lower, base in bases) and c not in chains:
                chains.append(c)
    if len(chains) != 4:
        raise ValueError(f"expected 4 verified bracket tables, found {len(chains)}")

    by_first = sorted(chains, key=lambda c: c[0][0])
    mfj = max(chains, key=lambda c: c[0][0])
    hoh = [c for c in chains if c is not mfj and c[0][0] != by_first[0][0][0]]
    low = [c for c in chains if c[0][0] == by_first[0][0][0]]
    if len(hoh) != 1 or len(low) != 2:
        raise ValueError(f"unexpected bracket structure: {len(chains)} chains")
    # married-separate brackets are half of married-joint: its 35% bracket tops out at half of MFJ's
    half = mfj[5][0] / 2
    mfs = min(low, key=lambda c: abs(c[5][0] - half))
    single = [c for c in low if c is not mfs][0]
    if abs(mfs[5][0] - half) > 50:
        raise ValueError("could not tell single and married-separate apart")
    out = {"single": single, "married_joint": mfj, "married_separate": mfs, "head_household": hoh[0]}
    for s, c in out.items():
        if [r for _, r in c] != RATES:
            raise ValueError(f"{s}: unexpected rates")
        ups = [u for u, _ in c[:-1]]
        if ups != sorted(ups):
            raise ValueError(f"{s}: thresholds not increasing")
        out[s] = [[int(u) if u is not None else None, r] for u, r in c]
    return out


def parse_standard_deduction(text, year):
    i = text.find(f"For taxable years beginning in {year}, the standard deduction amounts")
    if i < 0:
        raise ValueError("standard deduction section not found")
    seg = text[i:i + 1200]
    def amt(label):
        m = re.search(label + r"[^$]{0,80}\$([\d,]+)", seg)
        if not m:
            raise ValueError(f"standard deduction for '{label}' not found")
        return int(money(m.group(1)))
    return {
        "married_joint": amt(r"Married Individuals Filing Joint Returns"),
        "head_household": amt(r"Heads of Households"),
        "single": amt(r"Unmarried Individuals"),
        "married_separate": amt(r"Married Individuals Filing Separate Returns"),
    }


def ssa_wage_base(year):
    try:
        html = fetch("https://www.ssa.gov/oact/cola/cbb.html").decode("utf-8", "ignore")
        txt = re.sub(r"<[^>]+>", " ", html)
        m = re.search(rf"\b{year}\b\s+\$?\s*([\d,]{{6,}})", txt)
        return int(money(m.group(1))) if m else None
    except Exception as e:
        print(f"SSA lookup failed: {e}")
        return None


def build_year(year, pdf_src, prev):
    data = Path(pdf_src).read_bytes() if Path(pdf_src).exists() else fetch(pdf_src)
    text = pdf_text(data)
    if f"taxable years beginning in {year}" not in text:
        raise ValueError(f"PDF is not for tax year {year}")
    brackets = parse_brackets(text)
    std = parse_standard_deduction(text, year)
    for s in STATUSES:
        if prev and not (0.97 <= std[s] / prev["standardDeduction"][s] <= 1.25):
            raise ValueError(f"standard deduction for {s} changed suspiciously: {prev['standardDeduction'][s]} -> {std[s]}")
    table = json.loads(json.dumps(prev)) if prev else {}
    table.update({"source": f"IRS {pdf_src.rsplit('/', 1)[-1]} (auto-imported {datetime.date.today()})", "standardDeduction": std, "brackets": brackets})
    wb = ssa_wage_base(year)
    if wb:
        table.setdefault("fica", {})["socialSecurityWageBase"] = wb
    else:
        table["note"] = f"Social Security wage base and contribution limits carried over from {year - 1}"
    return table


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, help="tax year to fetch (default: next year, then this year)")
    ap.add_argument("--pdf", help="path or URL of the Rev. Proc. PDF (skips the search)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    db = json.loads(DATA.read_text())
    today = datetime.date.today()
    years = [a.year] if a.year else [today.year + 1, today.year]
    changed = False
    for y in years:
        if str(y) in db["years"] and not a.pdf:
            print(f"{y}: already have it")
            continue
        src = a.pdf or find_rev_proc(y)
        if not src:
            print(f"{y}: IRS hasn't published it yet (normal before ~October {y - 1})")
            continue
        prev_year = max([int(k) for k in db["years"] if int(k) < y], default=None)
        table = build_year(y, src, db["years"].get(str(prev_year)) if prev_year else None)
        print(f"{y}: imported from {src}\n" + json.dumps({k: table[k] for k in ("standardDeduction", "brackets")}, indent=1))
        db["years"][str(y)] = table
        changed = True
    if changed and not a.dry_run:
        db["updated"] = str(today)
        DATA.write_text(json.dumps(db, indent=1) + "\n")
        print("tax-tables.json updated")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(2)
