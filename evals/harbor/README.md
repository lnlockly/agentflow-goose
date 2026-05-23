# Harbor benchmark runner for Goose

Single-file tool (`cmd.py`) for running Harbor benchmarks with a caller-provided
Goose binary, and for inspecting the results.

## Setup

Requires `uv`, `harbor`, and Docker on the host. The `cmd.py` script uses
[PEP 723 inline metadata](https://peps.python.org/pep-0723/) — `uv` will install
its Python dependencies (just `harbor` and `PyYAML`) on first run.

Drop a `.env` file in this directory with the secrets you need:

```
ANTHROPIC_API_KEY=sk-ant-...
DATABRICKS_HOST=https://...
DATABRICKS_TOKEN=...
OPENAI_API_KEY=sk-...
```

Only the keys for the provider you're using need to be set. `cmd.py` checks
that the right ones are present before launching a run.

## Run a benchmark

```bash
# Common case: just point at a goose binary
./evals/harbor/cmd.py run /path/to/goose --job-name my-run

# Different model
./evals/harbor/cmd.py run /path/to/goose --model anthropic/claude-opus-4-5 --job-name opus-run

# Subset of tasks
./evals/harbor/cmd.py run /path/to/goose --tasks fix-git,extract-elf --job-name smoke

# Enable a non-default extension
./evals/harbor/cmd.py run /path/to/goose --extensions developer,todo,codemode --job-name codemode-run

# Bump the timeout (useful when rerunning AgentTimeoutError trials)
./evals/harbor/cmd.py run /path/to/goose --timeout-multiplier 2.0 --tasks oom,compile-vim
```

Defaults:
- dataset: `terminal-bench/terminal-bench-2`
- model: `anthropic/claude-sonnet-4-6`
- extensions: `developer,todo`
- concurrency: 4
- max turns: 100
- trials: 1
- installs `libgomp1` in each container (disable with `--no-install-goose-runtime-deps`)

Use `--dry-run` to write the harbor config without launching.

## Inspect results

```bash
./evals/harbor/cmd.py list
./evals/harbor/cmd.py show <job_name>
./evals/harbor/cmd.py show <job_name> --status error      # filter by status
./evals/harbor/cmd.py task <job_name> <task_name>
./evals/harbor/cmd.py task <job_name> <task_name> --tail 50
./evals/harbor/cmd.py compare <job_a> <job_b> -v
```

## Layout

```
evals/harbor/
  cmd.py                   single entry point (run + reporting)
  config_template.yaml     goose config template; --extensions toggles enabled flags
  configs/                 hand-written harbor configs (e.g. for the pi agent)
  runs/                    per-job outputs (gitignored)
  .env                     secrets (gitignored)
```

## How it works

`cmd.py run` builds a harbor JSON config that:
- Points harbor at `cmd:GooseBinaryAgent` (the agent class is in the same file).
- Forwards provider secrets from the host shell into the task container via
  harbor's `environment.env`.
- Sends a `config.yaml` rendered from `config_template.yaml` (with the requested
  extensions flipped to `enabled: true`) into the container.
- Uploads the goose binary, symlinks it on PATH, runs the recipe, captures
  stream-json output, and after-the-fact extracts input/output token counts
  and cost from the `complete` event.
