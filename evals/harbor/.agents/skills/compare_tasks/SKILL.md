---
name: compare_tasks
description: Compare how two harbor benchmark runs performed on a single shared task — read both trajectories, the task spec, and the verifier output, and explain what each agent did, why the outcomes differ, and any generalizable lesson.
---

# Compare two harbor runs on one task

Use when given two harbor run names and a task name, and the goal is to understand
*why* the two runs differ on that task — not just *that* they differ.

## Inputs

- `RUN_A`: harbor run name (e.g. `sonnet46-full`)
- `RUN_B`: harbor run name (e.g. `pi-sonnet46-full`)
- `TASK`: bare task name (e.g. `extract-elf`, not `terminal-bench/extract-elf`)
- `RUNS_DIR`: defaults to `evals/harbor/runs/` relative to the repo root

## Procedure

### 1. Headline facts

For each run, read `RUNS_DIR/<run>/<task>.1/result.json` and extract:

- status (derive from `result.score` + `agent.error.error_type`):
  - error if `agent.error` is set
  - timeout if the error_type contains "timeout"
  - pass / partial / fail based on `result.score` (>=1 / >0 / 0)
  - no-reward if `result` is null
- reward: `result.score`
- duration: `total_duration_seconds`
- tokens: `agent_metrics.n_input_tokens`, `agent_metrics.n_output_tokens`
- error class (if any): `agent.error.error_type`

If either run doesn't have the task, stop and say so.

### 2. Read the task spec

For terminal-bench-2 tasks, the dataset is cached at
`~/.cache/harbor/datasets/terminal-bench__terminal-bench-2__*/tasks/<task>/`.

Read:
- `instruction.md` — what the agent was asked to do
- `tests/test_outputs.py` or `run-tests.sh` — what the verifier actually checks
- `solution/` if present — what a correct answer looks like

Without these three you can't tell whether a wrong answer was a misread, a
shallow bug, or a verifier surprise.

### 3. Read each agent's trajectory

The agent log is at `RUNS_DIR/<run>/<task>.1/agent/<agent>.txt`
(usually `goose.txt` or `pi.txt` — check the directory).

Skim, don't quote in full. For each agent identify:

- the approach it took (e.g. "wrote a Python script that walks the ELF section
  headers")
- the final artifacts it left in the container (file paths it created or
  modified)
- for losers, the **failure mode** — one of:
  - misread the spec (wrong assumption about input/output)
  - right approach, shallow bug (off-by-one, wrong encoding, wrong base address)
  - ran out of clock (timeout) — note whether it was still making progress or
    had gone in circles
  - diverged into an unproductive thread (e.g. debugging a non-issue)
  - the verifier expected something the spec didn't telegraph

### 4. Read the verifier output

`RUNS_DIR/<run>/<task>.1/verifier/` contains the verifier's stdout/stderr.
This is often more diagnostic than the agent log — it tells you exactly which
assertion failed and what the agent's output was at that point.

### 5. Produce the comparison

Output markdown with these sections in order:

- **Headline** (1 line): who won, by how much (reward + cost / duration if
  meaningful).
- **What A did** (2-4 sentences): plan, final artifact, verifier outcome.
- **What B did** (2-4 sentences): same shape as A.
- **Why outcomes differ** (2-4 sentences): the actual mechanism. Not "B was
  smarter" but "B's script used `nm -n` so its addresses matched the verifier's
  ground truth, A's script used PIE-relocated virtual addresses which the
  verifier doesn't normalize".
- **Generalizable lesson** (optional, 1-2 sentences): is this a pattern that
  probably affects other tasks, or a one-off accident of this verifier? Skip
  if unclear from one task.

## Tools you'll need

- file reads against `RUNS_DIR/<run>/<task>.1/`
- file reads against the dataset cache
- `jq` is useful for `result.json` but not required

`evals/harbor/cmd.py task <run> <task>` gives a formatted summary but operates
on the same data — prefer reading the json directly if any number matters.
