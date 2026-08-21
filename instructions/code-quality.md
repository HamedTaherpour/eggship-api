# Code quality

- Keep TypeScript strict and resolve compiler findings at their source. `any` is not an acceptable escape hatch.
- Prefer small, cohesive units with names that express business intent. Avoid generic abstractions until repeated requirements prove their value.
- Keep lint focused on correctness and Prettier focused on style.
- Public behavior and non-obvious decisions need useful documentation; comments should explain why, not restate code.
- New dependencies require a concrete justification, a maintenance and security check, and the smallest appropriate scope.
- Required format, lint, type-check, test, and build checks must pass before completion, or failures must be reported accurately.
