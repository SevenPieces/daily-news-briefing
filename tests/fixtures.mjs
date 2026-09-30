// Synthetic, contract-shaped fixtures. Never real news copy: every string here
// is invented so the repository ships no third-party content.
import { join } from 'node:path';
import { writeJson, writeText } from './helpers.mjs';

export const SRC = {
  bbc: 'https://www.bbc.co.uk/news/articles/example-one',
  aljazeera: 'https://www.aljazeera.com/news/2026/9/29/example-two',
  guardian: 'https://www.theguardian.com/world/2026/sep/29/example-three',
  xinhua: 'https://www.news.cn/politics/20260929/example-four/c.html',
  cnr: 'https://china.cnr.cn/news/sz/20260929/example-five.shtml',
};

export const OUTLETS = {
  global: [
    { name: 'BBC', url: SRC.bbc, time: '2026-09-29 12:10', alt: 'Al Jazeera', altUrl: SRC.aljazeera },
    { name: 'Al Jazeera', url: SRC.aljazeera, time: '2026-09-29 14:20', alt: 'The Guardian', altUrl: SRC.guardian },
    { name: 'The Guardian', url: SRC.guardian, time: '2026-09-29 16:45' },
  ],
  china: [
    { name: '新华网', url: SRC.xinhua, time: '2026-09-29 18:00', tag: '#new', prov: '[prov:feed]' },
    { name: '央广网', url: SRC.cnr, time: '2026-09-29 19:30', tag: '#followup', prov: '[prov:full]' },
  ],
};

export const story = {
  global: (headline, outletIndex = 0, extra = '') => {
    const o = OUTLETS.global[outletIndex % OUTLETS.global.length];
    const alt = o.alt ? ` [alt:${o.alt}](${o.altUrl})` : '';
    return `- **${headline}** - Synthetic summary sentence for the fixture. ` +
      `[src:${o.name} ${o.time}](${o.url})${alt} #new [prov:full]${extra}`;
  },
  china: (headline, outletIndex = 0, extra = '') => {
    const o = OUTLETS.china[outletIndex % OUTLETS.china.length];
    return `- **${headline}** - 合成摘要句，仅用于测试夹具。 ` +
      `[src:${o.name} ${o.time}](${o.url}) ${o.tag} ${o.prov}${extra}`;
  },
};

/**
 * Build a briefing Markdown document shaped like the real deliverables.
 * @param {{date?: string, globalStories?: number, chinaStories?: number,
 *          topStories?: number, watchlist?: number, coverageSubheading?: boolean,
 *          quietLine?: string, extraStoryLines?: string[]}} [o]
 */
export function briefing(o = {}) {
  const date = o.date ?? '2026-09-30';
  const globalStories = o.globalStories ?? 3;
  const chinaStories = o.chinaStories ?? 2;
  const topStories = o.topStories ?? 2;
  const watchlist = o.watchlist ?? 1;
  const lines = [];

  lines.push(`# Daily Briefing / 每日简报 - ${date}`);
  lines.push(`_Asia/Shanghai - generated ${date} 08:30 - Last briefing 2026-09-29 - covering latest 23.8h (2026-09-29 08:39 -> ${date} 08:30 Asia/Shanghai)_`);
  lines.push('');
  lines.push('## Top stories / 今日要闻');
  for (let i = 0; i < topStories; i++) lines.push(story.global(`Synthetic top story number ${i + 1}`, i));
  lines.push('');
  lines.push('## Market snapshot / 市场快照');
  lines.push('| Market | Level | Chg | As of |');
  lines.push('|---|---|---|---|');
  lines.push(`| S&P 500 | 7670.84 | -0.167% | ${date} 04:38 |`);
  lines.push(`| 10Y US Treasury | 5.2550 | +1.5 bp | ${date} 02:59 |`);
  lines.push('');
  lines.push('(Values from the collector APIs, each row with its own as-of time in Asia/Shanghai. Yields are quoted in basis points: changeBp is the move in percentage points x 100.)');
  lines.push('');
  lines.push('## Global');
  lines.push('### Economy');
  for (let i = 0; i < globalStories; i++) lines.push(story.global(`Synthetic global economy story ${i + 1}`, i));
  lines.push('### Politics');
  lines.push(story.global('Synthetic global politics story 1', 1));
  lines.push('');
  lines.push('## China / 中国');
  lines.push('### 经济');
  for (let i = 0; i < chinaStories; i++) lines.push(story.china(`合成中国经济新闻 ${i + 1}`, i));
  lines.push('### 时政');
  lines.push(story.china('合成中国时政新闻 1', 1));
  lines.push('');
  if (watchlist > 0) {
    lines.push('## Watchlist / 持续关注');
    for (let i = 0; i < watchlist; i++) lines.push(story.global(`Synthetic watched story ${i + 1}`, i + 1));
    lines.push('');
  }
  lines.push('## Coverage note / 覆盖说明');
  lines.push(`Window: Last briefing 2026-09-29 - covering latest 23.8h (2026-09-29 08:39 -> ${date} 08:30 Asia/Shanghai).`);
  lines.push(`Story lines: ${topStories + globalStories + 1 + chinaStories + 1 + watchlist} | full: 4 | feed: 2 | link: 0.`);
  lines.push(o.quietLine ?? 'Quiet aspects: none.');
  if (o.coverageSubheading) {
    lines.push('### Additional notes / 补充说明');
    lines.push('- **A bullet that is not a story line** - it has no [src:] reference at all.');
  }
  for (const l of o.extraStoryLines ?? []) lines.push(l);
  lines.push('');
  lines.push('## Sources / 来源');
  lines.push(`- BBC - ${SRC.bbc}`);
  lines.push(`- Al Jazeera - ${SRC.aljazeera}`);
  lines.push(`- 新华网 - ${SRC.xinhua}`);
  lines.push('');
  return lines.join('\n');
}

/** A v2 state document as update-state.mjs writes it. */
export function state(o = {}) {
  return {
    version: 2,
    updatedAt: o.updatedAt ?? '2026-09-29T00:39:48.304Z',
    lastBriefingAt: o.lastBriefingAt ?? '2026-09-29T00:39:48.304Z',
    lastBriefingDate: o.lastBriefingDate ?? '2026-09-29',
    window: o.window ?? { label: 'Last briefing 2026-09-29 - covering latest 23.8h (2026-09-29 08:39 -> 2026-09-30 08:30 Asia/Shanghai)' },
    plannedWindow: o.plannedWindow ?? null,
    items: o.items ?? [
      { title: 'Synthetic global economy story 1', section: 'global', aspect: 'economy', date: '2026-09-29' },
      { title: '合成中国经济新闻 1', section: 'china', aspect: 'economy', date: '2026-09-29' },
    ],
  };
}

/** Write a complete fixture pair (briefing + state + out dir) into a temp dir. */
export function scenario(dir, o = {}) {
  const date = o.date ?? '2026-09-30';
  const mdPath = join(dir, `briefing-${date}.md`);
  const statePath = join(dir, 'briefing-state.json');
  writeText(mdPath, o.markdown ?? briefing(o));
  writeJson(statePath, o.state ?? state(o));
  return { dir, date, mdPath, statePath, itemsPath: join(dir, '.items.json') };
}
