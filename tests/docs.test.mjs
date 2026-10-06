// Documentation-to-code consistency. The documents name scripts, and instruct
// an agent to run them with particular flags; nothing checked that those names
// still exist. Two of these tests were written after scripts/lib/sections.mjs
// shipped with no mention in any document at all, which is the sort of gap a
// reader cannot notice: the module is imported by three tools and described
// nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT, runScript, tempDir } from './helpers.mjs';

const DOCS = ['SKILL.md', 'README.md', 'reference/state-schema.md', 'reference/sources.md',
  'reference/research-input.md', 'reference/output-contract.md', 'reference/feasibility.md'];

function docText() {
  return DOCS.map((d) => readFileSync(join(SKILL_ROOT, d), 'utf8')).join('\n');
}

/** Every .mjs under scripts/, including scripts/lib/, as repo-relative paths. */
function scriptFiles() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, prefix + entry + '/');
      else if (entry.endsWith('.mjs')) out.push(prefix + entry);
    }
  };
  walk(join(SKILL_ROOT, 'scripts'), 'scripts/');
  return out;
}

test('every script file is named in the documentation', () => {
  const text = docText();
  const undocumented = scriptFiles().filter((rel) => !text.includes(rel));
  assert.deepEqual(undocumented, [],
    'these scripts exist but no document names them: ' + undocumented.join(', '));
});

test('every script path the documentation names exists', () => {
  const text = docText();
  const named = new Set([...text.matchAll(/scripts\/[A-Za-z0-9_./-]+\.mjs/g)].map((m) => m[0]));
  assert.ok(named.size >= 9, 'the documents should name the scripts: found ' + named.size);
  const missing = [...named].filter((rel) => {
    try {
      return !statSync(join(SKILL_ROOT, rel)).isFile();
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], 'the documentation names scripts that do not exist: ' + missing.join(', '));
});

test('every CLI flag the documentation names exists in some script', () => {
  const text = docText();
  const all = scriptFiles().map((rel) => readFileSync(join(SKILL_ROOT, rel), 'utf8')).join('\n');
  // --test belongs to Node's own runner, not to this skill's scripts.
  const notOurs = new Set(['--test']);
  const flags = new Set([...text.matchAll(/\s(--[a-z][a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...flags].filter((flag) => !notOurs.has(flag) && !all.includes(flag));
  assert.deepEqual(missing, [], 'the documentation names flags no script accepts: ' + missing.join(', '));
});

test('the two gates and the indexer are documented where the workflow runs them', () => {
  const skill = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
  for (const script of ['md-to-items.mjs', 'check-provenance.mjs', 'check-diversity.mjs',
    'update-state.mjs', 'render-html.mjs', 'fetch-page.mjs', 'fetch-feeds.mjs', 'collect-markets.mjs']) {
    assert.ok(skill.includes(script), 'SKILL.md never mentions ' + script);
  }
  // Each is invoked, not merely named.
  for (const script of ['md-to-items.mjs', 'check-provenance.mjs', 'check-diversity.mjs',
    'update-state.mjs', 'render-html.mjs']) {
    assert.ok(new RegExp('node "\\$SKILL/scripts/' + script.replace('.', '\\.') + '"').test(skill),
      'SKILL.md never shows how to run ' + script);
  }
});

test('the documented pre-Markdown invocation runs with the window plan actually prints (H3)', (t) => {
  // Runtime finding, five consecutive days: research-input.md documented the gate
  // invocation as passing plan's window fields straight in, and those are
  // ISO-8601 instants, while the gate accepted only the local stamp - so a run
  // that followed the text literally got exit 2 from its mandatory gate. This
  // test executes the documented command with a real plan-style window.
  const doc = readFileSync(join(SKILL_ROOT, 'reference', 'research-input.md'), 'utf8');
  const invocation = doc.split('\n')
    .find((line) => line.includes('check-research.mjs') && line.includes('--window'));
  assert.ok(invocation, 'research-input.md no longer documents the gate invocation');
  assert.ok(invocation.includes('--window "<SINCE>" "<UNTIL>"'),
    'the documented invocation must name the two window arguments the run substitutes');

  const dir = tempDir(t);
  const report = join(dir, 'records.json');
  writeFileSync(report, JSON.stringify([{
    section: 'global', aspect: 'Economy', headline: 'A headline', sourceTitle: 'A headline',
    outlet: 'BBC', primaryUrl: 'https://www.bbc.co.uk/news/a', publishedAt: '2026-10-06 09:30',
    dateSource: 'datePublished', provenance: 'full', textLength: 900, flags: ['new'], keyFacts: ['a fact'],
  }], null, 1));

  // Exactly what plan prints and the document tells the run to copy.
  const res = runScript('check-research.mjs', [report,
    '--window', '2026-10-06T00:30:35.585Z', '2026-10-06T07:58:28.269Z']);
  assert.equal(res.status, 0, 'the documented invocation must be usable as written:\n' + res.stdout + res.stderr);
  assert.match(res.stdout, /RESEARCH: OK/);
  assert.match(res.stdout, /window 2026-10-06 08:30 -> 2026-10-06 15:58/,
    'the gate echoes the window in the local form the records are written in');
  // And the document says where those values come from, so the run does not
  // hand-convert them or invent a window the plan never announced.
  assert.ok(/Step 2's .window\.since. and .window\.until. copied/.test(doc),
    'the document must say the values are plan\'s own window fields');
});
