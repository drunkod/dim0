#!/usr/bin/env node
/**
 * Backwards-compatible entry point for existing Dim0 packager callers.
 * All packaging logic and canonical metadata live under plugins/dim0.
 */
await import("../../../scripts/package-dim0-openai.mjs");
