// Paper-trading engine. Runs on a schedule (GitHub Actions). Each strategy has its own virtual account.
// On every run: replay the strategy over the full history to get today's target position (deterministic),
// then trade the virtual account toward it at the latest close, with fees. Idempotent per bar.
import { STRATEGIES, makeContext } from './strategies.js';
import { DEFAULT_COSTS } from './backtest.js';

const clamp = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Target position at the close of the LAST bar. */
export function currentTarget(bars, strategy, params, barsPerYear) {
    const ctx = makeContext(strategy, bars, params, barsPerYear);
    let pos = 0;
    for (let i = 0; i < bars.length; i++) pos = clamp(STRATEGIES[strategy].target(ctx, i, pos));
    return pos;
}

export function newAccount(id, cfg, startEquity = 1000) {
    return { id, ...cfg, cash: startEquity, units: 0, startEquity, lastBarTime: null, history: [], trades: [] };
}

/**
 * Advance one account with new bars. Returns { account, trade|null }.
 * cfg: { symbol, interval, strategy, params }
 */
export function stepAccount(account, bars, { costs = DEFAULT_COSTS, barsPerYear = 365, minRebalance = 0.05 } = {}) {
    const last = bars.at(-1);
    if (!last) return { account, trade: null };
    if (account.lastBarTime === last.time) return { account, trade: null }; // already processed this bar
    const target = currentTarget(bars, account.strategy, account.params, barsPerYear);
    const px = last.close;
    const eq = account.cash + account.units * px;
    const cur = eq > 0 ? (account.units * px) / eq : 0;
    let trade = null;
    if (Math.abs(target - cur) >= minRebalance || (target === 0 && account.units > 0)) {
        const delta = target * eq - account.units * px;
        const rate = costs.fee + costs.slippage;
        if (delta > 0) {
            const spend = Math.min(delta, account.cash);
            account.units += (spend * (1 - rate)) / px;
            account.cash -= spend;
            trade = { time: last.time, side: 'BUY', price: px, value: round(spend), fee: round(spend * rate) };
        } else if (delta < 0) {
            const u = Math.min(account.units, -delta / px);
            const gross = u * px;
            account.units -= u;
            account.cash += gross * (1 - rate);
            trade = { time: last.time, side: 'SELL', price: px, value: round(gross), fee: round(gross * rate) };
        }
        if (trade) account.trades.push(trade);
    }
    account.lastBarTime = last.time;
    const equity = account.cash + account.units * px;
    account.history.push({ time: last.time, equity: round(equity), price: px, position: round(target) });
    if (account.history.length > 5000) account.history.splice(0, account.history.length - 5000);
    return { account, trade };
}

const round = (x) => Math.round(x * 100) / 100;

export function accountSummary(a) {
    const last = a.history.at(-1);
    const first = a.history[0];
    const eq = last?.equity ?? a.startEquity;
    const bh = first && last ? a.startEquity * (last.price / first.price) : a.startEquity;
    let peak = a.startEquity;
    let dd = 0;
    for (const h of a.history) { peak = Math.max(peak, h.equity); dd = Math.max(dd, 1 - h.equity / peak); }
    return {
        id: a.id, symbol: a.symbol, interval: a.interval, strategy: a.strategy, params: a.params,
        equity: round(eq), returnPct: round((eq / a.startEquity - 1) * 100),
        buyHoldReturnPct: round((bh / a.startEquity - 1) * 100),
        maxDrawdownPct: round(dd * 100), position: last?.position ?? 0, trades: a.trades.length,
        since: first ? new Date(first.time).toISOString().slice(0, 10) : null,
    };
}
