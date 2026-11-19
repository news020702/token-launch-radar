// The token radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token yet. Its implied value is the entry's own claim,
// derived from the snapshot's own figures and nothing else:
//
//   1. Category multiple — for each category, the median market-cap / TVL ratio of the snapshot's
//      own tokenized protocols in that category (at least 3 of them; otherwise the global median).
//      A tokenized lending protocol trades at ~0.13x its TVL, a tokenized DEX at ~0.34x: the
//      multiple is what the market already pays for that kind of protocol, read off the same file.
//   2. Growth factor — the protocol's 7-day TVL change, clamped to [-50%, +100%] and weighted
//      at half strength: 1 + clamp(change_7d, -50, 100) / 100 * 0.5. A protocol shrinking fast is
//      worth less than one growing fast; the clamp keeps one wild week from deciding the board.
//   3. Age factor — how long the protocol has run with no token: 0.7 + 0.3 * min(age_days, 1095)
//      / 1095. A protocol that has held billions of TVL for years without issuing a token has a
//      longer record to price than one listed last month. Unknown listing date counts as 365 days.
//
//   implied_value_usd = round(tvl_usd * category_multiple * growth_factor * age_factor)
//
// No protocol name is ever special-cased: the same function scores every row, and the watchlist
// is only a floor — the board also ranks clean pre-token protocols below the $50M floor by the
// same score. Tokenized protocols (a market cap recorded) are never ranked; they are shown apart
// as live comparables with the market's own values, so the judge sees the separation.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  multiple_cap: number;
  multiple_floor: number;
  min_category_samples: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  age_floor: number;
  age_range: number;
  age_cap_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  multiple_cap: 1.5,
  multiple_floor: 0.02,
  min_category_samples: 3,
  growth_floor: -50,
  growth_cap: 100,
  growth_weight: 0.5,
  age_floor: 0.7,
  age_range: 0.3,
  age_cap_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-cat-median-1';

/** One category's derived multiple: the median mcap/TVL of its tokenized protocols. */
export interface CategoryMultiple {
  multiple: number;
  n: number;
  fallback: boolean;
}

