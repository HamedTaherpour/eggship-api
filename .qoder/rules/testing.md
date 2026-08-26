---
name: testing
type: Specific Files
patterns:
  - '**/*.spec.ts'
  - '**/*.e2e-spec.ts'
  - 'test/**/*'
  - 'tests/**/*'
description: EggShip testing expectations when changing tests or verification
---

# Testing

Follow `instructions/testing.md`.

- Preserve unit, integration, e2e, concurrency, and load layers as applicable.
- Do not remove or weaken tests to make CI pass.
- Prefer real PostgreSQL for persistence semantics once database behavior exists.
- Do not label mocked coverage as Redis or database integration coverage.
- Bug fixes should add regression coverage when practical.
