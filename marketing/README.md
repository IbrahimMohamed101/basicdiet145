# Basic Diet Marketing OS

**Version:** v1  
**Created:** 2026-10-07  
**Purpose:** Persistent source of truth for Basic Diet marketing work.

This directory exists so a new AI/chat/agent can continue marketing work without rebuilding the project context from conversation history.

## Operating model

- **GitHub / this directory:** strategy, state, decisions, documented snapshots, experiments, content history, learnings.
- **Backend + MongoDB:** live business data.
- **Admin Dashboard:** live marketing analytics and operational reporting.
- **Google Drive:** brand assets, food images, videos, menus, designs, source files.
- **ChatGPT / agents:** research, analysis, planning, creative execution, and documentation.

Do not treat the repository as a replacement for the live database. Time-sensitive metrics must be pulled from the live source and, when needed for history, stored as dated snapshots.

## Start here in every marketing session

1. Read [STATE.md](./STATE.md).
2. Read [../skills/basic-diet-marketing/SKILL.md](../skills/basic-diet-marketing/SKILL.md).
3. Read only the task-relevant files below.
4. Execute the task.
5. Verify the result.
6. Update the relevant documentation.

## Directory map

- `context/` — durable product, audience, offer, positioning, source context.
- `analytics/` — measurement definitions, implemented analytics, dated snapshots.
- `content/` — content strategy, asset catalog, content history, winners.
- `experiments/` — hypotheses, test designs, outcomes, learnings.
- `decisions/` — strategic decisions and why they were made.
- `plans/` — current execution plans.
- `STATE.md` — compact current state; read first.
- `CHANGELOG.md` — material changes to this Marketing OS.
- `FRAMEWORKS.md` — external frameworks adapted for Basic Diet.

## Common commands from the user

### "Basic Diet Mode — ننزل إيه النهارده؟"
Read:
- `STATE.md`
- `content/strategy.md`
- `content/content-log.md`
- `context/offers-pricing.md`
- latest relevant analytics snapshot/live data when available
- `content/asset-catalog.md`

Return:
objective, format, idea, hook, script/design direction, caption, CTA, stories, asset, KPI, and whether it is suitable for paid promotion.

### "Basic Diet Mode — راجع الأسبوع"
Read live analytics plus the content/experiment logs. Produce the weekly learning summary, update winners/losers, and propose the next tests.

### "Basic Diet Mode — اعمل حملة"
Read product context, audience/VOC, current offer, analytics baseline, prior winners, and current experiments before proposing a campaign.

## Data safety

Never commit:
- customer names tied to behavior,
- phone numbers,
- email addresses,
- addresses,
- payment details,
- access tokens or secrets.

Use aggregated metrics and anonymized customer language.
