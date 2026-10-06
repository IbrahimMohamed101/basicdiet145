# Repository Agent Instructions

## Basic Diet Marketing OS

For any task related to Basic Diet marketing, growth, social media, offers, ads, customer research, attribution, or marketing analytics:

1. Read `marketing/README.md`.
2. Read `marketing/STATE.md`.
3. Read `skills/basic-diet-marketing/SKILL.md`.
4. Load only the additional marketing files relevant to the task.
5. Do not restart strategy from scratch when documented context already exists.
6. Never invent business metrics, testimonials, customer quotes, or campaign results.
7. Treat live backend/database/dashboard data as the source for current numbers. The repository stores documented snapshots, decisions, hypotheses, and learnings.
8. Never commit customer PII, payment data, access tokens, API keys, passwords, or private credentials.
9. After meaningful marketing work, update the relevant log and, when state changed, update `marketing/STATE.md` and `marketing/CHANGELOG.md`.
10. Marketing documentation must remain isolated from runtime application code unless the user explicitly requests an implementation change.

### Completion rule

A meaningful marketing task is complete only after:

`Execute -> Verify -> Document`

Examples:
- A new analytics feature: document what was implemented, how to use it, limits, PR/commit, and deployment state.
- A published content item: record the creative, objective, asset, CTA, and later its results.
- An experiment: record hypothesis before launch and result/learning after completion.
- A strategic decision: add it to the decision log with rationale and status.

For non-marketing engineering tasks, follow the repository's engineering skills and existing architecture conventions.
