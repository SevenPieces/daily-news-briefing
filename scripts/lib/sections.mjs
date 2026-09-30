// The briefing's section grammar, in one place.
//
// Three tools used to carry their own idea of what a section is, and each was
// slightly different. The worst consequence was silence: a heading none of them
// recognised (a Chinese-only '## 中国', a typo) dropped every bullet under it,
// so check-diversity printed 'China: 0 items' and still exited 0, and
// md-to-items dropped every Chinese story from the state index without a word.
//
// So: one recogniser, and an unrecognised '## ' heading is a hard error rather
// than a silent skip. The output contract fixes the section list; a new section
// is a contract change and every caller must be taught about it deliberately.
//
// Zero dependencies, like the rest of scripts/.

// Both halves of a bilingual heading are accepted ('## China / 中国' and the
// Chinese-only '## 中国'), so a heading written in one language still maps.
const ALIASES = new Map([
  ['top stories', 'top'],
  ['今日要闻', 'top'],
  ['global', 'global'],
  ['china', 'china'],
  ['中国', 'china'],
  ['watchlist', 'watch'],
  ['持续关注', 'watch'],
  ['观察', 'watch'],
  ['market snapshot', 'market'],
  ['市场快照', 'market'],
  ['coverage note', 'coverage'],
  ['覆盖说明', 'coverage'],
  ['sources', 'sources'],
  ['来源', 'sources'],
]);

/** Sections that hold story lines; every other known section holds none. */
export const STORY_SECTIONS = new Set(['top', 'global', 'china', 'watch']);

/** The heading text of a '## ' or '### ' line, or null if the line is neither. */
export function headingText(line) {
  const m = /^(#{2,3})\s+(.*)$/.exec(line);
  return m ? m[2].trim() : null;
}

/** 'top' | 'global' | 'china' | 'watch' | 'market' | 'coverage' | 'sources' | null. */
export function sectionOf(heading) {
  const text = String(heading).trim();
  const english = text.split('/')[0].trim().toLowerCase();
  if (ALIASES.has(english)) return ALIASES.get(english);
  const whole = text.toLowerCase();
  return ALIASES.has(whole) ? ALIASES.get(whole) : null;
}

/**
 * A story line, exactly as the output contract defines one: a NON-indented
 * '- ' bullet carrying a [src: ...] reference or opening with a bold headline.
 * Indented bullets are sub-notes, never stories.
 */
export function isStoryLine(line) {
  if (!line.startsWith('- ')) return false;
  return line.includes('[src:') || /^-\s+\*\*/.test(line);
}

/** The [src:OUTLET YYYY-MM-DD HH:MM](url) reference, or null. */
export function sourceRef(line) {
  const m = /\[src:(.+?)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.exec(line);
  return m ? m[1].trim() : null;
}

/** Every '## ' heading in document order, with its mapped section (may be null). */
export function headings(md) {
  const found = [];
  md.split(/\r?\n/).forEach((line, i) => {
    const text = headingText(line);
    if (text === null || !line.startsWith('## ')) return;
    found.push({ line: i + 1, text, section: sectionOf(text) });
  });
  return found;
}

/**
 * Fail loudly on a '## ' heading that maps to nothing. Returns the offending
 * headings; callers print them and exit 2.
 */
export function unknownHeadings(md) {
  return headings(md).filter((h) => h.section === null);
}
