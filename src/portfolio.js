// Portfolio layer: several strategy "sleeves" (one coin + one strategy each) combined into one account.
//   1) every sleeve is backtested on its own with the normal engine (next-bar-open execution, fees + slippage)
//   2) sleeve returns are combined with fixed weights (rebalanced daily, no extra cost for that: cash drifts are tiny at 1d)
//   3) optional overlays, all decided with data up to the PREVIOUS close (no look-ahead):
//        - regime filter: stay in cash while the reference coin closes below its N-day average
//        - volatility target: scale the whole book down when its own 30-day volatility is above the target
//      Changes of the overlay scale are charged fee + slippage (conservatively assuming the book is fully invested).
import { runBacktest, computeMetrics, DEFAULT_COSTS } from './backtest.js';
import { sma } from './indicators.js';

const MIN_SCALE_STEP = 0.1; // ignore overlay changes smaller than 10 % (avoids fee churn)

/** Keep only timestamps that every used symbol has, so sleeves line up day by day. */
export function alignBars(barsBySymbol, symbols) {
    const sets = symbols.map((s) => new Set(barsBySymbol[s].map((b) => b.time)));
    const common = barsBySymbol[symbols[0]].map((b) => b.time).filter((t) => sets.every((st) => st.has(t)));
    const keep = new Set(common);
    return Object.fromEntries(symbols.map((s) => [s, barsBySymbol[s].filter((b) => keep.has(b.time))]));
}

function annualVol(rets, end, n, bpy) {
    if (end < n) return null;
    let m = 0;
    for (let i = end - n; i < end; i++) m += rets[i];
    m /= n;
    let v = 0;
    for (let i = end - n; i < end; i++) v += (rets[i] - m) ** 2;
    return Math.sqrt(v / (n - 1)) * Math.sqrt(bpy);
}

/**
 * @param barsBySymbol { BTCUSDT: bars[], ... } daily bars
 * @param sleeves [{ id, symbol, strategy, params, weight? }]  weights default to equal and are normalised to sum 1
 * @param opts { from, to, costs, barsPerYear, startEquity, targetVol, regime: { symbol, len }, volWindow }
 */
export function runPortfolio(barsBySymbol, sleeves, opts = {}) {
    const { costs = DEFAULT_COSTS, startEquity = 1000, barsPerYear: bpy = 365, targetVol = null, regime = null, volWindow = 30 } = opts;
    const symbols = [...new Set([...sleeves.map((s) => s.symbol), ...(regime ? [regime.symbol] : [])])];
    const aligned = alignBars(barsBySymbol, symbols);
    const wSum = sleeves.reduce((s, x) => s + (x.weight ?? 1), 0);
    const results = sleeves.map((sl) => ({ sleeve: sl, w: (sl.weight ?? 1) / wSum, res: runBacktest(aligned[sl.symbol], sl.strategy, sl.params, { from: opts.from, to: opts.to, costs, barsPerYear: bpy }) }));
    const n = Math.min(...results.map((r) => r.res.equity.length));
    if (!n) return null;
    const times = results[0].res.equity.slice(0, n).map((e) => e.time);
    // sleeve daily returns (start equity of runBacktest is 1000 each)
    const sleeveRets = results.map((r) => r.res.equity.slice(0, n).map((e, i, a) => (i === 0 ? e.equity / 1000 - 1 : e.equity / a[i - 1].equity - 1)));
    const raw = new Array(n).fill(0);
    const rawExposure = new Array(n).fill(0);
    for (let k = 0; k < results.length; k++) {
        for (let i = 0; i < n; i++) {
            raw[i] += results[k].w * sleeveRets[k][i];
            rawExposure[i] += results[k].w * results[k].res.equity[i].exposure;
        }
    }
    // regime gate series (decided at previous close)
    let gate = null;
    if (regime) {
        const rb = aligned[regime.symbol];
        const ma = sma(rb.map((b) => b.close), regime.len);
        const idxByTime = new Map(rb.map((b, i) => [b.time, i]));
        gate = times.map((t) => {
            const j = idxByTime.get(t);
            const prev = j - 1;
            return prev >= 0 && ma[prev] != null && rb[prev].close > ma[prev] ? 1 : 0;
        });
    }
    const equity = [];
    const scales = [];
    let eq = startEquity;
    let scale = 1;
    for (let i = 0; i < n; i++) {
        let want = 1;
        if (gate) want *= gate[i];
        if (targetVol) {
            const v = annualVol(raw, i, volWindow, bpy);
            want *= v && v > 0 ? Math.min(1, targetVol / v) : 1;
        }
        let cost = 0;
        if (Math.abs(want - scale) >= MIN_SCALE_STEP || (want === 0 && scale > 0)) {
            cost = Math.abs(want - scale) * (costs.fee + costs.slippage);
            scale = want;
        }
        eq *= 1 + scale * raw[i] - cost;
        scales.push(scale);
        equity.push({ time: times[i], equity: eq, exposure: scale * rawExposure[i] });
    }
    return {
        equity,
        scales,
        sleeves: results.map((r) => ({ id: r.sleeve.id ?? `${r.sleeve.symbol}-${r.sleeve.strategy}`, weight: Math.round(r.w * 1000) / 1000, metrics: r.res.metrics })),
        metrics: computeMetrics(equity, [], startEquity, bpy),
    };
}

/** Buy & hold basket (equal weight, rebalanced daily) as the benchmark for a portfolio. */
export function basketBuyHold(barsBySymbol, symbols, opts = {}) {
    return runPortfolio(barsBySymbol, symbols.map((s) => ({ id: `${s}-buyHold`, symbol: s, strategy: 'buyHold', params: {} })), opts);
}
