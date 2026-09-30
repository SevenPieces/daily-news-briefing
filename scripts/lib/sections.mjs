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
 * "This bullet is meant to be a story": a NON-indented '- ' bullet that either
 * opens with a bold headline or carries a real [src:...](url) reference.
 * Indented bullets are sub-notes, never stories.
 *
 * This is deliberately wider than the contract's grammar, so that a bullet that
 * is neither - a story line written without its bold headline, or one whose src
 * has no timestamp - can be REPORTED as malformed instead of being skipped.
 * Skipping was the original defect: check-diversity counted nothing and still
 * printed OK.
 */
export function looksLikeStory(line) {
  if (!line.startsWith('- ')) return false;
  return /^-\s+\*\*/.test(line) || hasSourceRef(line);
}

/**
 * The contract's story line: '- **Headline** - Summary. [src:...]'. The bold
 * headline is mandatory - a bullet that only happens to contain a [src:] link
 * is not a story, and indexing it as one put a garbage title in the state index.
 */
export function isStoryLine(line) {
  return /^- \*\*.+?\*\*/.test(line);
}

/**
 * Whether the line carries a real [src:...](url) reference. Stricter than a
 * bare 'includes("[src:")' on purpose: prose that merely mentions the marker -
 * a Coverage-note bullet explaining the grammar - must not read as a story.
 */
export function hasSourceRef(line) {
  return /\[src:[^\]]*\]\(/.test(line);
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

// The Coverage note is paragraphs. One optional sub-heading is blessed - the
// '### Additional notes / 补充说明' a real run used to hold Chinese-language
// notes - and anything else there is a structural deviation, which no gate
// caught before: a '###' and a bullet under it passed both gates on 2026-09-30.
const COVERAGE_SUBHEADING = new Set(['additional notes', '补充说明']);

function subheadingAllowedInCoverage(text) {
  return text.split('/').map((half) => half.trim().toLowerCase())
    .some((half) => COVERAGE_SUBHEADING.has(half));
}

/**
 * Structural checks shared by both gates. Every problem is a hard failure:
 * a section heading they cannot map, a sub-heading outside the two story
 * sections, a sub-heading the Coverage note does not define, or a story-shaped
 * bullet sitting in a section that holds no stories.
 *
 * @returns {{line: number, kind: string, text: string}[]}
 */
export function structureProblems(md) {
  const problems = [];
  const lines = md.split(/\r?\n/);
  let sectionKey = null;
  let coverageSubheadingSeen = false;

  lines.forEach((line, i) => {
    if (line.startsWith('## ')) {
      const text = line.slice(3).trim();
      sectionKey = sectionOf(text);
      coverageSubheadingSeen = false;
      if (sectionKey === null) problems.push({ line: i + 1, kind: 'unmapped-section', text });
      return;
    }
    if (line.startsWith('### ')) {
      const text = line.slice(4).trim();
      if (sectionKey === 'coverage') {
        if (!subheadingAllowedInCoverage(text)) {
          problems.push({ line: i + 1, kind: 'coverage-subheading', text });
        } else if (coverageSubheadingSeen) {
          problems.push({ line: i + 1, kind: 'duplicate-coverage-subheading', text });
        } else {
          coverageSubheadingSeen = true;
        }
      } else if (sectionKey !== 'global' && sectionKey !== 'china') {
        problems.push({ line: i + 1, kind: 'stray-subheading', text });
      }
      return;
    }
    if (sectionKey !== null && !STORY_SECTIONS.has(sectionKey) && looksLikeStory(line)) {
      problems.push({ line: i + 1, kind: 'story-outside-story-section', text: line.slice(0, 72) });
    }
  });

  return problems;
}

/** One human-readable line per structural problem, for a tool's stderr. */
export function describeProblems(problems) {
  const label = {
    'unmapped-section': 'unrecognised "## " section heading',
    'coverage-subheading': 'sub-heading the Coverage note does not define',
    'duplicate-coverage-subheading': 'second Coverage-note sub-heading',
    'stray-subheading': 'sub-heading outside Global, China or the Coverage note',
    'story-outside-story-section': 'story-shaped bullet in a section that holds no stories',
  };
  return problems.map((p) => 'line ' + p.line + '  ' + (label[p.kind] || p.kind) + ': "' + p.text + '"');
}
