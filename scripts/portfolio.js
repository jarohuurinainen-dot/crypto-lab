// Portfolio comparison on real data. Usage: npm run portfolio
// Compares single sleeves, an equal-weight book of the paper-trading strategies and two risk overlays, against buy & hold.
// Out-of-sample window = after the first 2 years (same start as the walk-forward and robust tests).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runPortfolio, basketBuyHold } from '../src/portfolio.js';
import { loadBars } from '../src/data.js';

const config = JSON.parse(readFileSync('paper/config.json', 'utf8'));
const sleeves = config.accounts.filter((a) => a.interval === '1d' && a.strategy !== 'buyHold').map((a) => ({ id: a.id, symbol: a.symbol, strategy: a.strategy, params: a.params }));
const symbols = [...new Set(sleeves.map((s) => s.symbol))];
const data = Object.fromEntries(symbols.map((s) => [s, loadBars('data', s, '1d')]));
for (const s of symbols) if (data[s].length < 900) { console.log(`${s}: ei dataa, aja ensin npm run data`); process.exit(1); }
const from = 730;
const O = { from, barsPerYear: 365 };

const variants = [
    ['BTC osta ja pidä', runPortfolio(data, [{ symbol: 'BTCUSDT', strategy: 'buyHold', params: {} }], O)],
    ['ETH osta ja pidä', runPortfolio(data, [{ symbol: 'ETHUSDT', strategy: 'buyHold', params: {} }], O)],
    ['BTC+ETH osta ja pidä (50/50)', basketBuyHold(data, symbols, O)],
    [`Kirja: ${sleeves.length} strategiaa tasapainossa`, runPortfolio(data, sleeves, O)],
    ['Kirja + volatiliteettitavoite 30 %', runPortfolio(data, sleeves, { ...O, targetVol: 0.3 })],
    ['Kirja + markkinasuodatin (BTC > 200 pv ka.)', runPortfolio(data, sleeves, { ...O, regime: { symbol: 'BTCUSDT', len: 200 } })],
    ['Kirja + molemmat', runPortfolio(data, sleeves, { ...O, targetVol: 0.3, regime: { symbol: 'BTCUSDT', len: 200 } })],
];
const rows = variants.map(([name, p]) => ({ nimi: name, vuosituotto: p.metrics.cagrPct, pahinPudotus: p.metrics.maxDrawdownPct, sharpe: p.metrics.sharpe, calmar: p.metrics.calmar, markkinassa: p.metrics.exposurePct }));
console.table(rows);
console.log('\nYksittäiset strategiat kirjassa:');
console.table(variants[3][1].sleeves.map((s) => ({ strategia: s.id, vuosituotto: s.metrics.cagrPct, pahinPudotus: s.metrics.maxDrawdownPct, sharpe: s.metrics.sharpe })));
mkdirSync('reports', { recursive: true });
writeFileSync('reports/portfolio.json', JSON.stringify({ from: 'ensimmäisten 2 vuoden jälkeen', rows, sleeves: variants[3][1].sleeves }, null, 2));
console.log('\nHuom: strategiat on valittu samasta datasta, joten kirjan tulos on optimistinen. Aito testi on paperibotin tulos jatkossa.');
