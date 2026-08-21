#!/usr/bin/env node
'use strict';

/**
 * Lightweight drift checks for AI host adapters.
 * Does not claim Cursor/Claude/Codex schema validation unless those tools ran.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const MAX_WRAPPER_BYTES = 4_000;
const MAX_RULE_BYTES = 3_000;
const errors = [];

function rel(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function mustExist(path) {
  const full = join(root, path);
  if (!existsSync(full)) {
    errors.push(`Missing required file: ${path}`);
    return null;
  }
  return full;
}

function listFiles(dir, predicate) {
  const full = join(root, dir);
  if (!existsSync(full)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const path = join(full, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(join(dir, entry.name), predicate));
    } else if (!predicate || predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

const requiredCanonical = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ROADMAP.md',
  'instructions/agent-tooling.md',
  'instructions/ai-governance.md',
  'instructions/architecture.md',
  'instructions/api-contract.md',
  'instructions/list-queries.md',
  'instructions/authentication.md',
  'instructions/authorization.md',
  'instructions/code-quality.md',
  'instructions/database.md',
  'instructions/definition-of-done.md',
  'instructions/environment.md',
  'instructions/observability.md',
  'instructions/queues.md',
  'instructions/redis.md',
  'instructions/releases.md',
  'instructions/security.md',
  'instructions/testing.md',
  'instructions/media.md',
  'instructions/inventory.md',
  'docs/agent-workflows/implement-roadmap-task.md',
  'docs/agent-workflows/review-eggship-change.md',
  'docs/agent-workflows/review-prisma-migration.md',
  'docs/agent-workflows/review-concurrency-sensitive-change.md',
];

for (const path of requiredCanonical) {
  mustExist(path);
}

const agents = mustExist('AGENTS.md');
if (agents) {
  const text = read(agents);
  if (!text.includes('instructions/agent-tooling.md')) {
    errors.push('AGENTS.md must link instructions/agent-tooling.md');
  }
  if (!text.includes('instructions/api-contract.md')) {
    errors.push('AGENTS.md must link instructions/api-contract.md');
  }
  if (!text.includes('instructions/list-queries.md')) {
    errors.push('AGENTS.md must link instructions/list-queries.md');
  }
  if (!text.includes('instructions/environment.md')) {
    errors.push('AGENTS.md must link instructions/environment.md');
  }
  if (!text.includes('instructions/authentication.md')) {
    errors.push('AGENTS.md must link instructions/authentication.md');
  }
  if (!text.includes('instructions/authorization.md')) {
    errors.push('AGENTS.md must link instructions/authorization.md');
  }
}

const claude = mustExist('CLAUDE.md');
if (claude) {
  const text = read(claude);
  if (!text.includes('AGENTS.md')) {
    errors.push('CLAUDE.md must point to AGENTS.md');
  }
  if (Buffer.byteLength(text, 'utf8') > 1_000) {
    errors.push('CLAUDE.md must stay thin (under 1000 bytes)');
  }
}

const workflowNames = [
  'implement-roadmap-task',
  'review-eggship-change',
  'review-prisma-migration',
  'review-concurrency-sensitive-change',
];

for (const name of workflowNames) {
  const shared = `docs/agent-workflows/${name}.md`;
  for (const host of ['.cursor/skills', '.claude/skills']) {
    const skillPath = `${host}/${name}/SKILL.md`;
    const full = mustExist(skillPath);
    if (!full) {
      continue;
    }
    const text = read(full);
    const size = Buffer.byteLength(text, 'utf8');
    if (size > MAX_WRAPPER_BYTES) {
      errors.push(`${skillPath} exceeds ${MAX_WRAPPER_BYTES} bytes (${size})`);
    }
    if (!text.includes('AGENTS.md') && !text.includes(shared)) {
      errors.push(`${skillPath} must reference AGENTS.md or ${shared}`);
    }
    if (!text.includes(shared)) {
      errors.push(`${skillPath} must reference ${shared}`);
    }
  }
}

const cursorRules = listFiles('.cursor/rules', (path) => path.endsWith('.mdc'));
if (cursorRules.length === 0) {
  errors.push('Expected at least one .cursor/rules/*.mdc file');
}
for (const rulePath of cursorRules) {
  const text = read(rulePath);
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_RULE_BYTES) {
    errors.push(`${rel(rulePath)} exceeds ${MAX_RULE_BYTES} bytes (${size})`);
  }
  if (!text.includes('instructions/') && !text.includes('AGENTS.md')) {
    errors.push(`${rel(rulePath)} should point to AGENTS.md or instructions/*`);
  }
}

const claudeAgents = listFiles('.claude/agents', (path) =>
  path.endsWith('.md'),
);
for (const agentPath of claudeAgents) {
  const text = read(agentPath);
  if (!text.includes('AGENTS.md')) {
    errors.push(`${rel(agentPath)} must reference AGENTS.md`);
  }
  if (/^model:\s*(opus|sonnet|haiku)\b/m.test(text)) {
    errors.push(
      `${rel(agentPath)} pins a commercial model name; use model: inherit`,
    );
  }
}

mustExist('.codex/config.toml');
mustExist('.codex/hooks.json');
mustExist('.codex/hooks/session-start.js');
mustExist('.codex/hooks/stop-check.js');
mustExist('.claude/settings.json');

if (existsSync(join(root, '.cursor/mcp.json'))) {
  errors.push(
    '.cursor/mcp.json exists but no project MCP is approved yet; remove it or update instructions/agent-tooling.md after human approval',
  );
}
if (existsSync(join(root, '.mcp.json'))) {
  errors.push(
    '.mcp.json exists but no project MCP is approved yet; remove it or update instructions/agent-tooling.md after human approval',
  );
}

const secretPatterns = [
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /secret\s*[:=]\s*['"][^'"]+['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
];

for (const dir of ['.cursor', '.claude', '.codex']) {
  for (const filePath of listFiles(dir)) {
    if (statSync(filePath).isDirectory()) {
      continue;
    }
    const text = read(filePath);
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        errors.push(`Possible secret material in ${rel(filePath)}`);
      }
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`check-agent-tooling failed:\n`);
  for (const error of errors) {
    process.stderr.write(`- ${error}\n`);
  }
  process.exit(1);
}

process.stdout.write('check-agent-tooling: ok\n');
