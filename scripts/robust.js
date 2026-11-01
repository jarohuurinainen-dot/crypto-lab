// Robustness check for the strategies chosen for paper trading. Usage: npm run robust
// 1) Luck test: compare each strategy to 300 RANDOM strategies that are in the market the same share of time
//    and trade as often. If random entries do as well, the "edge" is just exposure + luck.
// 2) Cost test: rerun with double costs (0.3 % per trade).
import { readFileSync, writeFileSync } from 'node:fs';
import { runBacktest, barsPerYear } from '../src/backtest.js';
import { loadBars, INTERVAL_MS } from '../src/data.js';
import { STRATEGIES } from '../src/strategies.js';

const config = JSON.parse(readFileSync('paper/config.json', 'utf8'));
const N = 300;

// Register a temporary "random" strategy driven by a precomputed position array.
STRATEGIES.__random = { label: 'random', grid: [{}], init: (bars, p) => ({ pos: p.pos }), target: (x, i) => x.pos[i] ?? 0 };

function randomPositions(n, exposure, avgHold, seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const pos = new Array(n).fill(0);
    const pIn = 1 / Math.max(1, avgHold); // leave probability per bar
    const pOut = exposure > 0 && exposure < 1 ? pIn * exposure / (1 - exposure) : 0.5; // enter probability
    let cur = rnd() < exposure ? 1 : 0;
    for (let i = 0; i < n; i++) {
        if (cur === 1 && rnd() < pIn) cur = 0;
        else if (cur === 0 && rnd() < pOut) cur = 1;
        pos[i] = cur;
    }
    return pos;
}

const out = [];
for (const acc of config.accounts.filter((a) => a.strategy !== 'buyHold')) {
    const bars = loadBars('data', acc.symbol, acc.interval);
    if (bars.length < 800) { console.log(`${acc.id}: ei dataa, aja ensin npm run data`); continue; }
    const bpy = barsPerYear(INTERVAL_MS[acc.interval]);
    const from = Math.round(bpy * 2); // same out-of-sample start as the walk-forward (after 2 years)
    const base = runBacktest(bars, acc.strategy, acc.params, { from, barsPerYear: bpy });
    const dbl = runBacktest(bars, acc.strategy, acc.params, { from, barsPerYear: bpy, costs: { fee: 0.002, slippage: 0.001 } });
    const bh = runBacktest(bars, 'buyHold', {}, { from, barsPerYear: bpy });
    const m = base.metrics;
    const avgHold = m.trades ? (m.exposurePct / 100) * base.equity.length / m.trades : 20;
    let better = 0;
    const randSharpes = [];
    for (let k = 0; k < N; k++) {
        const pos = randomPositions(bars.length, m.exposurePct / 100, avgHold, 1000 + k);
        const r = runBacktest(bars, '__random', { pos }, { from, barsPerYear: bpy });
        randSharpes.push(r.metrics.sharpe);
        if (r.metrics.sharpe >= m.sharpe) better++;
    }
    randSharpes.sort((a, b) => a - b);
    const row = {
        tili: acc.id,
        sharpe: m.sharpe,
        satunnainenMediaani: randSharpes[Math.floor(N / 2)],
        satunnainen95: randSharpes[Math.floor(N * 0.95)],
        pArvo: Math.round((better / N) * 1000) / 1000,
        sharpeTuplakuluilla: dbl.metrics.sharpe,
        pudotus: m.maxDrawdownPct,
        ostaJaPidaSharpe: bh.metrics.sharpe,
        ostaJaPidaPudotus: bh.metrics.maxDrawdownPct,
        tulkinta: better / N < 0.05 ? 'todennäköisesti aito etu' : better / N < 0.2 ? 'heikko näyttö' : 'voi olla tuuria',
    };
    out.push(row);
    console.log(row);
}
console.table(out);
writeFileSync('reports/robust.json', JSON.stringify(out, null, 2));
console.log('\npArvo = osuus satunnaisista strategioista, jotka pärjäsivät yhtä hyvin. Alle 0,05 = hyvä merkki.');
