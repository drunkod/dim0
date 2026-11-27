# Effect TS 4 — Patchboard development practices

**Status:** Mandatory development guidance for future Patchboard architecture and implementation, adopted 21 November 2026. **Compatibility baseline:** the repository pins `effect@4.0.0`, TypeScript `7.0.2`, Foldkit `0.165.0`, and Jazz `2.0.0-alpha.69` in `pnpm-workspace.yaml`. Do not silently upgrade, substitute Effect 3 APIs, or change the Jazz security model. This file adds *Effect-specific* explanations to the existing [CAFE development cycle](DEVELOPMENT_CYCLE.md), [source reference index](CODE_REFERENCES.md), and root [AGENTS.md](../AGENTS.md); it does not replace those documents.

## Authority and provenance

- **Original Patchboard rules (mandatory):** The CAFE red/green/refactor and review cycle, pure Foldkit `Model / Message / update / view`, Commands for writes, `ManagedResource` and subscriptions for reads, named `Effect.fn("Domain.operation")` for business operations, Effect Config, real Jazz permission/persistence tests, Story and Scene coverage, independent-browser evidence and `pnpm verify`. These are already defined by [DEVELOPMENT_CYCLE.md](DEVELOPMENT_CYCLE.md) and [AGENTS.md](../AGENTS.md).
- **Official Effect 4 guidance (adopted as a project preference):** Typed expected errors, service/Layer dependency injection, resource scopes/finalizers, Effects executed at application boundaries, bounded concurrency and deterministic testing. These come from the *version-4* official references below, not from the historical CAFE repository. Any version-sensitive API must be checked against **installed** `effect@4.0.0` types before coding.
- **Architectural expectations (newly clarified):** A proposed design and PR must show how it meets these rules, and document any justified deviations. Existing code is **not** automatically declared noncompliant; do not mass-rewrite working demo adapters without a failing test and a specific architectural benefit.

## Required implementation rules