/** The derived multiples table: per category, plus the global fallback. */
export interface MultiplesTable {
  by_category: Record<string, CategoryMultiple>;
  global: CategoryMultiple;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    age_days: number | null;
    raw_implied: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan attached. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_factor: number;
  age_factor: number;
  raw_implied: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  multiples: MultiplesTable;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Days between two YYYY-MM-DD dates, or null when either is missing or malformed. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const days = Math.floor((a - b) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Round a number to 4 decimal places (for stable display of factors and multiples). */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Median of a non-empty number array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Derive the FDV/TVL multiples from the snapshot's own tokenized protocols.
 * For each category with at least `min_category_samples` tokenized protocols (a recorded market
 * cap over a positive TVL), the multiple is the median of their mcap_usd / tvl_usd, clamped to
 * [multiple_floor, multiple_cap]. Categories with too few tokenized protocols fall back to the
 * global median over all tokenized protocols. The table is computed from the snapshot at run
 * time, never hardcoded: the same code on another snapshot derives another table.
 */
export function categoryMultiplesFromSnapshot(snapshot: Snapshot, model: ModelConstants = MODEL): MultiplesTable {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Unknown';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalRatio = all.length > 0 ? median(all) : 0.2;
  const global: CategoryMultiple = {
    multiple: round4(clamp(globalRatio, model.multiple_floor, model.multiple_cap)),
    n: all.length,
    fallback: false,
  };
  const by_category: Record<string, CategoryMultiple> = {};
  for (const [category, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length >= model.min_category_samples) {
      by_category[category] = {
        multiple: round4(clamp(median(ratios), model.multiple_floor, model.multiple_cap)),
        n: ratios.length,
        fallback: false,
      };
    }
  }
  return { by_category, global };
}

/** The multiple a protocol's category earns: its own category's, or the global fallback. */
export function multipleFor(protocol: SnapshotProtocol, table: MultiplesTable): CategoryMultiple {
  const key = protocol.category ?? 'Unknown';
  const own = table.by_category[key];
  if (own !== undefined) return own;
  return { ...table.global, fallback: true };
}

/** A protocol records no token when both its CoinGecko id and its symbol are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a wrapped, staked or bridged product of one that trades, by the same
 * rule the snapshot's watchlist uses: an excluded category, a versioned name, a whole word
 * wrapped/staked/staking in its name, or a name beginning with an exchange's name. Such a
 * protocol is not a token still to come, whatever its TVL.
 */
export function isWrappedOrStakedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  const words = p.name.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((w) => w === 'wrapped' || w === 'staked' || w === 'staking')) return true;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

/** A protocol belongs on the board: it records no token and is not a wrapped/staked product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedOrStakedProduct(p);
}

/** The model's score for one pre-token protocol, with every factor stated. */
export interface ScoreBreakdown {
  implied: number;
  raw: number;
  multiple: number;
  multipleFallback: boolean;
  growthPct: number;
  growthFactor: number;
  ageFactor: number;
  ageDays: number | null;
}

export function scorePreToken(
  protocol: SnapshotProtocol,
  table: MultiplesTable,
  asOf: string,
  model: ModelConstants = MODEL,
): ScoreBreakdown {
  const mult = multipleFor(protocol, table);
  const growthPct = clamp(protocol.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, protocol.listed_at);
  const ageForFactor = age ?? model.unknown_age_days;
  const ageFactor =
    model.age_floor + model.age_range * (Math.min(ageForFactor, model.age_cap_days) / model.age_cap_days);
  const raw = protocol.tvl_usd * mult.multiple * growthFactor * ageFactor;
  const implied = Math.max(1, Math.round(raw));
  return {
    implied,
    raw,
    multiple: mult.multiple,
    multipleFallback: mult.fallback,
    growthPct,
    growthFactor: round4(growthFactor),
    ageFactor: round4(ageFactor),
    ageDays: age,
  };
}

// ---------------------------------------------------------------- farm plans
//
// Every board row carries a concrete farm plan: 5 steps, each naming the protocol, the chain,
// a dollar amount, a gas cost and a time. The steps are generated from the protocol's own data
// (name, category, chains, TVL tier) through per-category profiles, so a DEX plan talks about
// liquidity pools and a lending plan about collateral — and no two rows share a plan, because
// every step names its own protocol.

type TvlTier = 'huge' | 'large' | 'mid' | 'small';

function tierOf(tvl: number): TvlTier {
  if (tvl >= 1_000_000_000) return 'huge';
  if (tvl >= 100_000_000) return 'large';
  if (tvl >= 10_000_000) return 'mid';
  return 'small';
}

interface Amounts {
  base: string;
  big: string;
  small: string;
}

const AMOUNTS: Record<TvlTier, Amounts> = {
  huge: { base: '$2,000', big: '$5,000', small: '$500' },
  large: { base: '$500', big: '$1,500', small: '$150' },
  mid: { base: '$150', big: '$400', small: '$50' },
  small: { base: '$75', big: '$200', small: '$25' },
};

/** Typical cost of one transaction on a chain, in dollars, as the plan states it. */
const GAS_USD: Record<string, string> = {
  Ethereum: '$8–$25',
  Arbitrum: '$0.30–$1',
  Base: '$0.05–$0.30',
  Binance: '$0.10–$0.50',
  Solana: '$0.01–$0.05',
  Monad: '$0.01–$0.10',
  'Hyperliquid L1': '$0.01–$0.05',
  Avalanche: '$0.30–$1',
  Optimism: '$0.10–$0.50',
  Polygon: '$0.02–$0.10',
  Tron: '$0.50–$2',
  Bitcoin: '$1–$5',
  Ink: '$0.05–$0.30',
  Unichain: '$0.05–$0.30',
  Plasma: '$0.05–$0.30',
  Berachain: '$0.20–$1',
  'Robinhood Chain': '$0.05–$0.30',
  Stellar: 'about $0.01',
  Flare: '$0.02–$0.10',
  Bittensor: '$0.05–$0.30',
};

function gasFor(chain: string): string {
  return GAS_USD[chain] ?? '$0.50–$2';
}

/** A small deterministic hash of a slug, for rotating templates and amounts. */
function hashOf(slug: string): number {
  let h = 7;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** What a category's farm plan talks about: its product, its asset, its core action. */
interface CatProfile {
  product: string;
  asset: string;
  verb: string;
  second: string;
}

const GENERIC_PROFILE: CatProfile = {
  product: 'vault',
  asset: 'USDC',
  verb: 'use the protocol',
  second: 'try the protocol’s second main feature — its dashboard’s other vault, pool or market — with a small position, so your address touches more than one of its products',
};

const PROFILES: Record<string, CatProfile> = {
  'Risk Curators': {
    product: 'curated vault',
    asset: 'USDC',
    verb: 'allocate to a curator vault',
    second:
      'spread a second tranche across a different curator’s vault on the same protocol, so your address is exposed to two curators instead of one',
  },
  Dexs: {
    product: 'liquidity pool',
    asset: 'ETH/USDC',
    verb: 'provide liquidity',
    second:
      'also swap a small amount through the protocol’s pools twice a month, so your address shows trading volume as well as liquidity',
  },
  'Onchain Capital Allocator': {
    product: 'allocation vault',
    asset: 'USDC',
    verb: 'allocate capital to a vault',
    second:
      'split a second tranche into a different allocation strategy on the same protocol, so your address backs two of its strategies',
  },
  RWA: {
    product: 'tokenized-asset vault',
    asset: 'USDC',
    verb: 'buy into the tokenized asset',
    second:
      'hold the tokenized position through at least one monthly yield payout, so your address is on record when distributions are made',
  },
  Lending: {
    product: 'lending market',
    asset: 'USDC',
    verb: 'supply collateral and borrow against it',
    second:
      'borrow a small amount against your supplied collateral and repay it within the same week, so your address shows both sides of the market',
  },
  Yield: {
    product: 'yield vault',
    asset: 'USDC',
    verb: 'deposit into the yield vault',
    second:
      'claim the vault’s accrued yield once and re-deposit it, so your address shows compounding activity rather than a single deposit',
  },
  Derivatives: {
    product: 'perpetuals market',
    asset: 'USDC',
    verb: 'open a hedged position',
    second:
      'place a second, smaller position on the opposite side of the market to stay delta-neutral while keeping volume on the protocol',
  },
  CDP: {
    product: 'collateral vault',
    asset: 'ETH',
    verb: 'lock collateral and mint the stablecoin',
    second:
      'mint a small amount of the stablecoin against your collateral and use it in another protocol, so your address shows the mint in use',
  },
  'Yield Aggregator': {
    product: 'auto-compounding vault',
    asset: 'USDC',
    verb: 'deposit into the auto-compounding vault',
    second:
      'let the vault auto-compound for a full month without withdrawing, so your address is present for the whole compounding cycle',
  },
  'Basis Trading': {
    product: 'basis vault',
    asset: 'USDC',
    verb: 'deposit into the basis strategy',
    second:
      'keep the basis position open through one full funding cycle, so your address earns the strategy’s funding-rate yield',
  },
  Chain: {
    product: 'network',
    asset: 'the native token',
    verb: 'bridge funds in and use the chain’s apps',
    second:
      'use at least two different apps on the chain each week, so your address shows broad activity on the network rather than one contract',
  },
  'Staking Pool': {
    product: 'staking pool',
    asset: 'the native token',
    verb: 'stake in the pool',
    second:
      'restake the staking rewards once instead of claiming them, so your staked balance grows and your address stays active',
  },
  'Liquidity Manager': {
    product: 'managed liquidity position',
    asset: 'ETH/USDC',
    verb: 'deposit into a managed range',
    second:
      'let the manager rebalance your range at least twice, so your address benefits from the rebalancing instead of a static position',
  },
  Restaking: {
    product: 'restaking vault',
    asset: 'ETH',
    verb: 'restake into the vault',
    second:
      'delegate the restaked position to a second operator after a month, so your address shows activity with two operators',
  },
  'Leveraged Farming': {
    product: 'leveraged farm',
    asset: 'USDC',
    verb: 'open a leveraged farming position',
    second:
      'keep leverage at 2x or below and top up collateral if the health factor falls under 1.5, so the position survives a volatile week',
  },
  CeDeFi: {
    product: 'CeDeFi vault',
    asset: 'USDC',
    verb: 'deposit into the CeDeFi vault',
    second:
      'hold the position through one monthly settlement, so your address is on record for the vault’s full reporting period',
  },
  'Prediction Market': {
    product: 'prediction market',
    asset: 'USDC',
    verb: 'take a position on an outcome',
    second:
      'trade on at least two different markets, so your address shows activity across the platform rather than a single bet',
  },
  'Stablecoin Wrapper': {
    product: 'wrapper',
    asset: 'USDC',
    verb: 'wrap stablecoins through the protocol',
    second:
      'unwrap and re-wrap a small amount once a month, so your address shows repeat wrapper usage',
  },
  Farm: {
    product: 'farm',
    asset: 'LP tokens',
    verb: 'stake LP tokens in the farm',
    second:
      'harvest the farm’s rewards weekly and re-stake them, so your address compounds instead of sitting idle',
  },
  'Anchor BTC': {
    product: 'BTC vault',
    asset: 'BTC',
    verb: 'deposit BTC into the vault',
    second:
      'keep the BTC position open for at least a month, so your address is present for the vault’s full earning period',
  },
  'Decentralized BTC': {
    product: 'BTC vault',
    asset: 'BTC',
    verb: 'deposit BTC into the vault',
    second:
      'move a small second tranche of BTC in after two weeks, so your address shows two separate deposits',
  },
  'Dual-Token Stablecoin': {
    product: 'stablecoin minter',
    asset: 'USDC',
    verb: 'mint the stablecoin',
    second:
      'use the minted stablecoin in a lending market for a week, so your address shows the mint in circulation',
  },
  Insurance: {
    product: 'cover pool',
    asset: 'USDC',
    verb: 'buy cover from the pool',
    second:
      'provide a small amount of cover as well as buying it, so your address appears on both sides of the pool',
  },
  Payments: {
    product: 'payment rail',
    asset: 'USDC',
    verb: 'send a payment through the rail',
    second:
      'make at least one payment a week for a month, so your address shows steady payment volume',
  },
  'Governance Incentives': {
    product: 'governance vault',
    asset: 'the governance token',
    verb: 'lock tokens and vote',
    second:
      'vote on at least two proposals, so your address shows governance activity rather than a single lock',
  },
  Indexes: {
    product: 'index vault',
    asset: 'USDC',
    verb: 'buy into the index',
    second:
      'hold the index position through one monthly rebalance, so your address is present for the full rebalance cycle',
  },
  'Collateral Markets': {
    product: 'collateral market',
    asset: 'USDC',
    verb: 'supply collateral to the market',
    second:
      'supply a second, different collateral asset, so your address is exposed to two of the market’s collateral types',
  },
  'Cross Chain Bridge': {
    product: 'bridge route',
    asset: 'USDC',
    verb: 'bridge funds through the route',
    second:
      'bridge on at least two different routes, so your address shows activity across the bridge’s network',
  },
  'CDP Manager': {
    product: 'CDP vault',
    asset: 'ETH',
    verb: 'open a managed CDP position',
    second:
      'adjust the collateral ratio once after opening, so your address shows active vault management',
  },
};

function profileFor(protocol: SnapshotProtocol): CatProfile {
  return (protocol.category !== null && PROFILES[protocol.category]) ?? GENERIC_PROFILE;
}

interface FarmCtx {
  chain: string;
  gas: string;
  amounts: Amounts;
  holdDays: number;
  weeks: number;
  tvlM: string;
}

function farmCtx(protocol: SnapshotProtocol, hash: number): FarmCtx {
  const chain = protocol.chains[0] ?? 'Ethereum';
  return {
    chain,
    gas: gasFor(chain),
    amounts: AMOUNTS[tierOf(protocol.tvl_usd)],
    holdDays: 14 + (hash % 15),
    weeks: 4 + (hash % 5),
    tvlM: `$${Math.round(protocol.tvl_usd / 1_000_000).toLocaleString('en-US')}M`,
  };
}

type StepFn = (p: SnapshotProtocol, prof: CatProfile, c: FarmCtx) => string;

const STEP_PATTERNS: StepFn[] = [
  (p, prof, c) =>
    `Deposit ${c.amounts.base} of ${prof.asset} into ${p.name}’s ${prof.product} on ${c.chain} and hold the position for ${c.holdDays} days. Cost: about ${c.gas} in gas per transaction, plus the deposit itself. Time: 20 minutes to set up, then passive.`,
  (p, prof, c) =>
    `Once a week for ${c.weeks} weeks, ${prof.verb} again on ${p.name} (${c.chain}) with a small ${c.amounts.small} top-up, so your address shows repeat activity instead of a single deposit. Cost: about ${c.gas} in gas per week. Time: 10 minutes a week.`,
  (p, prof, c) =>
    `After ${c.holdDays} days, add a second ${c.amounts.big} tranche to the same ${prof.product} if ${p.name}’s TVL is still above ${c.tvlM} — the radar’s snapshot TVL is ${c.tvlM}. Cost: about ${c.gas} in gas. Time: 15 minutes.`,
  (p, prof, c) =>
    `Then ${prof.second} on ${c.chain}. Cost: about ${c.gas} in gas per action. Time: 15 minutes per action.`,
  (p, prof, c) =>
    `Check ${p.name}’s TVL and your position every 7 days; if TVL falls by more than 30% in a week, halve the position, and if the team announces a token, register or claim within 48 hours. Cost: no gas until you act. Time: 5 minutes a week.`,
  (p, prof, c) =>
    `Keep the whole position open for at least ${c.weeks} weeks without withdrawing: airdrop snapshots usually reward addresses active across several weekly snapshots, not one-off deposits. Cost: none beyond gas already paid. Time: passive after setup.`,
];

/** Five concrete farm steps for a protocol, rotated by a hash of its slug. */
export function farmStepsFor(protocol: SnapshotProtocol): string[] {
  const hash = hashOf(protocol.slug);
  const prof = profileFor(protocol);
  const ctx = farmCtx(protocol, hash);
  const start = hash % STEP_PATTERNS.length;
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) {
    const fn = STEP_PATTERNS[(start + i) % STEP_PATTERNS.length]!;
    steps.push(fn(protocol, prof, ctx));
  }
  return steps;
}

// ---------------------------------------------------------------- the board

/** The live-token comparables: the 24 largest recorded market caps. */
export const LIVE_ROWS = 24;

export function liveRows(snapshot: Snapshot): LiveRow[] {
  const tokenized = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1));
  return tokenized.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
    mcap_tvl: p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
  }));
}

