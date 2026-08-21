'use strict';

/**
 * Codex Stop hook: if the assistant claims unqualified completion, ask once for
 * Definition of Done verification evidence. Never makes architecture decisions.
 */

const VERIFICATION_MARKERS = [
  'pnpm format:check',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test',
  'pnpm test:e2e',
  'pnpm build',
  'pnpm check:agent-tooling',
  'format:check',
  'typecheck',
  'definition of done',
];

const COMPLETION_CLAIM =
  /\b(all (checks|tests) passed|verification passed|ready to merge|task (is )?done|marked .+ DONE|implementation complete)\b/i;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

function allowStop() {
  process.stdout.write(JSON.stringify({}));
}

function continueForVerification() {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'Completion was claimed without clear Definition of Done verification evidence. Run the applicable checks (at least pnpm format:check, pnpm lint, pnpm typecheck, pnpm test, pnpm test:e2e, pnpm build, and pnpm check:agent-tooling when agent tooling changed), then report results or explicitly document non-applicable checks before finishing.',
    }),
  );
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      payload = JSON.parse(raw);
    }
  } catch {
    allowStop();
    return;
  }

  if (payload.stop_hook_active === true) {
    allowStop();
    return;
  }

  const message =
    typeof payload.last_assistant_message === 'string'
      ? payload.last_assistant_message
      : '';

  if (!message || !COMPLETION_CLAIM.test(message)) {
    allowStop();
    return;
  }

  const lower = message.toLowerCase();
  const hasEvidence = VERIFICATION_MARKERS.some((marker) =>
    lower.includes(marker.toLowerCase()),
  );

  if (hasEvidence) {
    allowStop();
    return;
  }

  continueForVerification();
}

main().catch(() => {
  allowStop();
});
