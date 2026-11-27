# Legacy Dim0 MCP package entry point

The canonical plugin source now lives in [`plugins/dim0/`](../../plugins/dim0/README.md),
modeled on the Teable manifest/portable-ZIP split.

Continue calling `node integrations/dim0-mcp-plugin/scripts/build.mjs`
with `DIM0_MCP_URL` and optional `DIM0_PLUGIN_OUTPUT_DIR`. The wrapper
delegates to `scripts/package-dim0-openai.mjs`, maintaining the original
default staging and ZIP paths, with added asset/skill and safety validation.

For current installation, OAuth identity, tools, and the temporary-hostname
warning see [the canonical plugin README](../../plugins/dim0/README.md).
