// Bar-by-bar backtester.
// Decision at the CLOSE of bar i (using data up to i), execution at the OPEN of bar i+1 -> no look-ahead.
// Costs: exchange fee + slippage on every traded amount.
import { STRATEGIES, makeContext } from './strategies.js';

export const DEFAULT_COSTS = { fee: 0.001, slippage: 0.0005 }; // 0.10 % taker fee + 0.05 % slippage per side
const MIN_REBALANCE = 0.05; // ignore target changes smaller than 5 % of equity (avoids fee-churn)

export function barsPerYear(intervalMs) {
    return (365 * 24 * 3600 * 1000) / intervalMs;
}

/**
 * @param bars [{time, open, high, low, close, volume}]
 * @param opts { from, to, costs, startEquity, barsPerYear }
 *   from/to = bar index range to TRADE in (indicators still see earlier data -> warm-up is free)
 */
export function runBacktest(bars, strategyName, params, opts = {}) {
    const { costs = DEFAULT_COSTS, startEquity = 1000 } = opts;
    const from = Math.max(1, opts.from ?? 1);
    const to = Math.min(bars.length - 1, opts.to ?? bars.length - 1);
    const bpy = opts.barsPerYear ?? 365;
    const ctx = makeContext(strategyName, bars, params, bpy);
    const strat = STRATEGIES[strategyName];
    const costRate = costs.fee + costs.slippage;

    let cash = startEquity;
    let units = 0;
    let pos = 0; // current fraction (as decided)
    const equity = [];
    const trades = [];
    let openTrade = null;
    let feesPaid = 0;

    // Warm up stateful strategies on bars before `from` without trading.
    for (let i = 0; i < from - 1; i++) pos = clamp(strat.target(ctx, i, pos));
    pos = 0;

    for (let i = from - 1; i < to; i++) {
        const desired = clamp(strat.target(ctx, i, pos));
        const px = bars[i + 1].open; // execute next bar's open
        const eqNow = cash + units * px;
        const curFrac = eqNow > 0 ? (units * px) / eqNow : 0;
        if (Math.abs(desired - curFrac) >= MIN_REBALANCE || (desired === 0 && units > 0) || (desired === 1 && curFrac < 1 - MIN_REBALANCE)) {
            const targetValue = desired * eqNow;
            const delta = targetValue - units * px; // + buy, - sell
            if (delta > 0) {
                const spend = Math.min(delta, cash);
                const fee = spend * costRate;
                units += (spend - fee) / px;
                cash -= spend;
                feesPaid += fee;
            } else if (delta < 0) {
                const sellUnits = Math.min(units, -delta / px);
                const gross = sellUnits * px;
                const fee = gross * costRate;
                units -= sellUnits;
                cash += gross - fee;
                feesPaid += fee;
            }
            const after = cash + units * px;
            if (curFrac < 0.01 && desired > 0) openTrade = { entryTime: bars[i + 1].time, entryPrice: px, entryEquity: eqNow };
            if (desired === 0 && openTrade) {
                trades.push({ ...openTrade, exitTime: bars[i + 1].time, exitPrice: px, returnPct: (after / openTrade.entryEquity - 1) * 100 });
                openTrade = null;
            }
        }
        pos = desired;
        const close = bars[i + 1].close;
        equity.push({ time: bars[i + 1].time, equity: cash + units * close, exposure: (units * close) / Math.max(1e-9, cash + units * close) });
    }
    if (openTrade) {
        const last = bars[to];
        trades.push({ ...openTrade, exitTime: last.time, exitPrice: last.close, returnPct: ((cash + units * last.close) / openTrade.entryEquity - 1) * 100, open: true });
    }
    return { equity, trades, feesPaid, metrics: computeMetrics(equity, trades, startEquity, bpy) };
}

const clamp = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export function computeMetrics(equity, trades, startEquity, bpy) {
    if (!equity.length) return null;
    const vals = equity.map((e) => e.equity);
    const end = vals.at(-1);
    const n = vals.length;
    const years = n / bpy;
    const rets = vals.map((v, i) => (i === 0 ? v / startEquity - 1 : v / vals[i - 1] - 1));
    const mean = rets.reduce((s, r) => s + r, 0) / n;
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, n - 1));
    const downside = Math.sqrt(rets.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / Math.max(1, n - 1));
    let peak = startEquity;
    let maxDd = 0;
    for (const v of vals) { peak = Math.max(peak, v); maxDd = Math.max(maxDd, 1 - v / peak); }
    const cagr = years > 0 && end > 0 ? (end / startEquity) ** (1 / years) - 1 : null;
    const closed = trades.filter((t) => !t.open);
    const wins = closed.filter((t) => t.returnPct > 0);
    const grossWin = wins.reduce((s, t) => s + t.returnPct, 0);
    const grossLoss = -closed.filter((t) => t.returnPct <= 0).reduce((s, t) => s + t.returnPct, 0);
    const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
    return {
        totalReturnPct: r2((end / startEquity - 1) * 100),
        cagrPct: r2(cagr == null ? null : cagr * 100),
        maxDrawdownPct: r2(maxDd * 100),
        sharpe: r2(sd > 0 ? (mean / sd) * Math.sqrt(bpy) : 0),
        sortino: r2(downside > 0 ? (mean / downside) * Math.sqrt(bpy) : 0),
        calmar: r2(maxDd > 0 && cagr != null ? cagr / maxDd : null),
        exposurePct: r2((equity.reduce((s, e) => s + e.exposure, 0) / n) * 100),
        trades: trades.length,
        winRatePct: r2(closed.length ? (wins.length / closed.length) * 100 : null),
        profitFactor: r2(grossLoss > 0 ? grossWin / grossLoss : null),
        years: r2(years),
    };
}
