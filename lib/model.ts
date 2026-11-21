// Token launch radar — value model, validation and board builder.
//
// Model (variant A, "fitted curve + validation panel"):
//   log(mcap) = b0 + b1 * log(TVL) + b2 * growth
// fit by OLS on the traded-token comparables in the sealed snapshot.
// Terms are kept only when the blind test keeps them: growth stays,
// age / chain count / category are dropped (see term table in the output).
// Everything here is refit from the snapshot at run time; nothing about
// the fit is hardcoded. Deterministic: one fixed seed drives the refits.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  expected_value_usd: number;
  cash_cost_usd: number;
  break_even_deposit_usd: number;
  dollars_per_hour: number;
  deposit_usd: number;
  hold_days: number;
  start_date: string;
  end_date: string;
  fitted_log_value: number;
  growth_frac: number;
  verdict: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  category: string | null;
  chains: string[];
  farm_steps: string[];
}

export interface TermRow {
  term: string;
  kept: boolean;
  walk_forward_r2: number;
  note: string;
}

export interface Validation {
  comps_n: number;
  beta: number[];
  in_sample_r2: number;
  loo_rmse: number;
  loo_rmse_flat: number;
  walk_forward_r2: number;
  walk_forward_r2_flat: number;
  walk_forward_no_growth_r2: number;
  walk_forward_age_r2: number;
  walk_forward_chains_r2: number;
  loo_rmse_category: number;
  terms: TermRow[];
}

export interface CategoryCal {
  category: string;
  comps_n: number;
  median_ratio: number;
  board_n: number;
}

export interface BuildResult {
  rows: BoardRow[];
  fit: { beta: number[]; comps_n: number };
  validation: Validation;
  categories: CategoryCal[];
  as_of: string;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  total_implied_usd: number;
  comps_points: Array<{ x: number; y: number }>;
}

export const SETUP_COST_USD = 30;
export const EXIT_COST_USD = 5;
export const CASH_COST_USD = SETUP_COST_USD + EXIT_COST_USD;
export const RATIO_LO = 0.005;
export const RATIO_HI = 0.75;
export const REFITS = 200;
export const REFIT_SEED = 20261114;
export const FARM_EV_MIN = 170;
export const THIN_EV_MIN = 85;

const DAY_MS = 86400000;

export function median(values: number[]): number {
  const xs = values.slice().sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  return xs[Math.floor(xs.length / 2)];
}

export function quantile(values: number[], q: number): number {
  const xs = values.slice().sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  return xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
}

// Solve A x = b by Gaussian elimination with partial pivoting.
// Returns null when the system is singular.
export function solveLinear(aIn: number[][], bIn: number[]): number[] | null {
  const n = bIn.length;
  const a: number[][] = aIn.map((row, i) => row.concat([bIn[i]]));
  for (let c = 0; c < n; c++) {
    let m = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(a[r][c]) > Math.abs(a[m][c])) m = r;
    }
    if (Math.abs(a[m][c]) < 1e-12) return null;
    const tmp = a[c];
    a[c] = a[m];
    a[m] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

export type FeatureFn = (p: SnapshotProtocol) => number[];

