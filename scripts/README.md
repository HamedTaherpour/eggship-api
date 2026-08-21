# Scripts

Repository automation scripts belong here when a package script is not sufficient. Keep scripts small, documented, and safe to run repeatedly.

| Script                      | Purpose                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `check-agent-tooling.mjs`   | Verifies AI host adapters stay thin, point at canonical policy, and that shared workflows exist (`pnpm check:agent-tooling`) |
| `check-environment.mjs`     | Verifies Node/pnpm engines, local `.env` hygiene, and masked connection metadata (`pnpm env:check`)                          |
| `run-integration-tests.mjs` | Fail-closed opt-in runner for real PostgreSQL/Redis integration suites (`pnpm test:integration*`)                            |
| `lib/release.mjs`           | Shared SemVer/changelog helpers used by release commands                                                                     |
| `release-check.mjs`         | Validates release metadata consistency (`pnpm release:check`)                                                                |
| `release-prepare.mjs`       | Prepares `package.json` + `CHANGELOG.md` for a version (`pnpm release:prepare`)                                              |
| `extract-release-notes.mjs` | Writes a changelog section to a file for GitHub Release notes                                                                |
| `lib/release.spec.mjs`      | Node test runner coverage for release helpers (`pnpm test:release`)                                                          |

`pnpm env:check` must not require Docker, contact production, mutate databases, print secrets, or install system software.

`pnpm release:check` and `pnpm release:prepare` must not create Git tags, push, publish GitHub Releases, deploy, or require PostgreSQL/Redis. See [instructions/releases.md](../instructions/releases.md).

OpenAPI generation and validation live under `src/common/openapi/` and are invoked with `pnpm openapi:generate` and `pnpm openapi:check`.