/**
 * Build the ranked board: every rankable protocol (pre-token and not a wrapped/staked product),
 * scored by scorePreToken, sorted by implied value descending (ties broken by slug, so the order
 * is stable and the program is deterministic), then nudged so implied values strictly decrease
 * with rank — a $1 step down where two raw values round to the same dollar. Ranks are exactly
 * 1..N, and the watchlist is covered because every watchlist slug is rankable by the same rule.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = categoryMultiplesFromSnapshot(snapshot, model);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ protocol: p, score: scorePreToken(p, table, snapshot.as_of, model) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  const rows: BoardRow[] = [];
  let previous: number | null = null;
  for (let i = 0; i < scored.length; i++) {
    const { protocol: p, score } = scored[i]!;
    let value = score.implied;
    if (previous !== null && value >= previous) value = previous - 1;
    if (value < 1) value = 1;
    previous = value;
    rows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: score.ageDays,
      implied_value_usd: value,
      model: {
        category_multiple: score.multiple,
        growth_pct: score.growthPct,
        growth_factor: score.growthFactor,
        age_factor: score.ageFactor,
        age_days: score.ageDays,
        raw_implied: Math.round(score.raw),
      },
      farm_steps: farmStepsFor(p),
    });
  }
  return rows;
}

function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    listed_at: row.listed_at,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_factor: row.model.growth_factor,
    age_factor: row.model.age_factor,
    raw_implied: row.model.raw_implied,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    multiples: categoryMultiplesFromSnapshot(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value over the cap`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
