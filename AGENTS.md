# Agent Instructions

- The trunk branch is `main`. Open PRs against it; deploys run from pushes to `main`.
- When the harness assigns a session-specific feature branch (e.g. `claude/<slug>`), push to that branch — not directly to `main`.
- Run `npm run typecheck` before committing.
- Don't commit `.env*` files. Use `.env.example` as the template.
