import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, atr, donchian, stdev } from '../src/indicators.js';
import { STRATEGIES, makeContext } from '../src/strategies.js';
import { runBacktest, computeMetrics, barsPerYear } from '../src/backtest.js';
import { walkForward, compareStrategies } from '../src/walkforward.js';
import { syntheticBars, parseKline, fetchKlines, INTERVAL_MS } from '../src/data.js';
import { newAccount, stepAccount, currentTarget, accountSummary } from '../src/paper.js';
import { backtestReport, paperDashboard } from '../src/report.js';

const close = (xs) => xs.map((c, i) => ({ time: i * 864e5, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1 }));

test('indicators', () => {
    assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    assert.equal(e[2], 2);
    assert.equal(e[3], 3);
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    assert.equal(r[14], 100);
    assert.equal(r[13], null);
    assert.ok(atr(close([10, 11, 12, 13]), 2)[1] > 0);
    const d = donchian(close([1, 5, 3, 2]), 2);
    assert.equal(d.upper[2], 5 * 1.01);
    assert.equal(d.upper[1], null);
    assert.equal(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7], 2);
});

test('synthetic data is deterministic and valid', () => {
    const a = syntheticBars({ n: 100, seed: 1 });
    const b = syntheticBars({ n: 100, seed: 1 });
    assert.deepEqual(a, b);
    assert.ok(a.every((x) => x.high >= Math.max(x.open, x.close) && x.low <= Math.min(x.open, x.close) && x.low > 0));
});

test('NO LOOK-AHEAD: changing future bars never changes past decisions', () => {
    const bars = syntheticBars({ n: 700, seed: 3 });
    const cut = 500;
    const future = bars.map((b, i) => (i > cut ? { ...b, open: b.open * 3, high: b.high * 3, low: b.low * 3, close: b.close * 3 } : b));
    for (const [name, s] of Object.entries(STRATEGIES)) {
        for (const p of s.grid.slice(0, 2)) {
            const c1 = makeContext(name, bars, p);
            const c2 = makeContext(name, future, p);
            let p1 = 0;
            let p2 = 0;
            for (let i = 0; i <= cut; i++) {
                p1 = s.target(c1, i, p1);
                p2 = s.target(c2, i, p2);
                assert.equal(p1, p2, `${name} ${JSON.stringify(p)} differs at bar ${i}`);
            }
        }
    }
});

test('buy & hold matches the price change minus one round of costs', () => {
    const bars = close([100, 100, 110, 120, 150, 200]);
    const r = runBacktest(bars, 'buyHold', {}, { costs: { fee: 0.001, slippage: 0 } });
    // buys at open of bar 1 (100), ends at close 200 -> x2 minus 0.1 % fee
    assert.ok(Math.abs(r.equity.at(-1).equity - 2000 * 0.999) < 0.01);
    assert.equal(r.trades.length, 1);
});

test('costs are charged on every trade', () => {
    const bars = syntheticBars({ n: 800, seed: 9 });
    const free = runBacktest(bars, 'smaCross', { fast: 10, slow: 30 }, { costs: { fee: 0, slippage: 0 } });
    const paid = runBacktest(bars, 'smaCross', { fast: 10, slow: 30 }, { costs: { fee: 0.001, slippage: 0.0005 } });
    assert.ok(paid.feesPaid > 0);
    assert.ok(paid.equity.at(-1).equity < free.equity.at(-1).equity);
    assert.ok(paid.metrics.trades > 5);
});

test('metrics: drawdown and returns on a known path', () => {
    const eq = [100, 120, 60, 90, 180].map((v, i) => ({ time: i, equity: v, exposure: 1 }));
    const m = computeMetrics(eq, [], 100, 365);
    assert.equal(m.maxDrawdownPct, 50);
    assert.equal(m.totalReturnPct, 80);
});

test('walk-forward never tests on training data and stitches windows', () => {
    const bars = syntheticBars({ n: 1200, seed: 5 });
    const wf = walkForward(bars, 'smaCross', { trainBars: 500, testBars: 150, barsPerYear: 365 });
    assert.equal(wf.windows.length, 4);
    assert.equal(wf.equity[0].time, bars[501].time); // first OOS bar = first bar after the training window (1..500)
    for (const w of wf.windows) assert.ok(w.from > bars[499].time);
    assert.ok(wf.metrics.sharpe != null);
});

test('compareStrategies gives a verdict for every strategy', () => {
    const bars = syntheticBars({ n: 1100, seed: 11 });
    const res = compareStrategies(bars, { trainBars: 500, testBars: 200, barsPerYear: 365 });
    assert.equal(res.length, Object.keys(STRATEGIES).length);
    assert.equal(res.find((r) => r.strategy === 'buyHold').verdict, 'baseline');
    assert.ok(res.every((r) => ['baseline', 'beats', 'safer', 'worse', 'n/a'].includes(r.verdict)));
});

