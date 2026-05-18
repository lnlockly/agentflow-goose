# goose-sdk

The Goose SDK exposes Goose's agent functionality outside of the main `goose` binary

## 1. ACP client/server (default)

With default features, this crate is a thin Rust library re-exporting the shared types so you can build an Agent Client Protocol client that talks to `goose acp` (or any ACP-compatible Goose server) over stdio.

See `examples/acp_client.rs`:

```bash
cargo run -p goose-sdk --example acp_client -- "What is 2 + 2?"
```

This path has no dependency on the `goose` core crate — it speaks to Goose as an external process via ACP + Goose's custom `_goose/*` JSON-RPC methods.

## 2. uniffi bindings (Python / Kotlin)

With `--features uniffi`, the crate compiles as a `cdylib`/`staticlib` that embeds the `goose` core in-process and exposes an `Agent` object to Python and Kotlin via [uniffi-rs](https://github.com/mozilla/uniffi-rs).

Build the library, generate bindings, and run the example pings:

```bash
just python   # generates Python bindings + runs examples/uniffi/ping_aaif.py
just kotlin   # generates Kotlin bindings + runs examples/uniffi/PingAaif.kt
```

Generated bindings land in `generated/uniffi/`. The shared types from `goose-sdk-types` appear as native records in both languages.

## When to use which

- **ACP** — embedding Goose as a subprocess from any language with an ACP client, language-agnostic, full feature surface via JSON-RPC.
- **uniffi** — embedding the Goose agent directly in a Python or Kotlin host process, no subprocess, type-safe native bindings, currently a minimal agent surface.

## Shared types: `goose-sdk-types`

The `goose-sdk-types` crate holds the wire types used by both consumers above — request/response structs for Goose's custom JSON-RPC ACP methods (`AddExtensionRequest`, `GooseToolCallRequest`, provider/session/sources/dictation requests, etc.) and the streaming `AgentEvent`, `ExtensionSpec`, and `ProviderSpec` records.

Keeping these types in a small, dependency-light crate lets the ACP path serialize/deserialize them as JSON-RPC and the uniffi path expose them as native records in Python/Kotlin — from one source of truth.
