// Documentation-to-code consistency. The documents name scripts, and instruct
// an agent to run them with particular flags; nothing checked that those names
// still exist. Two of these tests were written after scripts/lib/sections.mjs
// shipped with no mention in any document at all, which is the sort of gap a
// reader cannot notice: the module is imported by three tools and described
// nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT } from './helpers.mjs';

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
