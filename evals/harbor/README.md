# Harbor benchmark tooling for Goose

A small command-line tool for running and comparing terminal-bench-style
benchmarks against different agent harnesses, models, and goose builds.

## What's here

```
evals/harbor/
  cmd.py                   entry point: argparse + dispatch
  runner.py                `run` subcommand: build harbor config, launch
  agent.py                 GooseBinaryAgent (loaded by harbor's worker)
  reporter.py              list/show/task/compare/rm/pull subcommands
  config_template.yaml     goose config template; --extensions toggles enabled
  .agents/skills/          skills for delegating per-task deep-dives
  runs/                    per-job outputs (gitignored)
  .env                     secrets (gitignored)
```

## Setup

Requires `uv`, Docker, and `rsync` on the host. `cmd.py` is a
[PEP 723 inline-uv script](https://peps.python.org/pep-0723/), so `uv` installs
its Python deps (just `harbor` and `PyYAML`) on first run.

Secrets live in a `.env` file. `cmd.py` looks for one in the current working
directory first, then in this script's directory. Only the keys for the
provider you're using need to be set:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
DATABRICKS_HOST=https://...
DATABRICKS_TOKEN=...
OPENAI_API_KEY=sk-...
```

## Running a goose benchmark

The `run` subcommand builds a harbor config that uses our `GooseBinaryAgent`
adapter — it uploads your local goose binary into each task container,
generates a `config.yaml` from the template with the requested extensions
flipped on, runs the recipe, and streams JSON output.

```bash
# Pin a specific binary, default everything else
./evals/harbor/cmd.py run /path/to/goose --job-name my-run

# Different model
./evals/harbor/cmd.py run /path/to/goose \
  --model anthropic/claude-opus-4-5 --job-name opus-run

# OpenRouter
./evals/harbor/cmd.py run /path/to/goose \
  --model openrouter/nvidia/nemotron-3-nano-30b-a3b \
  --job-name nemotron-smoke

# Subset of tasks (note: harbor wants the qualified form)
./evals/harbor/cmd.py run /path/to/goose \
  --tasks terminal-bench/fix-git,terminal-bench/extract-elf \
  --job-name smoke

# Toggle which extensions are enabled in config.yaml
./evals/harbor/cmd.py run /path/to/goose \
  --extensions developer,todo,codemode --job-name codemode-run

# Double the per-task timeout (useful for rerunning AgentTimeoutError trials)
./evals/harbor/cmd.py run /path/to/goose \
  --timeout-multiplier 2.0 \
  --tasks terminal-bench/oom,terminal-bench/compile-vim \
  --job-name oom-retry-2x
```

Defaults:
- dataset: `terminal-bench/terminal-bench-2`
- model: `anthropic/claude-sonnet-4-6`
- extensions: `developer,todo`
- concurrency: 4
- max turns: 100
- trials: 1
- installs `libgomp1` in each container (disable with `--no-install-goose-runtime-deps`)

Use `--dry-run` to print the generated harbor config without launching.

## Running a non-goose harness

Stock harnesses that harbor ships with (opencode, pi, aider, claude-code, ...)
don't need our adapter — they install themselves in the container and read
secrets from env. Write a harbor YAML config directly and call `harbor run`:

```yaml
# opencode-sonnet46-full.yaml
job_name: opencode-sonnet46-full
jobs_dir: /path/to/goose/evals/harbor/runs    # so cmd.py picks it up
n_attempts: 1
n_concurrent_trials: 4
environment:
  type: docker
  force_build: false
  delete: true
  env:
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
agents:
  - import_path: harbor.agents.installed.opencode:OpenCode
    model_name: anthropic/claude-sonnet-4-6
datasets:
  - name: terminal-bench/terminal-bench-2
```

```bash
export ANTHROPIC_API_KEY=...
uv tool install harbor
harbor run -c opencode-sonnet46-full.yaml
```

The output lands under `evals/harbor/runs/opencode-sonnet46-full/`, alongside
goose runs. `cmd.py list / show / compare` treats them identically — they're
all harbor `TrialResult` JSON under the hood.

For pi specifically you can lift the existing config we used:

```yaml
agents:
  - import_path: harbor.agents.installed.pi:Pi
    model_name: anthropic/claude-sonnet-4-6
    kwargs:
      thinking: "off"
```

## Inspecting results

`cmd.py list` shows every run under `runs/` with one line per job:

```bash
./evals/harbor/cmd.py list
```

Drill into a specific run:

```bash
./evals/harbor/cmd.py show <job_name>                  # all tasks
./evals/harbor/cmd.py show <job_name> --status error   # filter by outcome
./evals/harbor/cmd.py show <job_name> --status timeout
```

Drill into a single task in a single run:

```bash
./evals/harbor/cmd.py task <job_name> <task_name>
./evals/harbor/cmd.py task <job_name> <task_name> --tail 50   # tail agent log
```

Compare two runs head-to-head:

```bash
./evals/harbor/cmd.py compare <job_a> <job_b>           # summary
./evals/harbor/cmd.py compare <job_a> <job_b> -v        # plus per-task diffs
```

Delete runs:

```bash
./evals/harbor/cmd.py rm <job_name> [<job_name> ...]    # confirms by default
./evals/harbor/cmd.py rm <job_name> -y                  # skip the prompt
```

## Syncing runs between machines

If you run benchmarks on a remote box and want to inspect them locally:

```bash
# Pull everything
./evals/harbor/cmd.py pull tbench@douwe.com:/home/tbench/work/goose

# Just specific jobs
./evals/harbor/cmd.py pull tbench@douwe.com:/home/tbench/work/goose \
  --jobs sonnet46-full pi-sonnet46-full

# Mirror exactly (delete local runs that aren't on the remote)
./evals/harbor/cmd.py pull tbench@douwe.com:/home/tbench/work/goose --delete
```

The remote argument is `user@host:/path/to/goose` — `pull` appends
`evals/harbor/runs/` to it and rsyncs into the local `runs/`.

## A typical comparison workflow

```bash
# Run two configurations on the remote (in screen / mosh / tmux)
ssh tbench@douwe.com
cd /home/tbench/work/goose
./evals/harbor/cmd.py run ./target/release/goose --job-name baseline
./evals/harbor/cmd.py run ./target/release/goose \
  --extensions developer,todo,codemode --job-name codemode

# Pull results locally
./evals/harbor/cmd.py pull tbench@douwe.com:/home/tbench/work/goose \
  --jobs baseline codemode

# Diff
./evals/harbor/cmd.py compare baseline codemode -v
```

For deeper per-task understanding (why did A pass and B fail on this one
task?), see the `compare_tasks` skill under `.agents/skills/`. Delegate to
it with the two job names and a task name and it will read both
trajectories, the task spec, and the verifier output, then explain the
mechanism behind the divergence.

## How the goose adapter works

`cmd.py run` builds a harbor config that:

- Points harbor at `agent:GooseBinaryAgent` (loaded from `agent.py`; harbor's
  worker imports it with `PYTHONPATH=evals/harbor/`).
- Forwards provider secrets from the host shell into the task container via
  harbor's `environment.env`.
- Renders `config_template.yaml` with the requested extensions' `enabled`
  flipped to `true`, and uploads the result as the container's
  `~/.config/goose/config.yaml`.
- Uploads the goose binary, symlinks it on `PATH`, runs the recipe, captures
  stream-json output to `goose.txt`, and afterwards extracts input/output
  token counts and cost from the `complete` event for harbor's per-trial
  metrics.

Per-trial artifacts under `runs/<job>/<task>.<attempt>/` include the
agent's stream-json log, the verifier's stdout/stderr, and a harbor
`result.json` with the structured outcome.
