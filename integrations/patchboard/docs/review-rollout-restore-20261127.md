# Operational restore rehearsal — 2026-11-27

Base application: 82c1f9a74a3fe8cc2ae975ab6f44f6eba6d505a9.
Node 24.22.3; pnpm 12.11.2; Jazz 2.0.0-beta.5. Project-local Jazz skill,
upstream backup/restore guidance, pinned beta.5 signal implementation and
CodeGraph used. Both baseline post-merge workflows passed (5 + 3 jobs).

Before fix: actual isolated direct Node SIGTERM exited by signal (-15);
the first native restore rehearsal failed its clean-stop check before
taking any copy. The pinned SDK removes its own drain listeners, awaits
Jazz close and re-raises a signal if no other listener remains. The private
application's once-listener was removed before HTTP/auth close. The fix
retains guarded application handlers until both closes complete.
After fix: SIGTERM and SIGINT regression, server typecheck, lint (one
pre-existing unused-import warning), schema/private-policy generation and
initial native backup/restore passed. A synthetic launchd job passed
bootstrap, health, bootout, new PRIVATE_AUTH_STOPPED marker and lsof no
open files (418 ms bootout-to-marker/check). No real service modified.

Exact-head native rehearsal results will be appended after execution.
This document is not a public release approval.
