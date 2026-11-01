// Paper-trading run (GitHub Actions calls this on a schedule). Usage: npm run paper
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { updateBars, loadBars, INTERVAL_MS } from '../src/data.js';
import { newAccount, stepAccount, accountSummary } from '../src/paper.js';
import { barsPerYear } from '../src/backtest.js';
import { paperDashboard } from '../src/report.js';
import { HISTORY_START } from './config.js';

const read = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const config = read('paper/config.json', null) ?? read('paper/config.suggested.json', null) ?? {
    accounts: [
        { id: 'BTCUSDT-1d-buyHold', symbol: 'BTCUSDT', interval: '1d', strategy: 'buyHold', label: 'Osta ja pidä', params: {} },
        { id: 'BTCUSDT-1d-smaCross', symbol: 'BTCUSDT', interval: '1d', strategy: 'smaCross', label: 'SMA 50/200', params: { fast: 50, slow: 200 } },
        { id: 'BTCUSDT-1d-donchian', symbol: 'BTCUSDT', interval: '1d', strategy: 'donchianBreakout', label: 'Donchian 55/20', params: { entry: 55, exit: 20 } },
    ],
};
const state = read('paper/state.json', { accounts: {} });

// Update the data each account needs (only the missing bars are downloaded).
const needed = [...new Set(config.accounts.map((a) => `${a.symbol}|${a.interval}`))];
for (const k of needed) {
    const [symbol, interval] = k.split('|');
    try {
        const { added } = await updateBars('data', symbol, interval, HISTORY_START[interval]);
        console.log(`${symbol} ${interval}: +${added} kynttilää`);
    } catch (e) { console.log(`${symbol} ${interval}: datan haku epäonnistui (${e.message}), käytetään tallennettua`); }
}

const summaries = [];
for (const cfg of config.accounts) {
    const acc = state.accounts[cfg.id] ?? newAccount(cfg.id, cfg);
    Object.assign(acc, { symbol: cfg.symbol, interval: cfg.interval, strategy: cfg.strategy, params: cfg.params, label: cfg.label });
    const bars = loadBars('data', cfg.symbol, cfg.interval);
    const { trade } = stepAccount(acc, bars, { barsPerYear: barsPerYear(INTERVAL_MS[cfg.interval]) });
    if (trade) console.log(`${cfg.id}: ${trade.side} ${trade.value} $ hintaan ${trade.price}`);
    state.accounts[cfg.id] = acc;
    summaries.push({ ...accountSummary(acc), label: cfg.label, history: acc.history.slice(-1500) });
}
mkdirSync('paper', { recursive: true });
mkdirSync('docs', { recursive: true });
writeFileSync('paper/state.json', JSON.stringify(state));
writeFileSync('docs/index.html', paperDashboard({ updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', accounts: summaries }));
console.table(summaries.map(({ history, params, ...s }) => s));
