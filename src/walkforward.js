// Walk-forward validation: choose parameters on past data only, then measure on the next unseen period.
// This is the honest test: the out-of-sample (OOS) result is what you could have actually earned.
import { STRATEGIES } from './strategies.js';
import { runBacktest, computeMetrics } from './backtest.js';

/**
 * Rolling windows: train `trainBars`, then test `testBars`, step forward by `testBars`.
 * Parameter choice on train = best Sharpe with at least `minTrades` trades (buyHold has 1 param set).
 * Returns stitched OOS equity + metrics, and the params picked per window.
 */
export function walkForward(bars, strategyName, { trainBars, testBars, barsPerYear, costs, minTrades = 3 } = {}) {
    const grid = STRATEGIES[strategyName].grid;
    const windows = [];
    let stitched = [];
    let equity = 1000;
    for (let start = 0; start + trainBars + testBars <= bars.length; start += testBars) {
        const trainFrom = start + 1;
        const trainTo = start + trainBars;
        let best = null;
        for (const p of grid) {
            const r = runBacktest(bars, strategyName, p, { from: trainFrom, to: trainTo, barsPerYear, costs });
            const m = r.metrics;
            const okTrades = strategyName === 'buyHold' || m.trades >= minTrades;
            const score = okTrades ? m.sharpe : -Infinity;
            if (!best || score > best.score) best = { params: p, score, train: m };
        }
        const test = runBacktest(bars, strategyName, best.params, { from: trainTo + 1, to: trainTo + testBars, barsPerYear, costs, startEquity: equity });
        stitched = stitched.concat(test.equity);
        equity = test.equity.at(-1)?.equity ?? equity;
        windows.push({ params: best.params, trainSharpe: best.train.sharpe, testMetrics: test.metrics, testTrades: test.trades.length, from: bars[trainTo + 1]?.time, to: bars[trainTo + testBars]?.time });
    }
    const allTrades = windows.reduce((s, w) => s + w.testTrades, 0);
    const metrics = stitched.length ? computeMetrics(stitched, new Array(allTrades).fill({ returnPct: 0, open: true }), 1000, barsPerYear) : null;
    if (metrics) { metrics.trades = allTrades; metrics.winRatePct = null; metrics.profitFactor = null; }
    return { strategy: strategyName, windows, equity: stitched, metrics };
}

/**
 * Compare every strategy on one coin. Verdict per strategy vs buy & hold OOS:
 *   'beats'  = higher Sharpe AND smaller max drawdown
 *   'safer'  = smaller drawdown, lower return
 *   'worse'  = otherwise
 */
export function compareStrategies(bars, opts) {
    const results = Object.keys(STRATEGIES).map((name) => walkForward(bars, name, opts));
    const bh = results.find((r) => r.strategy === 'buyHold');
    for (const r of results) {
        if (!r.metrics || !bh?.metrics || r.strategy === 'buyHold') { r.verdict = r.strategy === 'buyHold' ? 'baseline' : 'n/a'; continue; }
        const m = r.metrics;
        const b = bh.metrics;
        if (m.sharpe > b.sharpe && m.maxDrawdownPct < b.maxDrawdownPct) r.verdict = 'beats';
        else if (m.maxDrawdownPct < b.maxDrawdownPct * 0.7 && m.sharpe >= b.sharpe * 0.8) r.verdict = 'safer';
        else r.verdict = 'worse';
    }
    return results;
}
