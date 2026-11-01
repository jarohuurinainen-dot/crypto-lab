// Run the full comparison. Usage:
//   npm run backtest            (real data from ./data, fetch it first with: npm run data)
//   npm run demo                (synthetic data, only to see that everything works)
import { writeFileSync, mkdirSync } from 'node:fs';
import { STRATEGIES } from '../src/strategies.js';
import { compareStrategies } from '../src/walkforward.js';
import { DEFAULT_COSTS, barsPerYear } from '../src/backtest.js';
import { loadBars, syntheticBars, INTERVAL_MS } from '../src/data.js';
import { backtestReport } from '../src/report.js';
import { SYMBOLS, INTERVALS } from './config.js';

const synthetic = process.argv.includes('--synthetic');
const sections = [];
const day = (t) => new Date(t).toISOString().slice(0, 10);

for (const interval of INTERVALS) {
    const bpy = barsPerYear(INTERVAL_MS[interval]);
    const trainBars = Math.round(bpy * 2); // 2 years to choose parameters
    const testBars = Math.round(bpy / 2); // then 6 months unseen
    for (const [k, symbol] of SYMBOLS.entries()) {
        const bars = synthetic
            ? syntheticBars({ n: Math.round(bpy * 6.5), seed: 7 + k * 101 + interval.length, intervalMs: INTERVAL_MS[interval] })
            : loadBars('data', symbol, interval);
        if (bars.length < trainBars + testBars + 10) {
            console.log(`${symbol} ${interval}: liian vähän dataa (${bars.length} kynttilää), ohitetaan. Aja ensin: npm run data`);
            continue;
        }
        const t0 = Date.now();
        const results = compareStrategies(bars, { trainBars, testBars, barsPerYear: bpy, costs: DEFAULT_COSTS });
        for (const r of results) r.label = STRATEGIES[r.strategy].label;
        const oosStart = results[0].equity[0]?.time;
        sections.push({ symbol, interval, period: `testijakso ${day(oosStart)} – ${day(bars.at(-1).time)}`, results });
        console.log(`\n${symbol} ${interval} (${bars.length} kynttilää, ${Math.round((Date.now() - t0) / 1000)} s)`);
        console.table(results.map((r) => ({ strategia: r.label, tulos: r.verdict, vuosituotto: r.metrics?.cagrPct, pudotus: r.metrics?.maxDrawdownPct, sharpe: r.metrics?.sharpe, kauppoja: r.metrics?.trades })));
    }
}

// Robustness ranking: in how many coin/interval sets does a strategy beat buy & hold?
const names = Object.keys(STRATEGIES).filter((n) => n !== 'buyHold');
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const ranking = names.map((name) => {
    const rs = sections.map((s) => s.results.find((r) => r.strategy === name)).filter((r) => r?.metrics);
    return {
        strategy: name,
        label: STRATEGIES[name].label,
        beats: rs.filter((r) => r.verdict === 'beats').length,
        total: rs.length,
        avgSharpe: avg(rs.map((r) => r.metrics.sharpe)),
        avgMaxDd: avg(rs.map((r) => r.metrics.maxDrawdownPct)),
        avgCagr: avg(rs.map((r) => r.metrics.cagrPct)),
    };
}).sort((a, b) => b.beats - a.beats || (b.avgSharpe ?? -9) - (a.avgSharpe ?? -9));

mkdirSync('reports', { recursive: true });
const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
writeFileSync('reports/report.html', backtestReport({ generatedAt, synthetic, costs: DEFAULT_COSTS, sections, ranking }));
writeFileSync('reports/results.json', JSON.stringify({
    generatedAt, synthetic, ranking,
    sections: sections.map((s) => ({ symbol: s.symbol, interval: s.interval, period: s.period, results: s.results.map((r) => ({ strategy: r.strategy, verdict: r.verdict, metrics: r.metrics, lastParams: r.windows.at(-1)?.params, windows: r.windows.length })) })),
}, null, 2));

// Suggest paper-trading accounts: top 3 robust strategies + buy & hold baseline, on BTC and ETH daily.
if (!synthetic) {
    const pick = ranking.slice(0, 3).map((r) => r.strategy);
    const accounts = [];
    for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
        const sec = sections.find((s) => s.symbol === symbol && s.interval === '1d');
        if (!sec) continue;
        for (const strategy of ['buyHold', ...pick]) {
            const r = sec.results.find((x) => x.strategy === strategy);
            accounts.push({ id: `${symbol}-1d-${strategy}`, symbol, interval: '1d', strategy, label: STRATEGIES[strategy].label, params: r?.windows.at(-1)?.params ?? {} });
        }
    }
    mkdirSync('paper', { recursive: true });
    writeFileSync('paper/config.suggested.json', JSON.stringify({ accounts }, null, 2));
    console.log('\nEhdotus paperitreidaukseen: paper/config.suggested.json');
}
console.log('\nParemmuusjärjestys:');
console.table(ranking.map((r) => ({ strategia: r.label, voittaa: `${r.beats}/${r.total}`, sharpe: r.avgSharpe?.toFixed(2), pudotus: r.avgMaxDd?.toFixed(1) })));
console.log('\nRaportti: reports/report.html (avaa selaimessa)');
