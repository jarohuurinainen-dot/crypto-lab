// Strategy library. Each strategy:
//   init(bars, params) -> context (precomputed indicators)
//   target(ctx, i, current) -> desired position 0..1 (fraction of equity in the coin), decided at the CLOSE of bar i.
// Long-only spot (no leverage, no shorting): what a beginner can actually do on a normal exchange.
import { sma, ema, rsi, atr, donchian, realizedVol, stdev } from './indicators.js';

const closes = (bars) => bars.map((b) => b.close);
const ok = (...xs) => xs.every((x) => x != null && Number.isFinite(x));

export const STRATEGIES = {
    buyHold: {
        label: 'Osta ja pidä (vertailukohta)',
        grid: [{}],
        init: () => ({}),
        target: () => 1,
    },

    smaCross: {
        label: 'Liukuvien keskiarvojen risteys',
        grid: [[10, 30], [20, 50], [20, 100], [50, 200]].map(([fast, slow]) => ({ fast, slow })),
        init: (bars, p) => { const c = closes(bars); return { f: sma(c, p.fast), s: sma(c, p.slow) }; },
        target: (x, i) => (ok(x.f[i], x.s[i]) ? (x.f[i] > x.s[i] ? 1 : 0) : 0),
    },

    emaTrendAtrStop: {
        label: 'EMA-trendi + ATR-stoppi',
        grid: [50, 100, 200].flatMap((len) => [2, 3, 4].map((mult) => ({ len, mult }))),
        init: (bars, p) => ({ bars, e: ema(closes(bars), p.len), a: atr(bars, 14), stop: null }),
        target: (x, i, cur) => {
            const c = x.bars[i].close;
            if (!ok(x.e[i], x.a[i])) return 0;
            if (cur > 0) {
                x.stop = Math.max(x.stop ?? -Infinity, c - p0(x).mult * x.a[i]);
                if (c < x.stop || c < x.e[i]) { x.stop = null; return 0; }
                return 1;
            }
            if (c > x.e[i]) { x.stop = c - p0(x).mult * x.a[i]; return 1; }
            return 0;
        },
    },

    donchianBreakout: {
        label: 'Donchian-läpimurto (kilpikonnasääntö)',
        grid: [[20, 10], [55, 20], [100, 50]].map(([entry, exit]) => ({ entry, exit })),
        init: (bars, p) => ({ bars, en: donchian(bars, p.entry), ex: donchian(bars, p.exit) }),
        target: (x, i, cur) => {
            const c = x.bars[i].close;
            if (!ok(x.en.upper[i], x.ex.lower[i])) return 0;
            if (cur === 0 && c > x.en.upper[i]) return 1;
            if (cur > 0 && c < x.ex.lower[i]) return 0;
            return cur;
        },
    },

    rsiReversion: {
        label: 'RSI-notkahdusten osto (trendisuodattimella)',
        grid: [[14, 30, 55], [14, 25, 60], [7, 20, 60]].flatMap(([len, buy, sell]) => [true, false].map((trend) => ({ len, buy, sell, trend }))),
        init: (bars, p) => { const c = closes(bars); return { r: rsi(c, p.len), t: sma(c, 200), c }; },
        target: (x, i, cur) => {
            if (!ok(x.r[i])) return 0;
            const up = !p0(x).trend || (x.t[i] != null && x.c[i] > x.t[i]);
            if (cur === 0 && x.r[i] < p0(x).buy && up) return 1;
            if (cur > 0 && (x.r[i] > p0(x).sell || (p0(x).trend && !up))) return 0;
            return cur;
        },
    },

    bollingerReversion: {
        label: 'Bollinger-kaistan paluu',
        grid: [[20, 2], [20, 2.5], [50, 2]].map(([len, k]) => ({ len, k })),
        init: (bars, p) => { const c = closes(bars); return { c, m: sma(c, p.len), s: stdev(c, p.len) }; },
        target: (x, i, cur) => {
            if (!ok(x.m[i], x.s[i])) return 0;
            const lower = x.m[i] - p0(x).k * x.s[i];
            if (cur === 0 && x.c[i] < lower) return 1;
            if (cur > 0 && x.c[i] > x.m[i]) return 0;
            return cur;
        },
    },

    momentum: {
        label: 'Aikasarjamomentti',
        grid: [30, 60, 90, 180].map((lookback) => ({ lookback })),
        init: (bars, p) => ({ c: closes(bars) }),
        target: (x, i) => (i >= p0(x).lookback ? (x.c[i] > x.c[i - p0(x).lookback] ? 1 : 0) : 0),
    },

    volTargetTrend: {
        label: 'Trendi + volatiliteettitavoite',
        grid: [[100, 0.4], [200, 0.4], [100, 0.6], [200, 0.6]].map(([len, targetVol]) => ({ len, targetVol })),
        init: (bars, p) => { const c = closes(bars); return { c, t: sma(c, p.len), v: realizedVol(c, 30), barsPerYear: 365 }; },
        target: (x, i) => {
            if (!ok(x.t[i], x.v[i]) || x.v[i] === 0) return 0;
            if (x.c[i] < x.t[i]) return 0;
            const annVol = x.v[i] * Math.sqrt(x.barsPerYear);
            return Math.min(1, p0(x).targetVol / annVol);
        },
    },

    macd: {
        label: 'MACD-risteys',
        grid: [[12, 26, 9], [24, 52, 18]].map(([fast, slow, signal]) => ({ fast, slow, signal })),
        init: (bars, p) => {
            const c = closes(bars);
            const f = ema(c, p.fast);
            const s = ema(c, p.slow);
            const line = c.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
            const firstIdx = line.findIndex((v) => v != null);
            const sig = new Array(c.length).fill(null);
            if (firstIdx >= 0) {
                const e = ema(line.slice(firstIdx), p.signal);
                e.forEach((v, k) => { sig[firstIdx + k] = v; });
            }
            return { line, sig };
        },
        target: (x, i) => (ok(x.line[i], x.sig[i]) ? (x.line[i] > x.sig[i] ? 1 : 0) : 0),
    },
};

// params are attached to the context by the backtester as ctx.__p
function p0(ctx) { return ctx.__p; }

export function makeContext(name, bars, params, barsPerYear = 365) {
    const s = STRATEGIES[name];
    if (!s) throw new Error(`Unknown strategy ${name}`);
    const ctx = s.init(bars, params);
    ctx.__p = params;
    if ('barsPerYear' in ctx) ctx.barsPerYear = barsPerYear;
    return ctx;
}