1. **Pure UI and clearly owned effects.** Keep Foldkit `update` and `view` deterministic and free of I/O. Model state changes with typed messages. Commands coordinate writes and map failures to messages. Long-lived Jazz subscriptions should be scoped managed resources/Effect Streams and cleaned up on board change, sign-out, interruption and shutdown. Do not introduce a second UI state manager or bypass the private board's server-side authorization.
2. **Named, composable domain operations.** Prefer `Effect.fn("Domain.operation")` for named reusable domain functions and `Effect.gen` / `yield*` for sequential composition. Use `Effect.fnUntraced` only when justified by profiling or a utility's tracing needs, checking its installed v4 signature. Keep core logic in Effects instead of scattering `async/await`, one-off `new Promise`, and `Effect.runPromise` across the domain. Use Promise-based adapters at SDK/framework edges where required.
3. **Explicit input contracts and error channels.** Decode external request, MCP and persisted-input boundaries with the appropriate checked schema (Effect Schema when composing with Effect; existing validated adapters may retain their tested validator). Represent expected domain failures, including `NotFound`, `Forbidden`, conflicts and malformed input, as typed/tagged errors; recover intentionally (for example by error tag). Unexpected defects must stay visible in logs/tracing instead of being silently caught or turned into a success-shaped value.
4. **Service dependencies through interfaces and Layers.** Define service contracts for external adapters such as Jazz persistence, OAuth/session validation, time, HTTP and configuration where they improve testability. Build implementations in Layers at composition/bootstrap boundaries. Avoid having every service operation expose its implementation's dependency requirements; provide those in the service's Layer. Do not invent new indirection for a trivial local helper.
5. **Scoped lifetimes and cancellation.** For sessions, Jazz WebSockets, subscriptions, files and server processes, define an acquisition *and* finalizer (`Effect.acquireRelease`, `Effect.scoped` or Foldkit's managed resource abstraction). Test cleanup on navigation, logout, interruption and restart, not just the successful happy path. Avoid unmanaged background work.
6. **Bounded concurrency, safe retries and durable writes.** Explicitly bound any fan-out via Effect concurrency controls. Apply timeouts/retries only after considering cancellation and idempotency. Never blindly retry unauthorized writes, OAuth exchanges or non-idempotent mutations. Preserve Patchboard's server-checked board scope, immutable author IDs and actor-scoped request-ID receipts; a retry with the same request ID must not duplicate a note.
7. **Run Effects at edges; observe failures.** Prefer composing Effects until the HTTP handler, MCP callback, CLI/bootstrap or Foldkit runtime boundary, then use the appropriate execution function (`runPromise`, `runFork` etc.). Keep typed errors, causes, logs and traces meaningful and redact tokens, passkeys, invitations and private board data. Do not emit secrets as test evidence.
8. **Test at the correct boundary.** Start with a failing, observable assertion. Use pure Story tests for Model/Command behavior, Scene for rendered interactions, test services/Layers and deterministic time (`TestClock` where applicable), real Jazz integration for permissions/transactions/restart, browser tests for live subscriptions, and actual MCP/OAuth protocol tests for remote behavior. Validate both viewer denial and authorized owner/editor behavior. Run `pnpm verify` **and** the separate `pnpm test:private:ci` where private OAuth is affected; green TypeScript checks alone are insufficient.
9. **Respect pinned APIs and small changes.** Check Effect's **v4** documentation and installed types, the pinned Jazz alpha and the CAFE/Foldkit examples before adopting code snippets. Make the smallest test-backed change in an isolated worktree with its own fixture data and ports; include a PR explanation, exact commands, failing/passing evidence and author/permission implications. Do not reconfigure Funnel or alter live SQLite as part of a style change.

## Architecture and PR review evidence

Every proposed **new** component and material refactor should answer:

- Which state belongs to the pure UI, which operations are `Effect` programs, and which Layers/managed resources provide their dependencies and lifetimes?
- How are error types and validation represented at every untrusted boundary? Which errors are recoverable and which are defects?
- Where is `Effect.run*` called? Which calls are adapters to promise-only APIs, and which are domain work that should remain composable?
- What cleanup, cancellation, retry, timeout, permissions and duplicate-prevention behavior is expected? How is it tested?
- Which Story/Scene, Jazz integration, MCP/OAuth and real-browser checks prove the feature, and what is still unverified?

**Release gate:** An architect or reviewer must document any intentional exception to this guidance, including reasons and safeguards. Passing a build does not excuse authorization bypasses, unbounded background work or missing resource cleanup.

## Official upstream references (checked 21 Nov 2026)

These are **external Effect 4** sources, separate from the user-authored Patchboard/CAFE rules:

- [Effect 4 onboarding and Effect type](https://effect.website/docs/v4/onboarding) — treat effects as values with success, error and service requirements.
- [Effects and generators](https://effect.website/docs/v4/getting-started/using-generators) — compose sequential effects with `Effect.gen`.
- [Expected typed errors](https://effect.website/docs/v4/error-management/expected-errors) and [unexpected defects](https://effect.website/docs/v4/error-management/two-error-types) — don't swallow failures.
- [Services](https://effect.website/docs/v4/requirements-management/services) and [Layers](https://effect.website/docs/v4/requirements-management/layers) — dependency isolation and test replacements.
- [Resource scope and finalizers](https://effect.website/docs/v4/resource-management/scope) — deterministic release of owned resources.
- [Running Effects](https://effect.website/docs/v4/getting-started/running-effects) — execution at the application's boundaries.
- [Basic concurrency](https://effect.website/docs/v4/concurrency/basic-concurrency) — choose controlled concurrency rather than unbounded fan-out.
- [TestClock](https://effect.website/docs/v4/testing/testclock) — deterministic time-based assertions.
- [Effect official repository](https://github.com/Effect-TS/effect) and [maintained coding-agent skill collection](https://github.com/Effect-TS/skills) — optional supporting material; install/reuse only after checking version and scope.

**Version note:** Links always point to the **v4** guides. Effect updates and live guides may change after this review. This document does not authorize an unreviewed dependency upgrade, and no new runtime dependency is required merely to adopt these practices.
