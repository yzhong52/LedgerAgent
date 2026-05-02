# Pending work

## Logging verbosity levels

Currently there are two env-var flags (`VERBOSE=1`, `DEBUG=1`) where `DEBUG` implies `VERBOSE`, plus a `--verbose` CLI flag on the `sync` command. This is a bit inconsistent.

**Idea:** Replace with two named CLI flags `--verbose` / `--debug` (or a numeric `--log-level`) so the hierarchy is explicit and discoverable, and env vars aren't needed for normal use.

Things to reconcile:
- `VERBOSE` in `src/agent/index.ts` and `src/agent/cache.ts` are read directly from `process.env`
- `--verbose` flag on `sync` sets `process.env.VERBOSE = '1'` as a side effect
- `DEBUG=1` is env-var only (not wired to a CLI flag)
- `CLAUDE.md` documents `DEBUG=1` but not `VERBOSE=1`
