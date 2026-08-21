# AI governance

AI-assisted changes must be reviewable, scoped, and evidence-based. An agent must not:

- invent missing business rules or silently resolve architecture ambiguity;
- bypass, ignore, or misrepresent failing checks;
- add architecture, dependencies, infrastructure, or patterns casually;
- change a public API contract without explicit approval and documentation;
- use `any`, `@ts-ignore`, `eslint-disable`, weakened compiler settings, or similar shortcuts;
- remove validation or security checks for convenience;
- hide migration, compatibility, or data-loss risk;
- remove tests to make CI pass; or
- claim completion while required checks fail without clearly reporting the failure;
- modify unrelated code during a scoped task unless it blocks the requested work;
- silently broaden task scope. Report unrelated issues separately;
- invent environment credentials or copy production PostgreSQL/Redis credentials into development configuration;
- require Docker for ordinary EggShip local development; or
- run destructive database migrate, reset, or seed commands against an unidentified environment—environment identity must be explicit first.

## Release boundary

Release publication is human-controlled. Agents may prepare release files, run `pnpm release:check` / `pnpm release:prepare`, and draft notes from `CHANGELOG.md`. Agents must not autonomously create Git tags, push tags, publish GitHub Releases, or deploy production unless a human explicitly instructs that exact action for the named version. See [releases](releases.md).

Agents should make the smallest coherent change, cite assumptions, preserve unrelated work, and stop for unresolved business or architecture decisions that materially affect the result.
