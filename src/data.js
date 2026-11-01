// Market data: Binance public market-data API (no key needed). data-api.binance.vision serves market data
// from all regions (incl. GitHub Actions' US runners, where api.binance.com is blocked).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const INTERVAL_MS = { '1h': 3600e3, '4h': 4 * 3600e3, '1d': 24 * 3600e3 };
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseKline(k) {
    return { time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] };
}

async function getJson(path, fetchImpl) {
    let lastErr;
    for (const host of HOSTS) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetchImpl(host + path, { headers: { accept: 'application/json' } });
                if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
                if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
                return await res.json();
            } catch (e) { lastErr = e; await sleep(500); }
        }
    }
    throw lastErr ?? new Error('market data unavailable');
}

/** All closed klines from startMs until now. */
export async function fetchKlines(symbol, interval, startMs, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
    const out = [];
    let from = startMs;
    for (let guard = 0; guard < 500; guard++) {
        const rows = await getJson(`/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&limit=1000`, fetchImpl);
        if (!Array.isArray(rows) || !rows.length) break;
        for (const k of rows) { const b = parseKline(k); if (b.closeTime < now) out.push(b); }
        const last = rows.at(-1)[0];
        if (rows.length < 1000 || last <= from) break;
        from = last + INTERVAL_MS[interval];
        await sleep(150);
    }
    // de-duplicate + sort
    const seen = new Set();
    return out.filter((b) => (seen.has(b.time) ? false : (seen.add(b.time), true))).sort((a, b) => a.time - b.time);
}

export const dataPath = (dir, symbol, interval) => `${dir}/${symbol}_${interval}.json`;

export function loadBars(dir, symbol, interval) {
    const p = dataPath(dir, symbol, interval);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

export function saveBars(dir, symbol, interval, bars) {
    const p = dataPath(dir, symbol, interval);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(bars));
}

/** Fetch only what is missing since the last saved bar. */
export async function updateBars(dir, symbol, interval, startMs, opts) {
    const have = loadBars(dir, symbol, interval);
    const from = have.length ? have.at(-1).time + INTERVAL_MS[interval] : startMs;
    const fresh = await fetchKlines(symbol, interval, from, opts);
    const merged = [...have, ...fresh];
    saveBars(dir, symbol, interval, merged);
    return { bars: merged, added: fresh.length };
}

/**
 * Synthetic market for tests/demo: geometric random walk with regimes (bull, bear, sideways) and fat tails.
 * Deterministic for a seed. NOT real data - only to check that the machinery works.
 */
export function syntheticBars({ n = 2000, seed = 42, start = Date.UTC(2019, 0, 1), intervalMs = INTERVAL_MS['1d'], startPrice = 4000 } = {}) {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const gauss = () => { const u = Math.max(1e-12, rnd()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const regimes = [{ mu: 0.003, vol: 0.035 }, { mu: -0.0025, vol: 0.045 }, { mu: 0, vol: 0.025 }];
    let reg = 0;
    let p = startPrice;
    const bars = [];
    for (let i = 0; i < n; i++) {
        if (rnd() < 0.01) reg = Math.floor(rnd() * regimes.length);
        const { mu, vol } = regimes[reg];
        const shock = gauss() * (rnd() < 0.05 ? 2.5 : 1);
        const open = p;
        const close = open * Math.exp(mu + vol * shock);
        const high = Math.max(open, close) * (1 + Math.abs(gauss()) * vol * 0.4);
        const low = Math.min(open, close) * (1 - Math.abs(gauss()) * vol * 0.4);
        bars.push({ time: start + i * intervalMs, open, high, low, close, volume: 1000 + rnd() * 1000, closeTime: start + (i + 1) * intervalMs - 1 });
        p = close;
    }
    return bars;
}
