// Technical indicators. All return arrays aligned with the input; values that need more history are null.
// Every value at index i uses only data up to and including i (no look-ahead).

export function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= n) sum -= values[i - n];
        if (i >= n - 1) out[i] = sum / n;
    }
    return out;
}

export function ema(values, n) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (n + 1);
    let prev = null;
    let seed = 0;
    for (let i = 0; i < values.length; i++) {
        if (i < n - 1) { seed += values[i]; continue; }
        if (i === n - 1) { seed += values[i]; prev = seed / n; out[i] = prev; continue; }
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

/** Wilder's RSI */
export function rsi(values, n = 14) {
    const out = new Array(values.length).fill(null);
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < values.length; i++) {
        const ch = values[i] - values[i - 1];
        const g = Math.max(ch, 0);
        const l = Math.max(-ch, 0);
        if (i <= n) {
            gain += g; loss += l;
            if (i === n) { gain /= n; loss /= n; out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss); }
        } else {
            gain = (gain * (n - 1) + g) / n;
            loss = (loss * (n - 1) + l) / n;
            out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
        }
    }
    return out;
}

/** Average True Range (Wilder) */
export function atr(bars, n = 14) {
    const out = new Array(bars.length).fill(null);
    let prev = null;
    let sum = 0;
    for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const tr = i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close));
        if (i < n) { sum += tr; if (i === n - 1) { prev = sum / n; out[i] = prev; } continue; }
        prev = (prev * (n - 1) + tr) / n;
        out[i] = prev;
    }
    return out;
}

export function stdev(values, n) {
    const out = new Array(values.length).fill(null);
    for (let i = n - 1; i < values.length; i++) {
        let m = 0;
        for (let j = i - n + 1; j <= i; j++) m += values[j];
        m /= n;
        let v = 0;
        for (let j = i - n + 1; j <= i; j++) v += (values[j] - m) ** 2;
        out[i] = Math.sqrt(v / n);
    }
    return out;
}

/** Highest high / lowest low of the previous n bars (excluding the current bar). */
export function donchian(bars, n) {
    const upper = new Array(bars.length).fill(null);
    const lower = new Array(bars.length).fill(null);
    for (let i = n; i < bars.length; i++) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - n; j < i; j++) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); }
        upper[i] = hi;
        lower[i] = lo;
    }
    return { upper, lower };
}

/** Log returns, first element null. */
export function logReturns(values) {
    return values.map((v, i) => (i === 0 ? null : Math.log(v / values[i - 1])));
}

/** Rolling realised volatility of log returns over n bars. */
export function realizedVol(values, n) {
    const r = logReturns(values).map((x) => x ?? 0);
    return stdev(r, n).map((x, i) => (i < n ? null : x));
}