test('paper account: trades toward target once per bar, idempotent', () => {
    const bars = syntheticBars({ n: 400, seed: 2 });
    const acc = newAccount('x', { symbol: 'BTCUSDT', interval: '1d', strategy: 'buyHold', params: {} });
    const r1 = stepAccount(acc, bars);
    assert.equal(r1.trade.side, 'BUY');
    const r2 = stepAccount(acc, bars);
    assert.equal(r2.trade, null);
    assert.equal(acc.history.length, 1);
    const more = [...bars, { ...bars.at(-1), time: bars.at(-1).time + 864e5, close: bars.at(-1).close * 1.1 }];
    stepAccount(acc, more);
    assert.equal(acc.history.length, 2);
    assert.ok(accountSummary(acc).returnPct > 5);
    assert.equal(currentTarget(bars, 'buyHold', {}, 365), 1);
});

test('fetchKlines paginates and drops the unfinished bar', async () => {
    const day = INTERVAL_MS['1d'];
    const now = 2000 * day + 5;
    const fake = async (url) => {
        const u = new URL(url);
        const start = Number(u.searchParams.get('startTime'));
        const rows = [];
        for (let t = start; t <= now && rows.length < 1000; t += day) rows.push([t, '1', '2', '0.5', '1.5', '10', t + day - 1]);
        return new Response(JSON.stringify(rows), { status: 200 });
    };
    const bars = await fetchKlines('BTCUSDT', '1d', 0, { fetchImpl: fake, now });
    assert.equal(bars.length, 2000); // 0..1999 closed, bar 2000 still open
    assert.deepEqual(parseKline([1, '2', '3', '1', '2.5', '9', 2]), { time: 1, open: 2, high: 3, low: 1, close: 2.5, volume: 9, closeTime: 2 });
});

test('reports render', () => {
    const bars = syntheticBars({ n: 900, seed: 4 });
    const results = compareStrategies(bars, { trainBars: 400, testBars: 200, barsPerYear: 365 }).map((r) => ({ ...r, label: r.strategy }));
    const html = backtestReport({ generatedAt: 'now', synthetic: true, costs: { fee: 0.001, slippage: 0.0005 }, sections: [{ symbol: 'BTC', interval: '1d', period: 'x', results }], ranking: [] });
    assert.match(html, /<svg/);
    assert.match(html, /keinotekoinen/);
    assert.match(paperDashboard({ updatedAt: 'now', accounts: [] }), /Paperitreidaus/);
    assert.equal(barsPerYear(INTERVAL_MS['4h']), 2190);
});

// ---------------------------------------------------------------- portfolio layer
import { runPortfolio, basketBuyHold, alignBars } from '../src/portfolio.js';

const synth = (seed) => syntheticBars({ n: 1500, seed, startPrice: 100 });

test('portfolio: equal-weight sleeves are the average of their returns and metrics exist', () => {
    const data = { AAA: synth(1), BBB: synth(2) };
    const sleeves = [{ id: 'a', symbol: 'AAA', strategy: 'buyHold', params: {} }, { id: 'b', symbol: 'BBB', strategy: 'buyHold', params: {} }];
    const p = runPortfolio(data, sleeves, { from: 400 });
    const a = runBacktest(data.AAA, 'buyHold', {}, { from: 400 });
    const b = runBacktest(data.BBB, 'buyHold', {}, { from: 400 });
    const i = 500;
    const ra = a.equity[i].equity / a.equity[i - 1].equity - 1;
    const rb = b.equity[i].equity / b.equity[i - 1].equity - 1;
    const rp = p.equity[i].equity / p.equity[i - 1].equity - 1;
    assert.ok(Math.abs(rp - (ra + rb) / 2) < 1e-12);
    assert.equal(p.equity.length, a.equity.length);
    assert.ok(p.metrics.sharpe != null && p.metrics.exposurePct > 0);
});

test('portfolio: weights are normalised and alignBars keeps common timestamps', () => {
    const x = synth(3);
    const y = synth(4).slice(100);
    const al = alignBars({ X: x, Y: y }, ['X', 'Y']);
    assert.equal(al.X.length, al.Y.length);
    assert.equal(al.X[0].time, al.Y[0].time);
    const p = runPortfolio({ X: x }, [{ symbol: 'X', strategy: 'buyHold', params: {}, weight: 3 }, { symbol: 'X', strategy: 'smaCross', params: { fast: 10, slow: 30 }, weight: 1 }], { from: 300 });
    assert.equal(p.sleeves[0].weight, 0.75);
});

