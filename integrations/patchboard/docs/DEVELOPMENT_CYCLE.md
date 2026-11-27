# How Patchboard uses the CAFE development cycle

| CAFE practice | Patchboard rule and repository mechanism |
|---|---|
| Small test-driven changes on real infrastructure | One behavior per ticket. Write a failing test, implement the smallest change, rerun the same test, then verify the built app. M1 adds the real Jazz server and fixture tests. |
| Story, Scene, API and browser tests | Story covers Model and Commands. Scene drives the rendered UI. Backend integration covers actual Jazz operations and durability. Chromium exercises the production bundle and persists video. Add coverage in the affected layers with each behavior. |
| Pure Foldkit frontend with typed Effects | Model the UI with typed Messages and pure update/view. Commands own writes, scoped resources own sessions and subscriptions own reads. Use Effect.fn for domain operations and Effect Config for service configuration. Keep environment-specific adapters at entry points. |
| Domain modules with browser-safe contracts | Group files by board, proposal or agent responsibility. Keep generated Jazz schema shared. Keep Node-only adapters out of browser-imported modules. |
| Agent-assisted design, generation and audit | Read the root AGENTS.md, select a task from the roadmap and use the project playbooks under .agents/skills. Give an agent the behavior, affected files, first failing assertion and completion evidence. Review findings by file and observed consequence. |
| Isolated worktrees, fast merges | Branch per change. From the template commit use git worktree add -b feat/shared-board ../patchboard-m1 HEAD. Install in that worktree and give it its own ports and data directory. Use Conventional Commit PR titles, merge after green checks and rebase other branches. Remove a finished worktree after preserving its work. |
| CI preview, demo and cleanup | On PRs and main, CI generates schema, checks drift, lints, runs tests, builds and starts that build on the runner for Chromium. Download the preview bundle, HTML report and recording from Actions. Artifacts expire after seven days; Playwright stops its preview process. A hosted URL, public README video and cloud-stage cleanup belong to a later hosted release. |
| Review and reproducibility | Use the issue and PR templates. Include red/green evidence, exact commands and a recording of visible behavior. Keep lockfile and generated schema in the diff when their inputs change. |

## Effect 4 implementation addendum (mandatory)

The CAFE cycle above is the **original Patchboard policy**. For new Effect-backed components, changes to Foldkit commands, Jazz streams, API adapters and service lifetimes, also follow [Effect TS 4 — Patchboard development practices](EFFECT_TS_PRACTICES.md). The supplement adds links to official **Effect 4**, not Effect 3, sources and explains typed errors, service/Layer boundaries, `Effect.gen`, scoped resources, bounded concurrency and runtime-edge execution. It does **not** authorize unreviewed package upgrades or a sweeping refactor of existing working adapters.

For each PR or architecture ADR, document: the first failing test, ownership of effects and scoped resources, input/error contracts, idempotency/authorization behavior, tests run (`pnpm verify` plus `pnpm test:private:ci` where applicable) and live browser/MCP evidence. Exceptions to the mandatory principles require a reason and review.

## Canonical sources

- [CAFE development contract](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/AGENTS.md)
- [CAFE repository, commands and pipeline](https://github.com/Effect-TS/cafe/blob/24b11ca81ff476386c5b428d425ad2ee50cb4c66/README.md)
- [CAFE agent playbooks](https://github.com/Effect-TS/cafe/tree/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.agents/skills)
- [CAFE CI and cleanup](https://github.com/Effect-TS/cafe/tree/24b11ca81ff476386c5b428d425ad2ee50cb4c66/.github/workflows)
- [Patchboard Jazz examples and pinned code](CODE_REFERENCES.md)
