#!/usr/bin/env node
'use strict';

/**
 * Static drift checks for canonical Agent Skills and host adapters.
 * This intentionally does not require Cursor, Codex, Claude, or Qoder binaries.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const errors = [];
const MAX_WRAPPER_BYTES = 4_000;
const MAX_RULE_BYTES = 3_000;
const sharedSkills = [
  'implement-roadmap-task',
  'review-eggship-change',
  'review-prisma-migration',
  'review-concurrency-sensitive-change',
];

const rel = (path) => relative(root, path).replaceAll('\\', '/');
const full = (path) => join(root, path);
const read = (path) => readFileSync(full(path), 'utf8');
const mustExist = (path) => {
  if (!existsSync(full(path))) {
    errors.push(`Missing required file: ${path}`);
    return false;
  }
  return true;
};

function listFiles(dir, predicate = () => true) {
  const directory = full(dir);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(join(dir, entry.name), predicate);
    return predicate(path) ? [path] : [];
  });
}

function frontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    errors.push(`${rel(path)} must start with YAML frontmatter`);
    return null;
  }
  const fields = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter((line) => line.includes(':'))
      .map((line) => {
        const index = line.indexOf(':');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
  for (const field of ['name', 'description']) {
    if (!fields[field])
      errors.push(`${rel(path)} frontmatter requires ${field}`);
  }
  return fields;
}

for (const path of [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ROADMAP.md',
  'instructions/agent-tooling.md',
  'instructions/ai-governance.md',
  'docs/agent-workflows/implement-roadmap-task.md',
  'docs/agent-workflows/review-eggship-change.md',
  'docs/agent-workflows/review-prisma-migration.md',
  'docs/agent-workflows/review-concurrency-sensitive-change.md',
  '.codex/config.toml',
  '.codex/hooks.json',
  '.codex/hooks/session-start.js',
  '.codex/hooks/stop-check.js',
  '.claude/settings.json',
])
  mustExist(path);

const agents = read('AGENTS.md');
if (!agents.includes('instructions/agent-tooling.md')) {
  errors.push('AGENTS.md must link instructions/agent-tooling.md');
}
const claude = read('CLAUDE.md');
if (!claude.includes('AGENTS.md') || Buffer.byteLength(claude) > 1_000) {
  errors.push('CLAUDE.md must point to AGENTS.md and stay under 1000 bytes');
}

const names = new Set();
for (const name of sharedSkills) {
  const skillPath = full(`.agents/skills/${name}/SKILL.md`);
  if (!existsSync(skillPath)) {
    errors.push(`Missing canonical skill: .agents/skills/${name}/SKILL.md`);
    continue;
  }
  const metadata = frontmatter(skillPath);
  if (metadata?.name !== name)
    errors.push(`${rel(skillPath)} name must be ${name}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || names.has(name)) {
    errors.push(`Invalid or duplicate canonical skill name: ${name}`);
  }
  names.add(name);
  const text = readFileSync(skillPath, 'utf8');
  const workflow = `docs/agent-workflows/${name}.md`;
  if (!text.includes(workflow))
    errors.push(`${rel(skillPath)} must reference ${workflow}`);
  if (!text.includes('AGENTS.md'))
    errors.push(`${rel(skillPath)} must reference AGENTS.md`);
}

for (const host of ['.claude/skills', '.qoder/skills']) {
  for (const name of sharedSkills) {
    const path = full(`${host}/${name}/SKILL.md`);
    if (!existsSync(path)) {
      errors.push(`Missing ${host} adapter for ${name}`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const metadata = frontmatter(path);
    if (metadata?.name !== name)
      errors.push(`${rel(path)} name must be ${name}`);
    if (Buffer.byteLength(text) > MAX_WRAPPER_BYTES)
      errors.push(`${rel(path)} exceeds ${MAX_WRAPPER_BYTES} bytes`);
    if (!text.includes(`.agents/skills/${name}/SKILL.md`))
      errors.push(`${rel(path)} must point to its canonical skill`);
    if (!text.includes(`docs/agent-workflows/${name}.md`))
      errors.push(`${rel(path)} must reference the shared workflow`);
    const canonical = read(`.agents/skills/${name}/SKILL.md`);
    if (text.replace(/\r/g, '').includes(canonical.replace(/\r/g, '')))
      errors.push(`${rel(path)} duplicates the canonical skill body`);
  }
}

for (const host of ['.cursor/skills', '.codex/skills']) {
  for (const path of listFiles(host, (candidate) =>
    candidate.endsWith('SKILL.md'),
  )) {
    if (sharedSkills.some((name) => path.includes(`${host}/${name}/`))) {
      errors.push(
        `${rel(path)} is a duplicate shared skill; use .agents/skills`,
      );
    }
  }
}

for (const path of listFiles('.cursor/rules', (candidate) =>
  candidate.endsWith('.mdc'),
)) {
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > MAX_RULE_BYTES)
    errors.push(`${rel(path)} exceeds ${MAX_RULE_BYTES} bytes`);
  if (!text.includes('instructions/') && !text.includes('AGENTS.md'))
    errors.push(`${rel(path)} must point to canonical policy`);
}
for (const path of listFiles('.qoder/rules', (candidate) =>
  candidate.endsWith('.md'),
)) {
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > MAX_RULE_BYTES)
    errors.push(`${rel(path)} exceeds ${MAX_RULE_BYTES} bytes`);
  if (!text.includes('instructions/') && !text.includes('AGENTS.md'))
    errors.push(`${rel(path)} must point to canonical policy`);
}

for (const path of listFiles('.claude/agents', (candidate) =>
  candidate.endsWith('.md'),
)) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes('AGENTS.md'))
    errors.push(`${rel(path)} must reference AGENTS.md`);
  if (/^model:\s*(opus|sonnet|haiku)\b/m.test(text))
    errors.push(`${rel(path)} pins a commercial model name`);
}

for (const path of ['.cursor/mcp.json', '.mcp.json']) {
  if (existsSync(full(path)))
    errors.push(`${path} exists but no project MCP is approved`);
}
const secretPatterns = [
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
];
for (const dir of ['.agents', '.cursor', '.claude', '.codex', '.qoder']) {
  for (const path of listFiles(dir)) {
    const text = readFileSync(path, 'utf8');
    if (secretPatterns.some((pattern) => pattern.test(text)))
      errors.push(`Possible secret material in ${rel(path)}`);
  }
}

if (errors.length) {
  process.stderr.write(
    `check-agent-tooling failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write('check-agent-tooling: ok\n');
