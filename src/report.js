// HTML reports (self-contained, Finnish UI, light/dark).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(d).replace('.', ','));
const VERDICT = { beats: 'Voittaa', safer: 'Turvallisempi', worse: 'Häviää', baseline: 'Vertailu', 'n/a': '–' };
const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4b5563'];

const STYLE = `:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#fff;--good:#15803d;--bad:#b91c1c;--warn:#a16207}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--good:#4ade80;--bad:#f87171;--warn:#facc15}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px}main{max-width:1100px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}p.muted,.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%;background:var(--card);font-size:13.5px}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}td.muted{white-space:normal;text-align:left;max-width:220px;font-size:12px}.wrap{overflow-x:auto}.beats{color:var(--good);font-weight:600}.worse{color:var(--bad)}.safer{color:var(--warn)}
svg{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}.legend span{display:inline-block;margin-right:12px;font-size:13px}
.box{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}`;

/** SVG line chart of several equity curves, log scale, normalised to 100. */
export function equityChart(series, { width = 1000, height = 300 } = {}) {
    const all = series.flatMap((s) => s.points.map((p) => p.time));
    if (!all.length) return '';
    const t0 = Math.min(...all);
    const t1 = Math.max(...all);
    const vals = series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => v > 0);
    const lo = Math.log(Math.min(...vals));
    const hi = Math.log(Math.max(...vals));
    const X = (t) => 50 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 70);
    const Y = (v) => height - 30 - ((Math.log(v) - lo) / Math.max(1e-9, hi - lo)) * (height - 50);
    const paths = series.map((s, k) => {
        const d = s.points.filter((p) => p.value > 0).map((p, i) => `${i ? 'L' : 'M'}${X(p.time).toFixed(1)} ${Y(p.value).toFixed(1)}`).join('');
        return `<path d="${d}" fill="none" stroke="${s.color ?? COLORS[k % COLORS.length]}" stroke-width="${s.bold ? 2.2 : 1.3}"/>`;
    }).join('');
    const years = [];
    for (let y = new Date(t0).getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= t1; y++) years.push(y);
    const grid = years.map((y) => `<line x1="${X(Date.UTC(y, 0, 1))}" x2="${X(Date.UTC(y, 0, 1))}" y1="10" y2="${height - 30}" stroke="currentColor" opacity=".12"/><text x="${X(Date.UTC(y, 0, 1))}" y="${height - 10}" font-size="12" text-anchor="middle" fill="currentColor" opacity=".6">${y}</text>`).join('');
    const ticks = [0.5, 1, 2, 5, 10, 20].map((m) => 100 * m).filter((v) => Math.log(v) >= lo && Math.log(v) <= hi)
        .map((v) => `<text x="44" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="currentColor" opacity=".6">${v}</text><line x1="50" x2="${width - 20}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".08"/>`).join('');
    const legend = series.map((s, k) => `<span style="color:${s.color ?? COLORS[k % COLORS.length]}">━ ${esc(s.name)}</span>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Pääoman kehitys" style="color:var(--fg)">${grid}${ticks}${paths}</svg><div class="legend">${legend}</div>`;
}

const normalise = (equity) => {
    const base = equity[0]?.equity || 1;
    return equity.filter((_, i) => i % Math.ceil(equity.length / 600 || 1) === 0 || i === equity.length - 1).map((e) => ({ time: e.time, value: (e.equity / base) * 100 }));
};