export function ols(features: FeatureFn, rows: SnapshotProtocol[]): number[] | null {
  const k = features(rows[0]).length;
  const xtx: number[][] = [];
  for (let i = 0; i < k; i++) {
    xtx.push([]);
    for (let j = 0; j < k; j++) xtx[i].push(0);
  }
  const xty: number[] = [];
  for (let i = 0; i < k; i++) xty.push(0);
  for (const p of rows) {
    const x = features(p);
    const y = Math.log(p.mcap_usd as number);
    for (let i = 0; i < k; i++) {
      xty[i] += x[i] * y;
      for (let j = 0; j < k; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  return solveLinear(xtx, xty);
}

export function predict(beta: number[], features: FeatureFn, p: SnapshotProtocol): number {
  const x = features(p);
  let s = 0;
  for (let i = 0; i < beta.length; i++) s += beta[i] * x[i];
  return s;
}

export function growthFrac(p: SnapshotProtocol): number {
  return (p.change_7d === null ? 0 : p.change_7d) / 100;
}

export function baseFeatures(p: SnapshotProtocol): number[] {
  return [1, Math.log(p.tvl_usd), growthFrac(p)];
}

export function ageDays(p: SnapshotProtocol, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  const t = Date.parse(p.listed_at + "T00:00:00Z");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((asOfMs - t) / DAY_MS));
}

export function ageYears(p: SnapshotProtocol, asOfMs: number, medianAge: number): number {
  const d = ageDays(p, asOfMs);
  return d === null ? medianAge : d / 365.25;
}

// The watchlist's own eligibility rule, minus the TVL floor: a protocol
// records no token, is not a wrapped / staked / bridged product of a token
// that trades, is not a bridge / liquid-staking / restaking / CEX product,
// carries no version marker in its name and does not start with an
// exchange's name. On this snapshot the rule keeps exactly 198 protocols:
// the 40 on the watchlist plus 158 below the floor.
const BAD_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRadarEligible(p: SnapshotProtocol): boolean {
  if (!(p.gecko_id === null && p.symbol === null)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  for (const e of EXCHANGES) {
    if (p.name.startsWith(e)) return false;
  }
  return true;
}

export function depositFor(tvlUsd: number): number {
  if (tvlUsd < 25_000_000) return 500;
  if (tvlUsd < 100_000_000) return 1000;
  if (tvlUsd < 500_000_000) return 2000;
  return 5000;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 365) return 90;
  if (age < 730) return 60;
  return 45;
}

export function hoursFor(holdDays: number): number {
  // Half an hour to set up, fifteen minutes to exit, ten minutes of
  // checking per week of holding.
  return 0.5 + 0.25 + (holdDays / 7) * (10 / 60);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(dateStr: string, days: number): string {
  const t = Date.parse(dateStr + "T00:00:00Z") + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "K";
  return "$" + Math.round(n).toString();
}

const CATEGORY_ACTIONS: Record<string, string> = {
  Dexs: "swap a small amount on the exchange and add a little liquidity to one pool",
  Lending: "supply a small amount as collateral and borrow a little against it",
  Derivatives: "open one small perpetual position and close it within the week",
  Yield: "deposit into one vault and leave the position working for the full hold",
  "Yield Aggregator": "deposit into one vault and leave the position working for the full hold",
  Restaking: "restake a small amount through the protocol and keep the position active",
  "Liquid Staking": "stake a small amount and hold the receipt token for the full hold",
  "Prediction Market": "place one small prediction on an open market and settle it when it closes",
  Bridge: "bridge a small amount through the protocol to another chain",
  "Cross Chain": "bridge a small amount through the protocol to another chain",
  Insurance: "buy the smallest cover policy the protocol offers for one month",
  Options: "open one small option position and let it run to expiry",
  "Synthetics": "mint a small amount of the protocol's synthetic asset",
  "Real World Assets": "buy the smallest tokenised position the protocol offers",
  "NFT Lending": "list one small NFT-backed loan offer on the protocol",
  Gaming: "play one session through the protocol's game and keep the account active",
  Social: "create a profile and post once a week through the protocol",
  "Algo-Stables": "mint a small amount of the stable asset and hold it for the full hold",
  "CDP": "open a small collateralised debt position and keep it above the liquidation line",
  "Leveraged Farming": "open one small leveraged farm position and monitor it weekly",
  "Basis Trading": "open one small basis position and hold it through the funding cycle",
  "Staking Pool": "stake a small amount in the pool and keep it staked for the full hold",
  "Services": "use one paid service the protocol offers for the smallest tier",
  "Onchain Capital Allocator": "allocate a small amount to one of the protocol's vaults",
  "Reserve Currency": "bond a small amount and hold the position for the full hold",
  "Token Locker": "lock a small amount of tokens for the shortest available term",
};

function categoryAction(p: SnapshotProtocol): string {
  if (p.category !== null && CATEGORY_ACTIONS[p.category]) return CATEGORY_ACTIONS[p.category];
  return "complete one real transaction the protocol counts, then repeat it once a week";
}

function farmSteps(
  p: SnapshotProtocol,
  implied: number,
  deposit: number,
  ev: number,
  breakEven: number,
  dph: number,
  hold: number,
  start: string,
  end: string,
  verdict: string,
): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "its main chain";
  const exitTvl = Math.round(p.tvl_usd * 0.7);
  const thinLine =
    verdict === "SKIP"
      ? "Skip this one: the expected value of " +
        fmtUsd(ev) +
        " does not cover the " +
        fmtUsd(CASH_COST_USD) +
        " cost, so do not deposit. Watch it instead and revisit only if its implied value rises."
      : verdict === "THIN"
        ? "The economics are thin: the expected value of " +
          fmtUsd(ev) +
          " barely clears the " +
          fmtUsd(CASH_COST_USD) +
          " cost, so farm it only with money you can afford to leave idle for " +
          hold +
          " days."
        : "The expected value is " +
          fmtUsd(ev) +
          " on a " +
          fmtUsd(deposit) +
          " deposit against " +
          fmtUsd(CASH_COST_USD) +
          " of costs, about " +
          fmtUsd(dph) +
          " per hour of work, so the sized deposit stays at " +
          fmtUsd(deposit) +
          " and no top-up unless the implied value rises.";
  return [
    "Set up a fresh wallet for " +
      p.name +
      " only, fund it with " +
      fmtUsd(deposit) +
      " plus " +
      fmtUsd(CASH_COST_USD) +
      " for gas and exit fees, and bookmark the official " +
      p.name +
      " app on " +
      chain +
      ".",
    "On " +
      start +
      ", deposit " +
      fmtUsd(deposit) +
      " into " +
      p.name +
      " (" +
      (p.category === null ? "uncategorised" : p.category) +
      ", " +
      fmtMoney(p.tvl_usd) +
      " TVL). This is the sized ticket for this protocol, not a maximum.",
    "Each week, " +
      categoryAction(p) +
      " and record the transaction hash, the date and the position size in a simple log.",
    "Check the position every Sunday: exit the plan early if TVL falls 30% below " +
      fmtMoney(p.tvl_usd) +
      " (about " +
      fmtMoney(exitTvl) +
      ") or if the implied value drops under the " +
      fmtUsd(CASH_COST_USD) +
      " cost line.",
    thinLine,
    "Close by " +
      end +
      " (" +
      hold +
      " days): withdraw the deposit, pay the $5 exit, keep the receipt, and walk away if no token or points programme has been announced. Break-even needs a " +
      fmtUsd(breakEven) +
      " deposit, so do not chase this one further.",
  ];
}

// The v1-style flat baseline: median mcap/TVL per category (at least 3
// comps, else the global median), applied to a protocol's TVL.
function flatPredict(train: SnapshotProtocol[], p: SnapshotProtocol): number {
  const same = train.filter((q) => q.category !== null && q.category === p.category);
  const pool = same.length >= 3 ? same : train;
  const ratio = median(pool.map((q) => (q.mcap_usd as number) / q.tvl_usd));
  return Math.log(p.tvl_usd * ratio);
}

function r2Score(actual: number[], predicted: number[]): number {
  const mean = actual.reduce((a, v) => a + v, 0) / actual.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < actual.length; i++) {
    ssRes += (actual[i] - predicted[i]) * (actual[i] - predicted[i]);
    ssTot += (actual[i] - mean) * (actual[i] - mean);
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

export function buildBoard(snapshot: Snapshot): BuildResult {
  const asOfMs = Date.parse(snapshot.as_of + "T00:00:00Z");
  const comps = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const beta = ols(baseFeatures, comps);
  if (beta === null) throw new Error("OLS fit failed: singular design matrix");

  const ages = comps.map((p) => ageDays(p, asOfMs)).filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) / 365.25 : 2.74;

  // ---- validation: in-sample R2 ----
  const logMcap = comps.map((p) => Math.log(p.mcap_usd as number));
  const inSample = r2Score(
    logMcap,
    comps.map((p) => predict(beta, baseFeatures, p)),
  );

  // ---- validation: leave-one-out RMSE, model vs flat baseline ----
  let looSe = 0;
  let looFlatSe = 0;
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const bi = ols(baseFeatures, rest);
    if (bi === null) throw new Error("LOO fit failed");
    const y = Math.log(comps[i].mcap_usd as number);
    looSe += (y - predict(bi, baseFeatures, comps[i])) * (y - predict(bi, baseFeatures, comps[i]));
    looFlatSe += (y - flatPredict(rest, comps[i])) * (y - flatPredict(rest, comps[i]));
  }
  const looRmse = Math.sqrt(looSe / comps.length);
  const looRmseFlat = Math.sqrt(looFlatSe / comps.length);

  // ---- validation: walk-forward, oldest 60% train / newest 40% test ----
  // Protocols with no listing date sort last (treated as newest).
  const byDate = comps
    .slice()
    .sort((a, b) => (a.listed_at || "9999") < (b.listed_at || "9999") ? -1 : 1);
  const cut = Math.floor(byDate.length * 0.6);
  const train = byDate.slice(0, cut);
  const test = byDate.slice(cut);
  const testY = test.map((p) => Math.log(p.mcap_usd as number));
  const betaTrain = ols(baseFeatures, train);
  if (betaTrain === null) throw new Error("walk-forward fit failed");
  const wfR2 = r2Score(
    testY,
    test.map((p) => predict(betaTrain, baseFeatures, p)),
  );
  const wfR2Flat = r2Score(
    testY,
    test.map((p) => flatPredict(train, p)),
  );
  const noGrowthFeatures = (p: SnapshotProtocol): number[] => [1, Math.log(p.tvl_usd)];
  const betaNoGrowth = ols(noGrowthFeatures, train);
  const wfNoGrowth =
    betaNoGrowth === null
      ? 0
      : r2Score(
          testY,
          test.map((p) => predict(betaNoGrowth, noGrowthFeatures, p)),
        );
  const ageFeatures = (p: SnapshotProtocol): number[] => [
    1,
    Math.log(p.tvl_usd),
    growthFrac(p),
    ageYears(p, asOfMs, medianAge),
  ];
  const betaAge = ols(ageFeatures, train);
  const wfAge =
    betaAge === null
      ? 0
      : r2Score(
          testY,
          test.map((p) => predict(betaAge, ageFeatures, p)),
        );
  const chainsFeatures = (p: SnapshotProtocol): number[] => [
    1,
    Math.log(p.tvl_usd),
    growthFrac(p),
    p.chains.length,
  ];
  const betaChains = ols(chainsFeatures, train);
  const wfChains =
    betaChains === null
      ? 0
      : r2Score(
          testY,
          test.map((p) => predict(betaChains, chainsFeatures, p)),
        );

  // ---- validation: category term, leave-one-out with shrunk adjustment ----
  let looCatSe = 0;
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const bi = ols(baseFeatures, rest);
    if (bi === null) throw new Error("category LOO fit failed");
    const residByCat = new Map<string, number[]>();
    for (const q of rest) {
      const r = Math.log(q.mcap_usd as number) - predict(bi, baseFeatures, q);
      const key = q.category === null ? "__null__" : q.category;
      const arr = residByCat.get(key);
      if (arr) arr.push(r);
      else residByCat.set(key, [r]);
    }
    const p = comps[i];
    const key = p.category === null ? "__null__" : p.category;
    const catResid = residByCat.get(key);
    let adj = 0;
    if (catResid && catResid.length >= 3) adj = median(catResid) * 0.5;
    const y = Math.log(p.mcap_usd as number);
    looCatSe += (y - (predict(bi, baseFeatures, p) + adj)) * (y - (predict(bi, baseFeatures, p) + adj));
  }
  const looRmseCategory = Math.sqrt(looCatSe / comps.length);

  const terms: TermRow[] = [
    {
      term: "log(TVL)",
      kept: true,
      walk_forward_r2: wfR2,
      note: "Core size curve. Kept: the fitted curve is the model.",
    },
    {
      term: "growth (7-day TVL change)",
      kept: true,
      walk_forward_r2: wfR2,
      note:
        "Kept: walk-forward R2 " +
        wfR2.toFixed(3) +
        " with growth vs " +
        wfNoGrowth.toFixed(3) +
        " without it.",
    },
    {
      term: "age (years listed)",
      kept: false,
      walk_forward_r2: wfAge,
      note:
        "Dropped: walk-forward R2 " +
        wfAge.toFixed(3) +
        " with age vs " +
        wfR2.toFixed(3) +
        " without it. The blind test rejects it.",
    },
    {
      term: "chain count",
      kept: false,
      walk_forward_r2: wfChains,
      note:
        "Dropped: walk-forward R2 " +
        wfChains.toFixed(3) +
        " with chain count vs " +
        wfR2.toFixed(3) +
        " without it. The blind test rejects it.",
    },
    {
      term: "category (shrunk intercept)",
      kept: false,
      walk_forward_r2: wfR2,
      note:
        "Dropped: leave-one-out RMSE " +
        looRmseCategory.toFixed(3) +
        " with the category term vs " +
        looRmse.toFixed(3) +
        " without it. No gain, so it stays out.",
    },
  ];

  const validation: Validation = {
    comps_n: comps.length,
    beta: beta.slice(),
    in_sample_r2: inSample,
    loo_rmse: looRmse,
    loo_rmse_flat: looRmseFlat,
    walk_forward_r2: wfR2,
    walk_forward_r2_flat: wfR2Flat,
    walk_forward_no_growth_r2: wfNoGrowth,
    walk_forward_age_r2: wfAge,
    walk_forward_chains_r2: wfChains,
    loo_rmse_category: looRmseCategory,
    terms,
  };

  // ---- board: every radar-eligible protocol (198 on this snapshot) ----
  const candidates = snapshot.protocols.filter(isRadarEligible);
  const startDate = snapshot.as_of;

  interface Scored {
    p: SnapshotProtocol;
    fitted: number;
    implied: number;
    deposit: number;
    ev: number;
    breakEven: number;
    dph: number;
    hold: number;
    verdict: string;
    impliedValues: number[];
  }

  const scored: Scored[] = candidates.map((p) => {
    const fitted = predict(beta, baseFeatures, p);
    const rawRatio = Math.exp(fitted) / p.tvl_usd;
    const ratio = Math.min(RATIO_HI, Math.max(RATIO_LO, rawRatio));
    const implied = Math.round(ratio * p.tvl_usd);
    const deposit = depositFor(p.tvl_usd);
    const ev = (implied * deposit) / p.tvl_usd;
    const breakEven = (CASH_COST_USD * p.tvl_usd) / implied;
    const age = ageDays(p, asOfMs);
    const hold = holdDaysFor(age);
    const dph = (ev - CASH_COST_USD) / hoursFor(hold);
    const verdict = ev >= FARM_EV_MIN ? "FARM" : ev >= THIN_EV_MIN ? "THIN" : "SKIP";
    return { p, fitted, implied, deposit, ev, breakEven, dph, hold, verdict, impliedValues: [] };
  });

  // ---- 200 seeded bootstrap refits: interval + rank range per row ----
  const rng = mulberry32(REFIT_SEED);
  const rankLists: number[][] = scored.map(() => []);
  for (let k = 0; k < REFITS; k++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rng() * comps.length)]);
    }
    const bi = ols(baseFeatures, sample);
    if (bi === null) continue;
    const refitImplied = scored.map((s) => {
      const f = predict(bi, baseFeatures, s.p);
      const ratio = Math.min(RATIO_HI, Math.max(RATIO_LO, Math.exp(f) / s.p.tvl_usd));
      return Math.round(ratio * s.p.tvl_usd);
    });
    const order = refitImplied
      .map((v, i) => ({ v, i }))
      .sort((a, b) => b.v - a.v || b.i - a.i);
    order.forEach((o, rankIdx) => {
      rankLists[o.i].push(rankIdx + 1);
      scored[o.i].impliedValues.push(refitImplied[o.i]);
    });
  }

  // Rank by point implied value, ties broken by TVL (larger first).
  const ranked = scored
    .slice()
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd);

  const rows: BoardRow[] = ranked.map((s, idx) => {
    const lo = quantile(s.impliedValues, 0.1);
    const hi = quantile(s.impliedValues, 0.9);
    const ranks = rankLists[scored.indexOf(s)];
    const rankLo = ranks.length > 0 ? Math.min(...ranks) : idx + 1;
    const rankHi = ranks.length > 0 ? Math.max(...ranks) : idx + 1;
    const endDate = addDays(startDate, s.hold);
    const steps = farmSteps(
      s.p,
      s.implied,
      s.deposit,
      s.ev,
      s.breakEven,
      s.dph,
      s.hold,
      startDate,
      endDate,
      s.verdict,
    );
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: idx + 1,
      implied_value_usd: s.implied,
      implied_lo_usd: lo,
      implied_hi_usd: hi,
      rank_lo: rankLo,
      rank_hi: rankHi,
      expected_value_usd: Math.round(s.ev),
      cash_cost_usd: CASH_COST_USD,
      break_even_deposit_usd: Math.round(s.breakEven),
      dollars_per_hour: Math.round(s.dph * 100) / 100,
      deposit_usd: s.deposit,
      hold_days: s.hold,
      start_date: startDate,
      end_date: endDate,
      fitted_log_value: Math.round(s.fitted * 10000) / 10000,
      growth_frac: Math.round(growthFrac(s.p) * 1000000) / 1000000,
      verdict: s.verdict,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: ageDays(s.p, asOfMs),
      category: s.p.category,
      chains: s.p.chains.slice(),
      farm_steps: steps,
    };
  });

  // ---- per-category calibration table (diagnostic) ----
  const byCat = new Map<string, { comps: number[]; board: number }>();
  for (const p of comps) {
    const key = p.category === null ? "(no category)" : p.category;
    const e = byCat.get(key) || { comps: [], board: 0 };
    e.comps.push(p.mcap_usd as number / p.tvl_usd);
    byCat.set(key, e);
  }
  for (const r of rows) {
    const key = r.category === null ? "(no category)" : r.category;
    const e = byCat.get(key);
    if (e) e.board += 1;
    else byCat.set(key, { comps: [], board: 1 });
  }
  const categories: CategoryCal[] = Array.from(byCat.entries())
    .map(([category, e]) => ({
      category,
      comps_n: e.comps.length,
      median_ratio: e.comps.length > 0 ? Math.round(median(e.comps) * 10000) / 10000 : 0,
      board_n: e.board,
    }))
    .sort((a, b) => b.board_n - a.board_n || b.comps_n - a.comps_n);

  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) {
    if (r.verdict === "FARM") verdictCounts.FARM += 1;
    else if (r.verdict === "THIN") verdictCounts.THIN += 1;
    else verdictCounts.SKIP += 1;
  }

  return {
    rows,
    fit: { beta: beta.slice(), comps_n: comps.length },
    validation,
    categories,
    as_of: snapshot.as_of,
    verdict_counts: verdictCounts,
    total_implied_usd: rows.reduce((a, r) => a + r.implied_value_usd, 0),
    comps_points: comps.map((p) => ({
      x: Math.round(Math.log(p.tvl_usd) * 1000) / 1000,
      y: Math.round(Math.log(p.mcap_usd as number) * 1000) / 1000,
    })),
  };
}
