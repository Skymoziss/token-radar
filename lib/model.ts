// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, version 'radar-2':
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent; growthMult = 1 + sqrtCurve(growth, weight)
//                (a sqrt curve: one strong week cannot outrank four steady ones)
//   relative   = tvl_usd against the median TVL of the protocol's category (pre-token only), log2
//                scaled and floored at -1: category_rel_mult = clamp(1 + rel_weight x log2ratio, 0.65, 2)
//   scarcity   = years listed with no token, log2 curve capped at scarcity_days:
//                scarcity_mult = 1 + scarcity_weight x log2(1 + min(age, cap) / 365)
//   chains     = 1 + chain_weight x min(unique chains, chain_cap)
//   implied    = max(1, round(base x growthMult x categoryRelMult x scarcityMult x chainMult))
//
// The constants are the house model's, stated in the dashboard. No protocol name is ever special-cased:
// the same function scores every row, and every output is deterministic.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  rel_weight: number;
  scarcity_weight: number;
  scarcity_days: number;
  chain_weight: number;
  chain_cap: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  // TVL x 0.25 is the base: a protocol's locked capital is the best single proxy for its future token.
  base_multiple: 0.25,
  // Growth on a sqrt curve: a doubling of |change_7d| adds less than twice the boost, so one strong
  // week cannot outrank four steady ones. Capped at the same -60..120 window as radar-1.
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  // Category normalization: TVL compared against the median TVL of its category (pre-token only), on a
  // log2 scale, half-strength at 2x the median and full boost at 4x, floored at -1 for half coverage.
  rel_weight: 0.35,
  // Scarcity: years running with no token on a log curve, capped at scarcity_days; a protocol that
  // has farmed attention for years without a token has the most accumulated airdrop debt.
  scarcity_weight: 0.4,
  scarcity_days: 1460,
  // Chain diversity: each additional major chain (capped) is a broader farming surface.
  chain_weight: 0.05,
  chain_cap: 6,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    category_multiplier: number;
    category_median_tvl: number | null;
    scarcity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  why: string;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  category_multiplier: number;
  category_median_tvl: number | null;
  scarcity_multiplier: number;
  chain_multiplier: number;
  why: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, categoryMedians?: Map<string, number>): { implied: number; growthPct: number; growthMult: number; categoryMult: number; scarcityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // sqrt curve: signed sqrt of the magnitude keeps the reward sub-linear.
  const growthMult = 1 + Math.sign(growthPct) * Math.sqrt(Math.abs(growthPct) / 100) * model.growth_weight;
  // Category normalization: how far above or below its category's median TVL this protocol sits.
  const median = categoryMedians?.get(protocol.category ?? '') ?? null;
  const log2ratio = median !== null && median > 0 && protocol.tvl_usd > 0 ? Math.log2(protocol.tvl_usd / median) : 0;
  const categoryMult = Math.min(2, Math.max(0.65, 1 + model.rel_weight * log2ratio));
  // Scarcity: log curve on days listed with no token, capped.
  const ageForModel = age ?? model.unknown_age_days;
  const scarcityMult = 1 + model.scarcity_weight * Math.log2(1 + Math.min(Math.max(ageForModel, 0), model.scarcity_days) / 365);
  // Chain diversity: each additional unique chain is a broader farming surface, capped.
  const chainMult = 1 + model.chain_weight * Math.min(protocol.chains.length, model.chain_cap);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * categoryMult * scarcityMult * chainMult));
  return { implied, growthPct, growthMult, categoryMult, scarcityMult, chainMult, age };
}

/** Median TVL per category across the snapshot's pre-token protocols, for category normalization. */
export function categoryMediansOf(snapshot: Snapshot): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const key = p.category ?? '';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [p.tvl_usd]);
    else list.push(p.tvl_usd);
  }
  const medians = new Map<string, number>();
  for (const [key, list] of byCategory) {
    const sorted = list.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    medians.set(key, median);
  }
  return medians;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const medians = categoryMediansOf(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, categoryMult, scarcityMult, chainMult, age } = impliedValue(p, snapshot.as_of, model, medians);
    return { p, implied, growthPct, growthMult, categoryMult, scarcityMult, chainMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      category_multiplier: round4(s.categoryMult),
      category_median_tvl: medians.get(s.p.category ?? '') ?? null,
      scarcity_multiplier: round4(s.scarcityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    why: whyLine(s.p, s.implied, s.growthPct, s.categoryMult, s.scarcityMult, s.age),
  }));
}

/**
 * The 'Why ranked here' one-liner: every clause comes from the row's own figures — its TVL, its growth,
 * its category median, its age and its chains. No name lookup, fully deterministic.
 */
