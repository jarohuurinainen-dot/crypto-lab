// Kova testi paperitreidauksen strategioille. Ajo: npm run validate
//  1) Deflated Sharpe: voittaako strategia sen, mitä PARAS kaikista kokeilluista strategioista näyttäisi pelkällä tuurilla?
//  2) Parametrien ympäristö: toimiiko strategia vielä, kun asetuksia nytkäytetään -25 ... +25 %?
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runBacktest } from '../src/backtest.js';
import { loadBars } from '../src/data.js';
import { allTrials, deflatedSharpe, neighborhood, returnsOf } from '../src/validation.js';

const config = JSON.parse(readFileSync('paper/config.json', 'utf8'));
const accounts = config.accounts.filter((a) => a.interval === '1d' && a.strategy !== 'buyHold');
const from = 730;
const O = { from, barsPerYear: 365 };
const trialsBySymbol = {};
const out = [];
for (const a of accounts) {
    const bars = loadBars('data', a.symbol, '1d');
    if (bars.length < 900) { console.log(`${a.symbol}: ei dataa, aja ensin npm run data`); process.exit(1); }
    trialsBySymbol[a.symbol] ??= allTrials(bars, O);
    const trials = trialsBySymbol[a.symbol];
    const run = runBacktest(bars, a.strategy, a.params, O);
    const d = deflatedSharpe(returnsOf(run.equity), trials.map((t) => t.sharpePeriod), 365);
    const nb = neighborhood(bars, a.strategy, a.params, O);
    const verdict = d.dsr >= 0.95 && nb.worstDropPct != null && nb.worstDropPct < 40 ? 'KESTÄÄ' : d.dsr >= 0.8 && (nb.worstDropPct ?? 100) < 50 ? 'ehkä' : 'EPÄVARMA';
    out.push({ tili: a.id, sharpe: d.sharpeAnnual, kokeiltuja: d.trials, tuuriRaja: d.sr0Annual, dsr: d.dsr, naapurienHuonoin: nb.min, naapurienMediaani: nb.median, pudotusPros: nb.worstDropPct, tulos: verdict });
}
console.table(out);
mkdirSync('reports', { recursive: true });
writeFileSync('reports/validate.json', JSON.stringify(out, null, 2));
console.log('\ndsr = todennäköisyys, että aito Sharpe on suurempi kuin paras tuurilla löydetty (0,95+ on hyvä).');
console.log('tuuriRaja = Sharpe, jonka paras kokeilluista strategioista saisi pelkällä tuurilla.');
console.log('pudotusPros = kuinka paljon Sharpe laskee huonoimmalla naapuriasetuksella (alle 40 % on hyvä, eli tasanne eikä piikki).');
