#!/usr/bin/env node
// Keyless market snapshot collector for the daily-news-briefing skill.
// Zero dependencies. Usage:
//   node collect-markets.mjs [--out FILE] [--instruments a,b,c] [--timeout MS]
// Prints JSON: { generatedAt, timezone, instruments: [...] }

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const YAHOO = {
  sp500:  { symbol: '^GSPC',     label: 'S&P 500',            group: 'US equities',     region: 'global' },
  nasdaq: { symbol: '^IXIC',     label: 'Nasdaq',             group: 'US equities',     region: 'global' },
  dow:    { symbol: '^DJI',      label: 'Dow',                group: 'US equities',     region: 'global' },
  ftse:   { symbol: '^FTSE',     label: 'FTSE 100',           group: 'Europe equities', region: 'global' },
  dax:    { symbol: '^GDAXI',    label: 'DAX',                group: 'Europe equities', region: 'global' },
  cac:    { symbol: '^FCHI',     label: 'CAC 40',             group: 'Europe equities', region: 'global' },
  nikkei: { symbol: '^N225',     label: 'Nikkei 225',         group: 'Asia equities',   region: 'global' },
  kospi:  { symbol: '^KS11',     label: 'KOSPI',              group: 'Asia equities',   region: 'global' },
  hsi:    { symbol: '^HSI',      label: 'Hang Seng',          group: 'Asia equities',   region: 'global' },
  csi300: { symbol: '000300.SS', label: 'CSI 300',            group: 'China equities',  region: 'china' },
  sse:    { symbol: '000001.SS', label: 'Shanghai Composite', group: 'China equities',  region: 'china' },
  szse:   { symbol: '399001.SZ', label: 'Shenzhen Component', group: 'China equities',  region: 'china' },
  dxy:    { symbol: 'DX-Y.NYB',  label: 'US Dollar Index',    group: 'FX',              region: 'global' },
  eurusd: { symbol: 'EURUSD=X',  label: 'EUR/USD',            group: 'FX',              region: 'global' },
  usdjpy: { symbol: 'JPY=X',     label: 'USD/JPY',            group: 'FX',              region: 'global' },
  usdcny: { symbol: 'CNY=X',     label: 'USD/CNY',            group: 'FX',              region: 'global' },
  brent:  { symbol: 'BZ=F',      label: 'Brent crude',        group: 'Commodities',     region: 'global' },
  wti:    { symbol: 'CL=F',      label: 'WTI crude',          group: 'Commodities',     region: 'global' },
  gold:   { symbol: 'GC=F',      label: 'Gold',               group: 'Commodities',     region: 'global' },
  copper: { symbol: 'HG=F',      label: 'Copper',             group: 'Commodities',     region: 'global' },
  ust10y: { symbol: '^TNX',      label: '10Y US Treasury',    group: 'Bonds',           region: 'global', kind: 'yield' },
};

// Eastmoney bond yields. f1 is the decimal exponent, f2 the scaled value.
const EASTMONEY = {
  cgb10y: { secid: '171.CN10Y', label: '10Y China govt bond', group: 'Bonds', region: 'china', kind: 'yield' },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function message(err) {
  return String((err && err.message) || err);
}

function curlJson(url, ms) {
  const seconds = String(Math.max(5, Math.ceil(ms / 1000)));
  const out = execFileSync('curl', ['-sS', '-m', seconds, '-H', 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) daily-news-briefing', url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(out);
}

// Some hosts (for example push2.eastmoney.com) reject Node fetch with
// "other side closed" but accept curl, so every request falls back to curl
// before it is reported unavailable.
async function getJson(url, ms) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) daily-news-briefing' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    try {
      return curlJson(url, ms);
    } catch (err2) {
      throw new Error('fetch: ' + message(err) + '; curl: ' + message(err2));
    }
  }
}

async function fromYahoo(id, def, ms) {
  const base = { id, label: def.label, group: def.group, region: def.region, symbol: def.symbol, source: 'yahoo' };
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(def.symbol) + '?range=1d&interval=1d';
  try {
    const json = await getJson(url, ms);
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    const meta = result && result.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('no price in response');
    const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;
    const pct = typeof meta.regularMarketChangePercent === 'number' ? meta.regularMarketChangePercent : null;
    // A yield moves in percentage points; express that move in basis points (1 point = 100 bp).
    let changeBp = null;
    if (def.kind === 'yield' && pct !== null && pct !== -100) {
      const previous = meta.regularMarketPrice / (1 + pct / 100);
      changeBp = Math.round((meta.regularMarketPrice - previous) * 100 * 100) / 100;
    }
    return Object.assign(base, {
      value: meta.regularMarketPrice,
      changePct: pct,
      changeBp,
      currency: meta.currency || null,
      asOf,
      status: 'ok',
    });
  } catch (err) {
    return Object.assign(base, { value: null, changePct: null, changeBp: null, currency: null, asOf: null, status: 'unavailable', reason: String((err && err.message) || err) });
  }
}

async function fromEastmoney(id, def, ms) {
  const base = { id, label: def.label, group: def.group, region: def.region, symbol: def.secid, source: 'eastmoney' };
  // push2delay is reliable; push2.eastmoney.com rejects Node and intermittently drops curl.
  const url = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=' + encodeURIComponent(def.secid) + '&fields=f1,f2,f3,f4,f12,f14';
  try {
    const json = await getJson(url, ms);
    const row = json && json.data && json.data.diff && json.data.diff[0];
    if (!row || typeof row.f2 !== 'number') throw new Error('no quote in response');
    const scale = typeof row.f1 === 'number' ? Math.pow(10, row.f1) : 10000;
    // f3 is the relative change scaled by 100; f4 is the absolute move scaled by f1.
    const changePct = typeof row.f3 === 'number' ? row.f3 / 100 : null;
    const changeBp = typeof row.f4 === 'number' ? Math.round((row.f4 / scale) * 100 * 100) / 100 : null;
    return Object.assign(base, {
      value: row.f2 / scale,
      changePct,
      changeBp,
      currency: 'CNY',
      asOf: new Date().toISOString(),
      asOfNote: 'value read at fetch time',
      status: 'ok',
    });
  } catch (err) {
    return Object.assign(base, { value: null, changePct: null, changeBp: null, currency: null, asOf: null, status: 'unavailable', reason: String((err && err.message) || err) });
  }
}

async function main() {
  const ms = Number(arg('--timeout', '20000'));
  const out = arg('--out', '');
  const selected = arg('--instruments', '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = selected.length ? selected : Object.keys(YAHOO).concat(Object.keys(EASTMONEY));
  const tasks = [];
  for (const id of ids) {
    if (YAHOO[id]) tasks.push(fromYahoo(id, YAHOO[id], ms));
    else if (EASTMONEY[id]) tasks.push(fromEastmoney(id, EASTMONEY[id], ms));
  }
  const instruments = await Promise.all(tasks);
  const payload = {
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    ok: instruments.filter((i) => i.status === 'ok').length,
    unavailable: instruments.filter((i) => i.status !== 'ok').length,
    instruments,
  };
  const text = JSON.stringify(payload, null, 2);
  if (out) writeFileSync(out, text + '\n');
  else process.stdout.write(text + '\n');
}

main().catch((err) => {
  process.stderr.write('collect-markets: ' + String((err && err.message) || err) + '\n');
  process.exit(1);
});
