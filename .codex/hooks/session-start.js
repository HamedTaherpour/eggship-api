'use strict';

/**
 * Codex SessionStart hook: injects governance pointers without duplicating policy.
 * Writes JSON additionalContext to stdout.
 */

const additionalContext = [
  'EggShip Codex session governance:',
  '- Read AGENTS.md before editing.',
  '- Load only the relevant instructions/* files for the task.',
  '- For roadmap work, read the named task in docs/ROADMAP.md and follow docs/agent-workflows/implement-roadmap-task.md.',
  '- Keep changes scoped. Stop and report unresolved business or architecture ambiguity.',
  '- Do not store secrets in .codex/, .cursor/, or .claude/.',
  '- No project-scoped MCP servers are enabled yet; see instructions/agent-tooling.md.',
].join('\n');

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  }),
);