function whyLine(p: SnapshotProtocol, implied: number, growthPct: number, categoryMult: number, scarcityMult: number, age: number | null): string {
  const parts: string[] = [];
  parts.push(`$${fmtCompact(p.tvl_usd)} of TVL makes $${fmtCompact(implied)} of implied value at ${MODEL.base_multiple}x`);
  if (growthPct > 5) parts.push(`seven-day growth of +${growthPct.toFixed(1)}% adds momentum`);
  else if (growthPct < -5) parts.push(`seven-day growth of ${growthPct.toFixed(1)}% costs momentum`);
  const rel = categoryMult > 1.05 ? `above` : categoryMult < 0.95 ? `below` : `near`;
  parts.push(`TVL ${rel} its category's median (x${categoryMult.toFixed(2)})`);
  if (age !== null && age >= 365) parts.push(`${Math.floor(age / 365)}y listed with no token (x${scarcityMult.toFixed(2)} scarcity)`);
  else parts.push(`listed ${age === null ? 'for an unknown span' : `${age}d`} (x${scarcityMult.toFixed(2)} scarcity)`);
  if (p.chains.length >= 2) parts.push(`live on ${p.chains.length} chains (x${MODEL.chain_weight * Math.min(p.chains.length, MODEL.chain_cap) + 1} chain surface)`);
  return parts.join('; ') + '.';
}

const fmtCompact = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * A realistic first-transaction and weekly gas estimate for a chain, from the chain family the chain
 * name puts it in. Derived from the record, never from a name lookup of the protocol.
 */
function gasFor(chain: string): { first: string; weekly: string; note: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum' || c === 'ethereum classic') return { first: 'about $6 of Ethereum mainnet gas', weekly: '$4-8 of mainnet gas a week', note: 'batch weekly actions into one transaction on Ethereum mainnet to keep gas down' };
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('polygon') || c.includes('scroll') || c.includes('linea') || c.includes('zksync') || c.includes('zk') || c.includes('mantle') || c.includes('blast')) return { first: 'about $0.20 of L2 gas', weekly: 'under $1 of L2 gas a week', note: 'the L2 rollup keeps gas low, so weekly actions are cheap' };
  if (c.includes('solana')) return { first: 'under $0.05 of Solana fees', weekly: 'a few cents of Solana fees a week', note: 'Solana fees are negligible, so interact as often as the program rewards' };
  if (c.includes('avalanche')) return { first: 'about $0.30 of Avalanche gas', weekly: 'under $1 of gas a week', note: 'Avalanche gas is low but the C-Chain spikes, batch actions' };
  if (c.includes('bsc') || c.includes('binance')) return { first: 'about $0.30 of BSC gas', weekly: 'under $1 of gas a week', note: 'BSC gas is cheap, weekly interactions cost little' };
  if (c.includes('sui') || c.includes('aptos') || c.includes('ton') || c.includes('near') || c.includes('cosmos') || c.includes('celo') || c.includes('cardano') || c.includes('algorand') || c.includes('stellar') || c.includes('tron')) return { first: 'a few cents of gas', weekly: 'pocket change in gas a week', note: 'the chain keeps fees near zero, so frequency matters more than batching' };
  return { first: 'under $1 of gas', weekly: 'under $2 of gas a week', note: 'check the chain gas before each action and batch when it spikes' };
}

/** How much capital one farm position needs, from the protocol's own TVL: bigger rooms take bigger checks. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's opening action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad') || c.includes('nft')) return `Use $${capital} on ${name} on ${chain} for one participation and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action, concrete enough to schedule: what to do, on which chain, and why it counts. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Each week on ${name} on ${chain}: toggle the deposit off and on, or borrow and repay a small amount, so the wallet shows repeatable supply-and-borrow activity.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Each week on ${name} on ${chain}: rebalance the position by withdrawing half and re-adding it, and make one swap through the pool, so both LP and swap volume are logged.`;
  if (c.includes('bridge')) return `Each week: bridge a small amount through ${name} in each direction the app supports, so the wallet's bridge history shows repeated usage of more than one route.`;
  if (c.includes('staking') || c.includes('restak')) return `Each week on ${name} on ${chain}: top the stake up by a small amount and, if it offers them, claim and restake the rewards so the receipt history grows.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Each week on ${name} on ${chain}: open and close one small position on each side, long then short, so trading volume accrues on the account.`;
  if (c.includes('prediction')) return `Each week: place one small market on ${name} and resolve or roll it, so the account shows repeated forecasting activity.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager')) return `Each week on ${name} on ${chain}: move the deposit between two of its vaults once, so allocation activity is logged on both vaults.`;
  if (c.includes('stable')) return `Each week on ${name} on ${chain}: mint, then redeem, a small amount of the stable asset, so both sides of the mechanism appear in the history.`;
  if (c.includes('rwa')) return `Each week on ${name} on ${chain}: hold the tokenized asset and make one small purchase or transfer, so the wallet's holding history is continuous.`;
  if (c.includes('insurance')) return `Each week on ${name} on ${chain}: renew or extend a small cover policy, so the account shows repeated coverage rather than a one-off buy.`;
  if (c.includes('launchpad') || c.includes('nft')) return `Each week on ${name} on ${chain}: make one participation or small trade, so the account accrues usage volume rather than a single event.`;
  return `Each week on ${name} on ${chain}: make one deposit, swap or interaction, varying the action so the history shows repeatable, varied usage.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyFor(p, chain);
  const chains = p.chains.length > 1 ? ` The protocol also runs on ${p.chains.slice(1).slice(0, 3).join(', ')}, so a second wallet can farm the same program there.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. First gas on ${chain}: ${gas.first}.`,
      cost: gas.first,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas.first}`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `${gas.weekly} (${gas.note})`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.${chains}`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    category_multiplier: row.model.category_multiplier,
    category_median_tvl: row.model.category_median_tvl,
    scarcity_multiplier: row.model.scarcity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    why: row.why,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
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
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