export function backtestReport({ generatedAt, synthetic, costs, sections, ranking }) {
    const body = sections.map((sec) => {
        const rows = sec.results.slice().sort((a, b) => (b.metrics?.sharpe ?? -9) - (a.metrics?.sharpe ?? -9)).map((r) => `<tr>
<td>${esc(r.label)}</td><td class="${r.verdict}">${VERDICT[r.verdict] ?? r.verdict}</td><td>${fmt(r.metrics?.cagrPct)} %</td><td>${fmt(r.metrics?.maxDrawdownPct)} %</td>
<td>${fmt(r.metrics?.sharpe, 2)}</td><td>${fmt(r.metrics?.calmar, 2)}</td><td>${fmt(r.metrics?.exposurePct, 0)} %</td><td>${r.metrics?.trades ?? '–'}</td><td class="muted">${esc(JSON.stringify(r.windows.at(-1)?.params ?? {}))}</td></tr>`).join('');
        const top = sec.results.filter((r) => r.strategy === 'buyHold' || r.verdict === 'beats').slice(0, 6);
        const chart = equityChart(top.map((r) => ({ name: r.label, points: normalise(r.equity), bold: r.strategy === 'buyHold', color: r.strategy === 'buyHold' ? '#78716c' : undefined })));
        return `<h2>${esc(sec.symbol)} · ${esc(sec.interval)} <span class="muted">(${esc(sec.period)})</span></h2>
<div class="wrap"><table><thead><tr><th>Strategia</th><th>Tulos</th><th>Vuosituotto</th><th>Suurin pudotus</th><th>Sharpe</th><th>Calmar</th><th>Markkinassa</th><th>Kauppoja</th><th>Viimeisin parametri</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted">Kuvassa osta ja pidä (harmaa) ja strategiat, jotka voittivat sen. Asteikko on logaritminen, ja alkupääoma on 100.</p>${chart}`;
    }).join('');
    const rank = ranking.map((r, i) => `<tr><td>${i + 1}. ${esc(r.label)}</td><td>${r.beats} / ${r.total}</td><td>${fmt(r.avgSharpe, 2)}</td><td>${fmt(r.avgMaxDd)} %</td><td>${fmt(r.avgCagr)} %</td></tr>`).join('');
    return `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kryptostrategioiden vertailu</title><style>${STYLE}</style></head><body><main>
<h1>Kryptostrategioiden vertailu</h1><p class="muted">Luotu ${esc(generatedAt)}. ${synthetic ? '<b>HUOM: keinotekoinen testidata, ei oikeita hintoja.</b> ' : ''}Kaupankäyntikulut ${fmt((costs.fee + costs.slippage) * 100, 2)} % per kauppa.</p>
<div class="box"><b>Näin tätä luetaan.</b> Kaikki luvut ovat walk-forward-testistä: parametrit valittiin aina vain <i>aiemman</i> datan perusteella, ja tulos mitattiin sen jälkeisellä jaksolla, jota strategia ei ollut nähnyt. <b>Voittaa</b> tarkoittaa, että strategialla oli parempi Sharpe <i>ja</i> pienempi suurin pudotus kuin osta ja pidä -sijoittamisella. <b>Turvallisempi</b> tarkoittaa selvästi pienempää pudotusta, mutta myös hieman heikompaa tuottoa.</div>
<h2>Paremmuusjärjestys kaikilla kolikoilla</h2><div class="wrap"><table><thead><tr><th>Strategia</th><th>Voittaa osta ja pidä</th><th>Sharpe ka.</th><th>Pudotus ka.</th><th>Vuosituotto ka.</th></tr></thead><tbody>${rank}</tbody></table></div>
${body}</main></body></html>`;
}

export function paperDashboard({ updatedAt, accounts }) {
    const rows = accounts.map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.symbol)} ${esc(a.interval)}</td><td>${fmt(a.equity, 2)}</td><td class="${a.returnPct >= a.buyHoldReturnPct ? 'beats' : 'worse'}">${fmt(a.returnPct)} %</td><td>${fmt(a.buyHoldReturnPct)} %</td><td>${fmt(a.maxDrawdownPct)} %</td><td>${fmt(a.position * 100, 0)} %</td><td>${a.trades}</td><td>${esc(a.since)}</td></tr>`).join('');
    const charts = accounts.length ? equityChart(accounts.map((a) => ({ name: `${a.label} (${a.symbol})`, points: (a.history ?? []).map((h) => ({ time: h.time, value: (h.equity / (a.history[0]?.equity || 1)) * 100 })) }))) : '';
    return `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paperitreidaus</title><style>${STYLE}</style></head><body><main>
<h1>Paperitreidaus</h1><p class="muted">Päivitetty ${esc(updatedAt)}. Virtuaalinen raha (1 000 $ per strategia), kulut mukana. Ei oikeita kauppoja.</p>
<div class="wrap"><table><thead><tr><th>Strategia</th><th>Kohde</th><th>Pääoma $</th><th>Tuotto</th><th>Osta ja pidä</th><th>Suurin pudotus</th><th>Nyt markkinassa</th><th>Kauppoja</th><th>Alkaen</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Pääoman kehitys</h2>${charts}</main></body></html>`;
}
