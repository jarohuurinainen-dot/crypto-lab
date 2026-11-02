// Tests that try to catch "lucky" strategies.
//   neighborhood(): does the strategy still work with slightly different parameters? A real edge is a plateau, luck is a spike.
//   deflatedSharpe(): probability that the true Sharpe is above what the BEST of N tried strategies would show by pure chance
//                     (Bailey & Lopez de Prado, 2014). N and the spread of the tried Sharpes come from the real search we did.
import { runBacktest } from './backtest.js';
import { STRATEGIES } from './strategies.js';

// ---- normal distribution helpers
export function normCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
}
export function normInv(p) {
    // Acklam's rational approximation
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    let q, r;
    if (p < lo) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - lo) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function returnsOf(equity, startEquity = 1000) {
    return equity.map((e, i) => (i === 0 ? e.equity / startEquity - 1 : e.equity / equity[i - 1].equity - 1));
}

export function moments(rets) {
    const n = rets.length;
    const m = rets.reduce((s, r) => s + r, 0) / n;
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - m) ** 2, 0) / (n - 1));
    const skew = rets.reduce((s, r) => s + ((r - m) / sd) ** 3, 0) / n;
    const kurt = rets.reduce((s, r) => s + ((r - m) / sd) ** 4, 0) / n; // plain kurtosis (normal = 3)
    return { n, mean: m, sd, skew, kurt, sharpe: sd > 0 ? m / sd : 0 };
}

const EULER = 0.5772156649015329;
/** Expected best Sharpe (per-period units) among N skill-less trials whose Sharpes have variance `v`. */
export function expectedMaxSharpe(N, v) {
    if (N <= 1) return 0;
    return Math.sqrt(v) * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)));
}

/**
 * @param rets per-period returns of the chosen strategy
 * @param trialSharpes per-period Sharpe of every strategy/parameter set that was tried (the search we actually did)
 * @returns { dsr, psr, sr0Annual } dsr = probability the real Sharpe beats the luck benchmark
 */
export function deflatedSharpe(rets, trialSharpes, barsPerYear = 365) {
    const mo = moments(rets);
    const N = trialSharpes.length;
    const tm = trialSharpes.reduce((s, x) => s + x, 0) / N;
    const v = N > 1 ? trialSharpes.reduce((s, x) => s + (x - tm) ** 2, 0) / (N - 1) : 0;
    const sr0 = expectedMaxSharpe(N, v);
    const denom = Math.sqrt(Math.max(1e-12, 1 - mo.skew * mo.sharpe + ((mo.kurt - 1) / 4) * mo.sharpe ** 2));
    const z = ((mo.sharpe - sr0) * Math.sqrt(mo.n - 1)) / denom;
    const zPsr = (mo.sharpe * Math.sqrt(mo.n - 1)) / denom;
    const r = (x) => Math.round(x * 1000) / 1000;
    return { dsr: r(normCdf(z)), psr: r(normCdf(zPsr)), trials: N, sr0Annual: r(sr0 * Math.sqrt(barsPerYear)), sharpeAnnual: r(mo.sharpe * Math.sqrt(barsPerYear)) };
}

/** Run every strategy and every grid parameter set over the same window: the "search" we are deflating against. */
export function allTrials(bars, opts) {
    const out = [];
    for (const [name, s] of Object.entries(STRATEGIES)) {
        if (name === 'buyHold') continue;
        for (const p of s.grid) {
            const r = runBacktest(bars, name, p, opts);
            if (r.equity.length > 50) out.push({ strategy: name, params: p, sharpePeriod: moments(returnsOf(r.equity)).sharpe, sharpe: r.metrics.sharpe });
        }
    }
    return out;
}

/** Sharpe of the strategy with each numeric parameter nudged by -25 %, -10 %, +10 %, +25 % (one at a time). */
export function neighborhood(bars, strategy, params, opts) {
    const base = runBacktest(bars, strategy, params, opts).metrics.sharpe;
    const results = [];
    for (const [key, val] of Object.entries(params)) {
        if (typeof val !== 'number') continue;
        for (const f of [0.75, 0.9, 1.1, 1.25]) {
            let nv = val * f;
            if (Number.isInteger(val)) nv = Math.max(2, Math.round(nv));
            if (nv === val) continue;
            const p = { ...params, [key]: nv };
            results.push({ param: key, value: nv, sharpe: runBacktest(bars, strategy, p, opts).metrics.sharpe });
        }
    }
    const sh = results.map((r) => r.sharpe).sort((a, b) => a - b);
    const med = sh.length ? sh[Math.floor(sh.length / 2)] : null;
    return { base, neighbors: results, min: sh[0] ?? null, median: med, worstDropPct: sh.length && base ? Math.round(((base - sh[0]) / base) * 100) : null };
}
