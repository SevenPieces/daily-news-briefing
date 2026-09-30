// Shared helpers for the daily-news-briefing test suite.
// Standard library only, to match the skill's own dependency constraint.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const SKILL_ROOT = resolve(import.meta.dirname, '..');
export const SCRIPTS = join(SKILL_ROOT, 'scripts');

/**
 * Run one of the skill's CLI scripts and capture its result.
 * @param {string} script file name under scripts/, e.g. 'update-state.mjs'
 * @param {string[]} args argv for the script
 * @param {{cwd?: string, env?: Record<string,string>, input?: string, timeout?: number}} [opts]
 */
export function runScript(script, args = [], opts = {}) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    cwd: opts.cwd ?? SKILL_ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
    timeout: opts.timeout ?? 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** A fresh temp directory that is removed when the test finishes. */
export function tempDir(t, prefix = 'dnb-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeText(path, text) {
  writeFileSync(path, text);
  return path;
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

/** JSON payload of a script that prints JSON on stdout. */
export function jsonOf(stdout) {
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}
