# Releases

EggShip releases are human-controlled. Automation may prepare and validate release metadata; it must not tag, push tags, publish a GitHub Release, or deploy production unless a human explicitly performs or instructs that exact action.

## Version model

EggShip uses [Semantic Versioning](https://semver.org/) `MAJOR.MINOR.PATCH`.

| Kind  | Meaning                                        |
| ----- | ---------------------------------------------- |
| PATCH | Backward-compatible fixes                      |
| MINOR | Backward-compatible functionality              |
| MAJOR | Breaking public contract changes after `1.0.0` |

Git tags use a `v` prefix:

```text
v0.1.0
v0.2.0
v1.0.0
```

### Pre-1.0 (`0.x.y`)

While the major version is `0`, the public HTTP contract is not declared stable. Prefer PATCH for compatible fixes and MINOR for new compatible functionality. Intentionally breaking public contract changes before `1.0.0` must bump the **MINOR** version and be called out clearly in the changelog (for example under Changed). Reserve MAJOR for the first stable `1.0.0` and later breaking majors.

Do not invent a custom versioning scheme beyond SemVer.

### Pre-release identifiers

Standard SemVer prerelease and build metadata forms are allowed (for example `0.3.0-rc.1`). No release automation currently depends on special prerelease behavior; treat them as ordinary SemVer strings for validation and tagging (`v0.3.0-rc.1`).

## Canonical version sources

Avoid multiple conflicting version authorities. Canonical release identity is:

```text
package.json "version"
  → Git annotated tag vX.Y.Z
  → CHANGELOG.md section [X.Y.Z]
  → GitHub Release for that tag
```

| Source                 | Role                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `package.json` version | Canonical project version between and during releases                |
| Git tag `vX.Y.Z`       | Immutable release marker; must match `package.json`                  |
| `CHANGELOG.md`         | Human-readable release notes for that version                        |
| GitHub Release         | Published notes for the tag; body derived from the changelog section |

Runtime metadata:

| Variable      | Role                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| `APP_VERSION` | Deployed/build semantic version for logs, health, and OpenAPI `info.version` |
| `GIT_SHA`     | Exact source revision that produced the running build                        |

`APP_VERSION` and `GIT_SHA` must reflect the actual release/build. They are **not** a separately hand-maintained version authority: production and staging deployments should inject them from the release tag/commit. Local development may use safe values such as `APP_VERSION=0.1.0` and `GIT_SHA=local` consistent with [environment](environment.md). Do not add a separate `VERSION` file.

Health responses may expose `APP_VERSION`. Do not expose unnecessary Git or internal details on public endpoints; `GIT_SHA` belongs in structured logs and operational diagnostics.

## Build provenance

Every deployed build should be traceable to:

```text
release version (APP_VERSION) + Git commit SHA (GIT_SHA)
```

Operational debugging must be able to answer: which exact source revision produced this running API? No external provenance platform is required by this foundation.

## Changelog workflow

Maintain [CHANGELOG.md](../CHANGELOG.md) in Keep a Changelog style with a leading `## [Unreleased]` section.

```text
feature/fix PRs
   ↓
CHANGELOG [Unreleased]
   ↓
release preparation (pnpm release:prepare)
   ↓
[Unreleased] becomes [X.Y.Z] - YYYY-MM-DD
   ↓
fresh [Unreleased] created
```

Meaningful changes that should update the changelog:

- API / contract changes
- user-visible functionality
- security changes
- database / schema behavior
- architecture / infrastructure changes
- notable fixes

Do not require changelog entries for trivial formatting or internal refactors with no meaningful impact.

GitHub Release notes should summarize applicable sections (Added, Changed, Fixed, Security, Database, Operations) from the changelog release section. Do not maintain three separate hand-written release-note sources; the changelog section is primary.

Conventional Commits support readable history; they are **not** a substitute for the changelog.

## Conventional Commits

Commit messages follow Conventional Commits via commitlint (`@commitlint/config-conventional`). Common patterns for EggShip:

```text
feat(auth): add refresh token rotation
fix(inventory): prevent overselling
test(orders): add concurrency regression test
docs(api): update order contract
chore(release): prepare v0.2.0
```

Scopes are free-form and should name the module or area. Do not maintain a large mandatory scope allowlist unless a concrete need appears.

## Release commands

| Command                          | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `pnpm release:check`             | Validate semver, changelog structure, and package/changelog consistency     |
| `pnpm release:prepare <version>` | Prepare `package.json` + changelog for a new version (optional `--dry-run`) |
| `pnpm test:release`              | Unit tests for release validators (no Git network mutations)                |

`release:prepare` may update `package.json` and `CHANGELOG.md` only. It must **not** create tags, push, publish a GitHub Release, or deploy.

## Human tag and publish workflow

```text
pnpm release:prepare X.Y.Z
→ review the diff
→ commit (for example chore(release): prepare vX.Y.Z)
→ create annotated tag: git tag -a vX.Y.Z -m "EggShip API vX.Y.Z"
→ push commit and tag
→ GitHub Actions Release workflow validates and creates the GitHub Release
```

Prefer annotated tags. Do not force-push release tags.

## GitHub Release automation

Pushing a `v*` tag triggers [.github/workflows/release.yml](../.github/workflows/release.yml). That workflow:

1. Re-runs repository quality gates (install, agent tooling, environment check, format, lint, typecheck, unit/e2e/release tests, OpenAPI check, build, `release:check`)
2. Verifies the tag equals `v` + `package.json` version
3. Builds release notes from the matching `CHANGELOG.md` section
4. Creates a GitHub Release for the tag

It does **not** deploy the API. Job permissions stay least-privilege (`contents: write` only on the job that creates the release).

If tag/version validation or quality gates fail, no release is published.

## CI quality gates and production readiness

A release tag must not bypass repository checks. The Release workflow re-runs the ordinary quality suite.

Separately, the [Integration](../.github/workflows/integration.yml) workflow proves real PostgreSQL/Redis contact. A release candidate must **not** be considered production-ready until that integration suite has passed for the intended revision in a trusted hosted environment. Local `pnpm release:check` does not require PostgreSQL or Redis and does not claim integration success.

Do not claim hosted GitHub execution succeeded unless the workflow run is visible and green.

## Branch policy

Prefer a simple model:

```text
main
+ short-lived feature branches
+ PR / review
+ release tags on the release commit
```

Do not introduce GitFlow, `develop`, or long-lived `release/*` branches unless a later approved decision requires them.

## OpenAPI compatibility (future)

Release preparation should make it possible later to compare OpenAPI documents between tagged releases (for example by retaining generated OpenAPI artifacts per release). Heavy breaking-change tooling is out of scope for this foundation; add it when a roadmap task requires it.

## Security

Release automation must never print or upload GitHub secrets, database credentials, Redis credentials, Liara credentials, or production tokens. Prefer official GitHub Actions pinned to major versions already used by this repository. Do not grant broad repository permissions to release jobs.

## AI release policy

AI agents may:

- prepare release files (`release:prepare`, changelog edits)
- validate release consistency (`release:check`)
- draft release notes from the changelog

AI agents must **not** autonomously:

- create release tags
- push tags
- publish a GitHub Release
- deploy production

unless a human explicitly instructs that exact action. Release publication is a human-controlled boundary. See also [ai-governance](ai-governance.md).
