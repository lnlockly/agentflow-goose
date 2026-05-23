#!/usr/bin/env python3
"""Reporting tool for harbor benchmark runs.

Usage:
    report.py list
    report.py show <job_name>
    report.py task <job_name> <task_name>

Looks in evals/harbor/.runs/jobs by default. Override with --jobs-dir.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_JOBS_DIR = Path(__file__).resolve().parent / ".runs" / "jobs"


def load_job(job_dir: Path) -> dict[str, Any]:
    result_path = job_dir / "result.json"
    if not result_path.is_file():
        raise FileNotFoundError(f"No result.json in {job_dir}")
    return json.loads(result_path.read_text())


def trial_records(job: dict[str, Any]) -> list[dict[str, Any]]:
    return job.get("results") or job.get("trial_results") or []


def trial_reward(trial: dict[str, Any]) -> float | None:
    reward = trial.get("reward")
    if reward is not None:
        return reward
    result = trial.get("result")
    if isinstance(result, dict):
        return result.get("score")
    return None


def trial_error_class(trial: dict[str, Any]) -> str:
    error_class = trial.get("error_class")
    if error_class and error_class != "None":
        return error_class
    status = trial.get("trial_status")
    if status and status not in {"completed", "ok", "success"}:
        return status
    return ""


def trial_status(trial: dict[str, Any]) -> str:
    error_class = trial_error_class(trial)
    if error_class:
        if "Timeout" in error_class or "timeout" in error_class:
            return "timeout"
        return "error"
    reward = trial_reward(trial)
    if reward is None:
        return "no-reward"
    if reward >= 1.0:
        return "pass"
    if reward > 0:
        return "partial"
    return "fail"


def fmt_duration(sec: float | None) -> str:
    if sec is None:
        return "-"
    if sec < 60:
        return f"{sec:.0f}s"
    if sec < 3600:
        return f"{sec / 60:.1f}m"
    return f"{sec / 3600:.1f}h"


def fmt_tokens(n: int | None) -> str:
    if n is None or n == 0:
        return "-"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(n)


def fmt_cost(usd: float | None) -> str:
    if usd is None or usd == 0:
        return "-"
    return f"${usd:.2f}"


def task_name(trial: dict[str, Any]) -> str:
    task_id = trial.get("task_id")
    if isinstance(task_id, dict):
        name = task_id.get("name")
        if name:
            return name
    elif isinstance(task_id, str) and task_id:
        return task_id.split("/", 1)[-1]
    return trial.get("trial_name", "?").rsplit(".", 1)[0]


def trial_duration(trial: dict[str, Any]) -> float | None:
    return (
        trial.get("duration_seconds")
        or trial.get("duration_sec")
        or trial.get("total_duration_seconds")
    )


def job_duration(job: dict[str, Any]) -> float | None:
    if job.get("duration_seconds") or job.get("duration_sec"):
        return job.get("duration_seconds") or job.get("duration_sec")
    # Old schema: sum trial durations (approximate; ignores concurrency)
    trials = trial_records(job)
    durations = [trial_duration(t) for t in trials]
    valid = [d for d in durations if d]
    return max(valid) if valid else None


def trial_metric(trial: dict[str, Any], key: str) -> Any:
    if key in trial:
        return trial[key]
    metrics = trial.get("metrics")
    if isinstance(metrics, dict):
        return metrics.get(key)
    return None


def job_model(job: dict[str, Any]) -> str:
    config_agents = (job.get("config") or {}).get("agents") or []
    if config_agents:
        model = config_agents[0].get("model_name")
        if model:
            return model
    trials = trial_records(job)
    for trial in trials:
        agent = trial.get("agent")
        if isinstance(agent, dict) and agent.get("model"):
            return agent["model"]
        agent_info = trial.get("agent_info")
        if isinstance(agent_info, dict) and agent_info.get("model_name"):
            return agent_info["model_name"]
    return "?"


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_list(args: argparse.Namespace) -> int:
    jobs_dir = args.jobs_dir
    if not jobs_dir.is_dir():
        print(f"No jobs directory at {jobs_dir}", file=sys.stderr)
        return 1

    rows: list[tuple[str, str, int, int, int, int, int, str, str]] = []
    for child in sorted(jobs_dir.iterdir()):
        if not child.is_dir():
            continue
        try:
            job = load_job(child)
        except FileNotFoundError:
            continue
        trials = trial_records(job)
        counts = {"pass": 0, "partial": 0, "fail": 0, "timeout": 0, "error": 0, "no-reward": 0}
        for trial in trials:
            counts[trial_status(trial)] += 1
        total = len(trials)
        pass_rate = f"{100 * counts['pass'] / total:.1f}%" if total else "-"
        model = job_model(job)
        rows.append(
            (
                child.name,
                model,
                counts["pass"],
                counts["partial"],
                counts["fail"],
                counts["timeout"],
                counts["error"],
                pass_rate,
                fmt_duration(job_duration(job)),
            )
        )

    if not rows:
        print(f"No jobs found in {jobs_dir}")
        return 0

    print(
        f"{'job_name':<40} {'model':<35} {'pass':>5} {'part':>5} {'fail':>5} "
        f"{'tout':>5} {'err':>4} {'rate':>7} {'wall':>6}"
    )
    print("-" * 124)
    for row in rows:
        print(
            f"{row[0]:<40} {row[1]:<35} {row[2]:>5} {row[3]:>5} {row[4]:>5} "
            f"{row[5]:>5} {row[6]:>4} {row[7]:>7} {row[8]:>6}"
        )
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    job_dir = args.jobs_dir / args.job_name
    job = load_job(job_dir)
    trials = trial_records(job)

    counts = {"pass": 0, "partial": 0, "fail": 0, "timeout": 0, "error": 0, "no-reward": 0}
    for trial in trials:
        counts[trial_status(trial)] += 1
    total = len(trials)

    print(f"Job:          {job.get('job_name')}")
    print(f"Model:        {job_model(job)}")
    print(f"Started:      {job.get('started_at')}")
    print(f"Wall clock:   {fmt_duration(job_duration(job))}")
    print(f"Trials:       {total}")
    print(
        f"  pass={counts['pass']}  partial={counts['partial']}  fail={counts['fail']}  "
        f"timeout={counts['timeout']}  error={counts['error']}  no-reward={counts['no-reward']}"
    )
    if total:
        print(f"Pass rate:    {100 * counts['pass'] / total:.1f}%")
    total_input = sum((trial_metric(t, 'n_input_tokens') or 0) for t in trials)
    total_output = sum((trial_metric(t, 'n_output_tokens') or 0) for t in trials)
    total_cost = sum((trial_metric(t, 'cost_usd') or 0.0) for t in trials)
    print(f"Tokens:       in={fmt_tokens(total_input)}  out={fmt_tokens(total_output)}")
    print(f"Cost:         {fmt_cost(total_cost)}")
    print()

    filter_status = args.status
    print(
        f"{'task':<45} {'status':<10} {'reward':>7} {'dur':>7} "
        f"{'in':>7} {'out':>7} {'cost':>7}  error"
    )
    print("-" * 130)
    for trial in sorted(trials, key=task_name):
        status = trial_status(trial)
        if filter_status and status != filter_status:
            continue
        name = task_name(trial)
        reward = trial_reward(trial)
        reward_str = f"{reward:.2f}" if reward is not None else "-"
        err = trial_error_class(trial)
        msg = (trial.get("error_message") or "").splitlines()[0] if trial.get("error_message") else ""
        err_str = f"{err}: {msg}" if err and msg else err
        if len(err_str) > 50:
            err_str = err_str[:47] + "..."
        print(
            f"{name:<45} {status:<10} {reward_str:>7} "
            f"{fmt_duration(trial_duration(trial)):>7} "
            f"{fmt_tokens(trial_metric(trial, 'n_input_tokens')):>7} "
            f"{fmt_tokens(trial_metric(trial, 'n_output_tokens')):>7} "
            f"{fmt_cost(trial_metric(trial, 'cost_usd')):>7}  {err_str}"
        )
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    job_a = load_job(args.jobs_dir / args.job_a)
    job_b = load_job(args.jobs_dir / args.job_b)

    def by_task(job: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {task_name(t): t for t in trial_records(job)}

    a_by_task = by_task(job_a)
    b_by_task = by_task(job_b)

    all_tasks = sorted(set(a_by_task) | set(b_by_task))
    only_a = sorted(set(a_by_task) - set(b_by_task))
    only_b = sorted(set(b_by_task) - set(a_by_task))
    common = sorted(set(a_by_task) & set(b_by_task))

    def counts(job: dict[str, Any]) -> dict[str, int]:
        out = {"pass": 0, "partial": 0, "fail": 0, "timeout": 0, "error": 0, "no-reward": 0}
        for trial in trial_records(job):
            out[trial_status(trial)] += 1
        return out

    ca, cb = counts(job_a), counts(job_b)
    na, nb = len(trial_records(job_a)), len(trial_records(job_b))

    print(f"A: {args.job_a}  ({job_model(job_a)})")
    print(f"B: {args.job_b}  ({job_model(job_b)})")
    print()
    print(f"{'metric':<18} {'A':>10} {'B':>10}  {'diff':>8}")
    print("-" * 50)

    def row(label: str, a: float | int, b: float | int, fmt: str = "{:.0f}") -> None:
        diff = b - a
        print(f"{label:<18} {fmt.format(a):>10} {fmt.format(b):>10}  {fmt.format(diff):>+8}")

    row("trials", na, nb)
    row("pass", ca["pass"], cb["pass"])
    row("partial", ca["partial"], cb["partial"])
    row("fail", ca["fail"], cb["fail"])
    row("timeout", ca["timeout"], cb["timeout"])
    row("error", ca["error"], cb["error"])
    if na and nb:
        row("pass rate %", 100 * ca["pass"] / na, 100 * cb["pass"] / nb, "{:.1f}")

    total_in_a = sum((trial_metric(t, 'n_input_tokens') or 0) for t in trial_records(job_a))
    total_in_b = sum((trial_metric(t, 'n_input_tokens') or 0) for t in trial_records(job_b))
    total_out_a = sum((trial_metric(t, 'n_output_tokens') or 0) for t in trial_records(job_a))
    total_out_b = sum((trial_metric(t, 'n_output_tokens') or 0) for t in trial_records(job_b))
    total_cost_a = sum((trial_metric(t, 'cost_usd') or 0.0) for t in trial_records(job_a))
    total_cost_b = sum((trial_metric(t, 'cost_usd') or 0.0) for t in trial_records(job_b))
    print(f"{'tokens in':<18} {fmt_tokens(total_in_a):>10} {fmt_tokens(total_in_b):>10}")
    print(f"{'tokens out':<18} {fmt_tokens(total_out_a):>10} {fmt_tokens(total_out_b):>10}")
    print(f"{'cost':<18} {fmt_cost(total_cost_a):>10} {fmt_cost(total_cost_b):>10}")
    print(f"{'wall clock':<18} {fmt_duration(job_duration(job_a)):>10} {fmt_duration(job_duration(job_b)):>10}")

    if only_a or only_b:
        print()
        if only_a:
            print(f"Only in A ({len(only_a)}): {', '.join(only_a)}")
        if only_b:
            print(f"Only in B ({len(only_b)}): {', '.join(only_b)}")

    print()
    print(f"Task-level comparison ({len(common)} shared tasks):")

    transitions: dict[tuple[str, str], list[str]] = {}
    for name in common:
        sa = trial_status(a_by_task[name])
        sb = trial_status(b_by_task[name])
        transitions.setdefault((sa, sb), []).append(name)

    same_pass = transitions.get(("pass", "pass"), [])
    same_fail_like = [
        name
        for (sa, sb), names in transitions.items()
        if sa != "pass" and sb != "pass"
        for name in names
    ]
    a_only_pass = [name for (sa, sb), names in transitions.items() if sa == "pass" and sb != "pass" for name in names]
    b_only_pass = [name for (sa, sb), names in transitions.items() if sa != "pass" and sb == "pass" for name in names]

    print(f"  both pass:          {len(same_pass)}")
    print(f"  both not-pass:      {len(same_fail_like)}")
    print(f"  only A passes:      {len(a_only_pass)}")
    print(f"  only B passes:      {len(b_only_pass)}")

    if args.verbose:
        if a_only_pass:
            print()
            print(f"Only A ({args.job_a}) solved:")
            for name in sorted(a_only_pass):
                b_status = trial_status(b_by_task[name])
                print(f"  {name:<40} B={b_status}")
        if b_only_pass:
            print()
            print(f"Only B ({args.job_b}) solved:")
            for name in sorted(b_only_pass):
                a_status = trial_status(a_by_task[name])
                print(f"  {name:<40} A={a_status}")

    return 0


def cmd_task(args: argparse.Namespace) -> int:
    job_dir = args.jobs_dir / args.job_name
    job = load_job(job_dir)
    trials = trial_records(job)

    matches = [t for t in trials if task_name(t) == args.task_name]
    if not matches:
        names = sorted({task_name(t) for t in trials})
        print(f"No task '{args.task_name}' in {args.job_name}.", file=sys.stderr)
        print(f"Available: {', '.join(names[:10])}{'...' if len(names) > 10 else ''}", file=sys.stderr)
        return 1

    for trial in matches:
        trial_name = trial.get("trial_name", "?")
        print(f"=== {trial_name} ===")
        print(f"Status:       {trial_status(trial)}")
        print(f"Reward:       {trial_reward(trial)}")
        print(f"Duration:     {fmt_duration(trial_duration(trial))}")
        print(f"Started:      {trial.get('started_at')}")
        print(f"Ended:        {trial.get('ended_at')}")
        print(f"Tokens:       in={fmt_tokens(trial_metric(trial, 'n_input_tokens'))}  out={fmt_tokens(trial_metric(trial, 'n_output_tokens'))}")
        print(f"Cost:         {fmt_cost(trial_metric(trial, 'cost_usd'))}")
        error_class = trial_error_class(trial)
        if error_class:
            print(f"Error class:  {error_class}")
            msg = trial.get("error_message") or ""
            for line in msg.splitlines()[:10]:
                print(f"  {line}")
        verifier = trial.get("verifier_result") or trial.get("result") or {}
        if isinstance(verifier, dict) and verifier:
            score = verifier.get("score")
            if score is not None:
                print(f"Verifier:     score={score}")
            v_err = verifier.get("error")
            if v_err:
                print(f"  error: {str(v_err)[:200]}")
            v_out = verifier.get("output") or verifier.get("stdout") or ""
            if v_out:
                tail = "\n".join(str(v_out).splitlines()[-15:])
                print("  output (last 15 lines):")
                for line in tail.splitlines():
                    print(f"    {line}")

        trial_dir = job_dir / trial_name
        if trial_dir.is_dir():
            print(f"\nArtifacts in: {trial_dir}")
            agent_log = trial_dir / "agent" / "goose.txt"
            if not agent_log.is_file():
                agent_log = trial_dir / "agent" / "pi.txt"
            if agent_log.is_file():
                size = agent_log.stat().st_size
                print(f"  agent log: {agent_log.name} ({size:,} bytes)")
                if args.tail and size:
                    print(f"\n--- last {args.tail} lines of {agent_log.name} ---")
                    lines = agent_log.read_text(errors="replace").splitlines()
                    for line in lines[-args.tail:]:
                        print(line)
        print()
    return 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--jobs-dir", type=Path, default=DEFAULT_JOBS_DIR)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list all runs with summary stats")

    p_show = sub.add_parser("show", help="show per-task results for one run")
    p_show.add_argument("job_name")
    p_show.add_argument(
        "--status",
        choices=["pass", "partial", "fail", "timeout", "error", "no-reward"],
        help="filter to one status",
    )

    p_task = sub.add_parser("task", help="show details for one task in one run")
    p_task.add_argument("job_name")
    p_task.add_argument("task_name")
    p_task.add_argument("--tail", type=int, default=0, help="tail N lines of the agent log")

    p_cmp = sub.add_parser("compare", help="compare two runs task-by-task")
    p_cmp.add_argument("job_a")
    p_cmp.add_argument("job_b")
    p_cmp.add_argument("-v", "--verbose", action="store_true", help="list per-task diffs")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "list":
        return cmd_list(args)
    if args.cmd == "show":
        return cmd_show(args)
    if args.cmd == "task":
        return cmd_task(args)
    if args.cmd == "compare":
        return cmd_compare(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