test('portfolio: volatility target never adds leverage and lowers risk', () => {
    const data = { AAA: synth(5) };
    const sl = [{ symbol: 'AAA', strategy: 'buyHold', params: {} }];
    const base = runPortfolio(data, sl, { from: 300 });
    const tgt = runPortfolio(data, sl, { from: 300, targetVol: 0.3 });
    assert.ok(tgt.scales.every((s) => s >= 0 && s <= 1));
    assert.ok(tgt.metrics.maxDrawdownPct <= base.metrics.maxDrawdownPct);
});

test('portfolio: regime gate uses the previous close (no look-ahead) and goes to cash in a downtrend', () => {
    const down = close(Array.from({ length: 400 }, (_, i) => 1000 - i * 2));
    const p = runPortfolio({ D: down }, [{ symbol: 'D', strategy: 'buyHold', params: {} }], { from: 250, regime: { symbol: 'D', len: 50 } });
    assert.ok(p.scales.slice(5).every((s) => s === 0));
    assert.ok(p.metrics.maxDrawdownPct < 1);
    const up = close(Array.from({ length: 400 }, (_, i) => 100 + i));
    const q = runPortfolio({ U: up }, [{ symbol: 'U', strategy: 'buyHold', params: {} }], { from: 250, regime: { symbol: 'U', len: 50 } });
    assert.ok(q.scales.slice(5).every((s) => s === 1));
});

test('portfolio: basket benchmark runs', () => {
    const data = { AAA: synth(6), BBB: synth(7) };
    const b = basketBuyHold(data, ['AAA', 'BBB'], { from: 300 });
    assert.ok(b.equity.length > 1000);
});

// ---------------------------------------------------------------- validation (luck tests)
import { normCdf, normInv, expectedMaxSharpe, deflatedSharpe, moments, neighborhood } from '../src/validation.js';

test('validation: normal distribution helpers', () => {
    assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(normInv(0.975) - 1.96) < 1e-3);
    assert.ok(Math.abs(normInv(normCdf(0.7)) - 0.7) < 1e-3);
});

test('validation: more trials raise the luck benchmark; one trial has none', () => {
    assert.equal(expectedMaxSharpe(1, 0.01), 0);
    assert.ok(expectedMaxSharpe(100, 0.01) > expectedMaxSharpe(10, 0.01));
    assert.ok(expectedMaxSharpe(10, 0.04) > expectedMaxSharpe(10, 0.01));
});

test('validation: deflated Sharpe falls when many strategies were tried', () => {
    const rets = Array.from({ length: 1000 }, (_, i) => 0.001 + 0.01 * Math.sin(i * 1.7));
    const few = deflatedSharpe(rets, [0.05, 0.02]);
    const many = deflatedSharpe(rets, Array.from({ length: 200 }, (_, i) => -0.02 + 0.0004 * i));
    assert.ok(many.dsr < few.dsr);
    assert.ok(few.psr >= few.dsr);
    assert.ok(moments(rets).n === 1000);
});

test('validation: pure noise strategy does not look significant after deflation', () => {
    const noise = syntheticBars({ n: 1500, seed: 11, startPrice: 100 });
    const o = { from: 300, barsPerYear: 365 };
    const trials = Object.entries(STRATEGIES).filter(([n]) => n !== 'buyHold').flatMap(([n, s]) => s.grid.map((p) => moments(runBacktest(noise, n, p, o).equity.map((e, i, a) => (i === 0 ? e.equity / 1000 - 1 : e.equity / a[i - 1].equity - 1))).sharpe));
    const best = Math.max(...trials);
    const rets = Object.entries(STRATEGIES).filter(([n]) => n !== 'buyHold').flatMap(([n, s]) => s.grid.map((p) => ({ n, p, r: runBacktest(noise, n, p, o) }))).sort((a, b) => b.r.metrics.sharpe - a.r.metrics.sharpe)[0];
    const d = deflatedSharpe(rets.r.equity.map((e, i, a) => (i === 0 ? e.equity / 1000 - 1 : e.equity / a[i - 1].equity - 1)), trials);
    assert.ok(best > 0 && d.dsr < 0.95, `dsr ${d.dsr}`);
});

test('validation: neighborhood reports a drop for a fragile setting', () => {
    const bars = syntheticBars({ n: 1500, seed: 21, startPrice: 100 });
    const n = neighborhood(bars, 'smaCross', { fast: 20, slow: 50 }, { from: 300, barsPerYear: 365 });
    assert.ok(n.neighbors.length >= 6);
    assert.ok(n.min <= n.median);
});
