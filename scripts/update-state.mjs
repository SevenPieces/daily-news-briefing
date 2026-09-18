#!/usr/bin/env node
// Continuity and coverage-window logic for the daily-news-briefing skill.
// Zero dependencies. Usage:
//   node update-state.mjs plan   --state FILE
//   node update-state.mjs update --state FILE --items FILE [--out FILE] [--date YYYY-MM-DD]
//
// Window rule (never prompts):
//   previous briefing exists -> from its timestamp to now, capped at 72h
//   no previous briefing     -> the latest 24h

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const MAX_WINDOW_HOURS = 72;
const FIRST_RUN_HOURS = 24;
const RETENTION_DAYS = 7;
const HOUR = 3600000;
const DAY = 86400000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// The window label is human-facing and the briefing header declares
// Asia/Shanghai, so stamp in that zone. Using an explicit formatter keeps the
// label consistent with the coverage note that cites the same window (the old
// toISOString() form printed UTC and disagreed with it). Hour '24' is
// normalised to '00' for engines that emit it at midnight.
const LABEL_TZ = 'Asia/Shanghai';
const labelFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: LABEL_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function stamp(date) {
  const parts = {};
  for (const p of labelFormat.formatToParts(date)) parts[p.type] = p.value;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + hour + ':' + parts.minute;
}

function normalizeTitle(text) {
  let out = '';
  for (const ch of String(text || '').toLowerCase()) {
    if (ch.trim() === '') { out += ' '; continue; }
    const code = ch.codePointAt(0);
    const ascii = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    const cjk = code >= 0x4e00 && code <= 0x9fff;
    out += ascii || cjk ? ch : ' ';
  }
  return out.split(' ').filter(Boolean).join(' ');
}

function hostOf(url) {
  try {
    let host = new URL(url).host;
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch (err) {
    return '';
  }
}

function keyOf(title, url) {
  const seed = normalizeTitle(title) + '|' + hostOf(url);
  return createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

function planWindow(previousAt, now) {
  const previous = previousAt ? new Date(previousAt) : null;
  const valid = previous && !Number.isNaN(previous.getTime());
  let since;
  let capped = false;
  let gapHours = null;
  if (valid) {
    const floor = new Date(now.getTime() - MAX_WINDOW_HOURS * HOUR);
    since = previous > floor ? previous : floor;
    capped = previous < floor;
    gapHours = round1((now.getTime() - previous.getTime()) / HOUR);
  } else {
    since = new Date(now.getTime() - FIRST_RUN_HOURS * HOUR);
  }
  const hours = round1((now.getTime() - since.getTime()) / HOUR);
  const tail = ' (' + stamp(since) + ' -> ' + stamp(now) + ' ' + LABEL_TZ + ')';
  let label;
  if (valid) {
    label = 'Last briefing ' + stamp(previous).slice(0, 10) + ' - covering latest ' + hours + 'h' + tail;
    if (capped) label += ' - ' + Math.round(gapHours - hours) + 'h not covered';
  } else {
    label = 'No previous briefing - covering latest ' + hours + 'h' + tail;
  }
  return {
    since: since.toISOString(),
    until: now.toISOString(),
    hours,
    capped,
    gapHours,
    uncoveredHours: capped ? round1(gapHours - hours) : 0,
    previousBriefingAt: valid ? previous.toISOString() : null,
    maxWindowHours: MAX_WINDOW_HOURS,
    firstRunHours: FIRST_RUN_HOURS,
    label,
  };
}

function main() {
  const command = process.argv[2];
  const statePath = arg('--state', 'briefing-state.json');
  const state = readJson(statePath, { version: 1, items: {}, watchlist: [] });
  const now = new Date();

  if (command === 'plan') {
    process.stdout.write(JSON.stringify({ command: 'plan', statePath, window: planWindow(state.lastBriefingAt, now) }, null, 2) + '\n');
    return;
  }

  if (command !== 'update') {
    process.stderr.write('usage: update-state.mjs plan|update --state FILE [--items FILE] [--out FILE]\n');
    process.exit(1);
  }

  const itemsPath = arg('--items', '');
  if (!itemsPath) {
    process.stderr.write('update-state: update requires --items FILE\n');
    process.exit(1);
  }
  const incoming = readJson(itemsPath, []);
  const nowIso = now.toISOString();
  const previousItems = state.items && typeof state.items === 'object' ? state.items : {};
  const next = {};
  const results = [];

  for (const item of incoming) {
    const key = keyOf(item.title, item.primaryUrl);
    const before = previousItems[key];
    const outlets = new Set(before && Array.isArray(before.outlets) ? before.outlets : []);
    if (item.outlet) outlets.add(item.outlet);
    const status = before ? 'followup' : 'new';
    next[key] = {
      key,
      title: item.title || (before ? before.title : ''),
      section: item.section || (before ? before.section : ''),
      aspect: item.aspect || (before ? before.aspect : ''),
      firstSeen: before ? before.firstSeen : nowIso,
      lastSeen: nowIso,
      timesSeen: (before ? before.timesSeen : 0) + 1,
      status,
      outlet: item.outlet || (before ? before.outlet : ''),
      primaryUrl: item.primaryUrl || (before ? before.primaryUrl : ''),
      outlets: Array.from(outlets),
      flags: Array.isArray(item.flags) ? item.flags : [],
      watch: Boolean(item.watch),
    };
    results.push({ key, title: next[key].title, status, timesSeen: next[key].timesSeen, outlets: next[key].outlets });
  }

  for (const key of Object.keys(previousItems)) {
    if (next[key]) continue;
    const prev = previousItems[key] || {};
    const seen = new Date(prev.lastSeen || prev.firstSeen || 0).getTime();
    if (Number.isNaN(seen)) continue;
    if ((now.getTime() - seen) / DAY <= RETENTION_DAYS) next[key] = Object.assign({}, prev);
  }

  const watchlist = Object.keys(next)
    .map((k) => next[k])
    .filter((v) => v.watch)
    .filter((v) => (now.getTime() - new Date(v.firstSeen || nowIso).getTime()) / DAY <= RETENTION_DAYS)
    .map((v) => ({ key: v.key, title: v.title, firstSeen: v.firstSeen, lastSeen: v.lastSeen, timesSeen: v.timesSeen, status: v.status }));

  const outPath = arg('--out', statePath);
  const payload = {
    version: 1,
    updatedAt: nowIso,
    lastBriefingAt: nowIso,
    lastBriefingDate: arg('--date', nowIso.slice(0, 10)),
    window: planWindow(state.lastBriefingAt, now),
    items: next,
    watchlist,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ command: 'update', statePath: outPath, window: payload.window, newCount: results.filter((r) => r.status === 'new').length, followupCount: results.filter((r) => r.status === 'followup').length, watchlistCount: watchlist.length, results }, null, 2) + '\n');
}

main();
