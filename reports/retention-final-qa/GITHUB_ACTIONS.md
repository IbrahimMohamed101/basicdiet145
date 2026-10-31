# GitHub Actions — retention QA

Snapshot: 2026-10-31. Runtime candidates: backend6de157fd; dashboard7fd36e0. Later documentation commits do not change tested runtime code. A later test/documentation commit expands opt-out history coverage; latest PR checks must still be reviewed.

The original abbreviated connector response showed ten backend workflows; the complete check-runs listing includes all33 jobs. Initial checks were successful, but new production-dependency audit execution revealed High findings. The parser lockfile fix supersedes that failing run.

Previous failed audit (fixed): [production-dependency-audit](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236533795/job/124641384750). Affected packages body-parser1.20.8 and multer2.4.0; fixed at1.20.9 and2.5.0. Local production audit now reports0 High/0 Critical,4 Moderate.

## backend

| Job | Result | Link |
|---|---|---|
| release-gates | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768964/job/124642156197) |
| release-gates | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768993/job/124642099287) |
| repeated-balance-policy | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236769006/job/124642099263) |
| Two-type policy | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099195) |
| operations-and-admin | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768931/job/124642099181) |
| contracts-and-addon-lifecycle | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768931/job/124642099150) |
| Dashboard compatibility | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099125) |
| Authoritative authoring catalog | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099113) |
| Complete catalog | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099091) |
| Compatible default seed | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099087) |
| Existing option catalog closure | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099077) |
| Full meal end to end | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099076) |
| Source kind compatibility | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099066) |
| Sandwich card end to end | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099059) |
| Card lifecycle | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099054) |
| Full meal product contract | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099047) |
| Production product compatibility | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099045) |
| final-integration-candidate | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768918/job/124642099039) |
| Option-family card lifecycle | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099026) |
| production-dependency-audit | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768938/job/124642099025) |
| test | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768997/job/124642099014) |
| Dashboard mobile parity | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642099005) |
| test | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768982/job/124642098994) |
| kitchen-arabic-contract | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768992/job/124642098993) |
| Flutter card policy | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768909/job/124642098990) |
| commerce-and-security | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768931/job/124642098970) |
| retention-check | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768981/job/124642098966) |
| regression | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768961/job/124642098943) |
| changed-code-secret-scan | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768952/job/124642098936) |
| premium-meal-lifecycle | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768967/job/124642098919) |
| pickup-closure | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768916/job/124642098910) |
| syntax-check | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768948/job/124642098887) |
| email-otp-contract | success | [job](https://github.com/IbrahimMohamed101/basicdiet145/actions/runs/41236768924/job/124642098758) |

## dashboard

| Job | Result | Link |
|---|---|---|
| verify | success | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236609133/job/124641666673) |
| full-dashboard-tests | failure | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236609062/job/124641613096) |
| focused-checks | success | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236609062/job/124641613087) |
| full-dashboard-lint | failure | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236609062/job/124641612879) |
| validate | success | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236609027/job/124641612837) |
| build | success | [job](https://github.com/IbrahimMohamed101/client_dashbourd/actions/runs/41236608994/job/124641612554) |

## Dashboard failure diagnosis

The full test and full lint jobs fail with the same pre-existing problems reproduced locally at dashboard main1de7b3f. These are not skipped or marked infrastructure-only. See [baseline root causes](DASHBOARD_BASELINE_FINDINGS.md). Focused checks run build, project TypeScript,11 retention/access tests and scoped ESLint.

Local interrupted/resource-constrained attempts are not counted as successful. Final bounded full regression:320 passed /44 failed; final focused check11 passed; production-build browser integration passes at both viewports.
