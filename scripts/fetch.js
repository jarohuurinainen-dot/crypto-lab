// Download history from Binance public market data (no account, no key). Usage: npm run data
import { updateBars } from '../src/data.js';
import { SYMBOLS, INTERVALS, HISTORY_START } from './config.js';

for (const interval of INTERVALS) {
    for (const symbol of SYMBOLS) {
        process.stdout.write(`${symbol} ${interval} ... `);
        try {
            const { bars, added } = await updateBars('data', symbol, interval, HISTORY_START[interval]);
            const first = bars[0] ? new Date(bars[0].time).toISOString().slice(0, 10) : '-';
            console.log(`${bars.length} kynttilää (${added} uutta), alkaen ${first}`);
        } catch (e) {
            console.log(`VIRHE: ${e.message}`);
        }
    }
}
console.log('\nValmis. Seuraavaksi: npm run backtest');
