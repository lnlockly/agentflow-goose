#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["harbor==0.6.4", "PyYAML>=6.0"]
# ///
"""Harbor benchmark runner and reporter for Goose.

Subcommands:
    run        run a benchmark job
    list       list all runs in the runs/ directory
    show       per-task results for one run
    task       full detail for one task in one run
    compare    compare two runs task-by-task
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import yaml

from harbor.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from harbor.agents.installed.goose import Goose
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trajectories import FinalMetrics, Trajectory


HARBOR_DIR = Path(__file__).resolve().parent
RUNS_DIR = HARBOR_DIR / "runs"
CONFIGS_DIR = HARBOR_DIR / "configs"
CONFIG_TEMPLATE_PATH = HARBOR_DIR / "config_template.yaml"

DEFAULT_DATASET = "terminal-bench/terminal-bench-2"
DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
DEFAULT_EXTENSIONS = ["developer", "todo"]
DEFAULT_CONCURRENCY = 4
DEFAULT_MAX_TURNS = 100

CONTAINER_GOOSE_PATH_ROOT = "/installed-agent/goose-profile"
CONTAINER_CONFIG_PATH = f"{CONTAINER_GOOSE_PATH_ROOT}/config/config.yaml"
CONTAINER_RECIPE_PATH = "/installed-agent/harbor-recipe.yaml"
CONTAINER_CA_BUNDLE_PATH = "/installed-agent/ca-certificates.crt"

FATAL_GOOSE_NOTIFICATIONS = ("creditsExhausted",)

# Provider -> env vars to forward into the task container.
PROVIDER_SECRETS = {
    "anthropic": ["ANTHROPIC_API_KEY"],
    "openai": ["OPENAI_API_KEY"],
    "databricks": ["DATABRICKS_HOST", "DATABRICKS_TOKEN"],
    "google": ["GOOGLE_API_KEY"],
    "gemini": ["GEMINI_API_KEY"],
    "openrouter": ["OPENROUTER_API_KEY"],
}


# ---------------------------------------------------------------------------
# GooseBinaryAgent — runs a caller-provided goose binary inside the task container
# ---------------------------------------------------------------------------


class GooseBinaryAgent(Goose):
    """Run a caller-provided Goose binary in the benchmark environment.

    Differs from harbor's vanilla ``Goose``:
      * Uses a pre-built binary uploaded into the container (no curl install).
      * Generates ``config.yaml`` from ``config_template.yaml`` with a
        caller-specified set of enabled extensions.
      * Reads provider secrets from the harbor host env, not from a profile file.
    """

    def __init__(
        self,
        *args,
        goose_binary: str,
        config_yaml: str,
        extension_entries: list[dict[str, str]],
        install_goose_runtime_deps: bool = False,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.goose_binary = Path(goose_binary).expanduser().resolve()
        self.config_yaml = config_yaml
        self.extension_entries = extension_entries
        self.install_goose_runtime_deps = install_goose_runtime_deps
        self.ca_bundle_env_path: str | None = None

    @staticmethod
    def name() -> str:
        return "goose-binary"

    def get_version_command(self) -> str | None:
        return "/installed-agent/goose --version"

    def _run_env(self) -> dict[str, str]:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        provider, model = self.model_name.split("/", 1)
        env = {
            "GOOSE_MODEL": model,
            "GOOSE_PROVIDER": provider,
            "GOOSE_TELEMETRY_ENABLED": "false",
            "GOOSE_TELEMETRY_OFF": "true",
            "CONFIGURE": "false",
            "GOOSE_PATH_ROOT": CONTAINER_GOOSE_PATH_ROOT,
            "GOOSE_DISABLE_KEYRING": "true",
        }
        for key in PROVIDER_SECRETS.get(provider, []):
            value = os.environ.get(key)
            if value:
                env[key] = value
        if self.ca_bundle_env_path:
            env["SSL_CERT_FILE"] = self.ca_bundle_env_path
        return env

    def _host_ca_bundle(self) -> Path:
        for env_var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
            value = os.environ.get(env_var)
            if value and Path(value).expanduser().is_file():
                return Path(value).expanduser().resolve()
        for path in (
            Path("/etc/ssl/certs/ca-certificates.crt"),
            Path("/etc/ssl/cert.pem"),
            Path("/opt/homebrew/etc/ca-certificates/cert.pem"),
        ):
            if path.is_file():
                return path.resolve()
        raise FileNotFoundError("Could not find a host CA bundle to copy into the task container")

    async def _ensure_ca_bundle(self, environment: BaseEnvironment) -> None:
        result = await self.exec_as_root(
            environment,
            command=(
                "if [ -r /etc/ssl/certs/ca-certificates.crt ]; "
                "then echo present; else echo missing; fi"
            ),
            timeout_sec=10,
        )
        if result.stdout.strip() != "missing":
            return
        await environment.upload_file(self._host_ca_bundle(), CONTAINER_CA_BUNDLE_PATH)
        await self.exec_as_root(
            environment,
            command=f"chmod 644 {shlex.quote(CONTAINER_CA_BUNDLE_PATH)}",
            timeout_sec=10,
        )
        self.ca_bundle_env_path = CONTAINER_CA_BUNDLE_PATH

    async def _install_goose_runtime_deps(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "command -v apt-get >/dev/null 2>&1 || "
                "(echo 'install_goose_runtime_deps requires apt-get in the task container' >&2; exit 1); "
                "apt-get update && "
                "DEBIAN_FRONTEND=noninteractive apt-get install -y libgomp1"
            ),
            timeout_sec=300,
        )

    async def _agent_uid_gid(self, environment: BaseEnvironment) -> tuple[str, str]:
        result = await self.exec_as_agent(environment, command="id -u && id -g", timeout_sec=10)
        ids = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if len(ids) < 2:
            raise RuntimeError(f"Could not determine agent uid/gid: {result.stdout!r}")
        return ids[0], ids[1]

    async def _chown_to_agent_user(
        self, environment: BaseEnvironment, path: str, *, recursive: bool = False
    ) -> None:
        uid, gid = await self._agent_uid_gid(environment)
        flag = "-R " if recursive else ""
        await self.exec_as_root(
            environment,
            command=f"chown {flag}{shlex.quote(uid)}:{shlex.quote(gid)} {shlex.quote(path)}",
        )

    async def install(self, environment: BaseEnvironment) -> None:
        if not self.goose_binary.is_file():
            raise FileNotFoundError(f"Goose binary does not exist: {self.goose_binary}")

        await environment.upload_file(self.goose_binary, "/installed-agent/goose")
        await self.exec_as_root(environment, command="chmod 755 /installed-agent/goose")
        if self.install_goose_runtime_deps:
            await self._install_goose_runtime_deps(environment)
        await self._ensure_ca_bundle(environment)

        config_dir = f"{CONTAINER_GOOSE_PATH_ROOT}/config"
        await self.exec_as_root(
            environment, command=f"mkdir -p {shlex.quote(config_dir)}"
        )
        with TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.yaml"
            config_path.write_text(self.config_yaml)
            await environment.upload_file(config_path, CONTAINER_CONFIG_PATH)
        await self._chown_to_agent_user(environment, CONTAINER_GOOSE_PATH_ROOT, recursive=True)

        await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p ~/.local/bin && "
                "ln -sf /installed-agent/goose ~/.local/bin/goose && "
                "~/.local/bin/goose --version"
            ),
            env={
                "GOOSE_DISABLE_KEYRING": "true",
                "GOOSE_TELEMETRY_ENABLED": "false",
                "GOOSE_TELEMETRY_OFF": "true",
                "CONFIGURE": "false",
            },
            timeout_sec=30,
        )

    def _create_recipe_yaml(self, instruction: str) -> str:
        return yaml.dump(
            {
                "version": "1.0.0",
                "title": "harbor-task",
                "description": "harbor task recipe",
                "instructions": (
                    "You are given a task and you need to complete it. "
                    "You are currently executing in a docker container where you are "
                    "being evaluated on a benchmark for LLM agents. Act autonomously. "
                    "You will not receive any feedback on your progress, so you must "
                    "use your own tools to complete the task without any intervention."
                ),
                "prompt": instruction,
                "extensions": self.extension_entries,
            }
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        env = self._run_env()
        recipe_yaml = self._create_recipe_yaml(instruction)

        with TemporaryDirectory() as tmp:
            recipe_path = Path(tmp) / "harbor-recipe.yaml"
            recipe_path.write_text(recipe_yaml)
            await environment.upload_file(recipe_path, CONTAINER_RECIPE_PATH)
        await self._chown_to_agent_user(environment, CONTAINER_RECIPE_PATH)

        cli_flags = self.build_cli_flags()
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$PATH" && '
                f"goose run --recipe {shlex.quote(CONTAINER_RECIPE_PATH)} "
                "--output-format stream-json "
                + ((cli_flags + " ") if cli_flags else "")
                + "2>&1 | stdbuf -oL tee /logs/agent/goose.txt"
            ),
            env=env,
        )
        self._raise_on_fatal_goose_notification()

    def _raise_on_fatal_goose_notification(self) -> None:
        log_path = self.logs_dir / "goose.txt"
        if not log_path.is_file():
            return
        log_text = log_path.read_text(errors="replace")
        for notification in FATAL_GOOSE_NOTIFICATIONS:
            if f'"notificationType":"{notification}"' in log_text:
                raise NonZeroAgentExitCodeError(
                    f"Goose exited without running the task: {notification}. "
                    f"See {log_path} for details."
                )

    @staticmethod
    def _extract_complete_event_tokens(
        log_text: str,
    ) -> tuple[int | None, int | None, int | None]:
        total = inp = out = None
        for line in log_text.strip().split("\n"):
            line = line.strip()
            if not line or '"complete"' not in line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "complete":
                continue
            total = event.get("total_tokens")
            inp = event.get("input_tokens")
            out = event.get("output_tokens")
        return total, inp, out

    def _compute_cost_from_pricing(
        self, prompt_tokens: int | None, completion_tokens: int | None
    ) -> float | None:
        if not self.model_name or not (prompt_tokens or completion_tokens):
            return None
        try:
            import litellm
        except ImportError:
            return None
        pricing = None
        for key in (self.model_name, self.model_name.split("/", 1)[-1]):
            entry = litellm.model_cost.get(key)
            if entry:
                pricing = entry
                break
        if pricing is None:
            return None
        return (prompt_tokens or 0) * (pricing.get("input_cost_per_token") or 0.0) + (
            completion_tokens or 0
        ) * (pricing.get("output_cost_per_token") or 0.0)

    def populate_context_post_run(self, context: AgentContext) -> None:
        txt_path = self.logs_dir / "goose.txt"
        if not txt_path.exists():
            return
        log_text = txt_path.read_text()
        total, inp, out = self._extract_complete_event_tokens(log_text)
        if inp is not None:
            context.n_input_tokens = inp
        elif total is not None:
            context.n_input_tokens = total
        if out is not None:
            context.n_output_tokens = out
        cost = self._compute_cost_from_pricing(inp, out)
        if cost is not None:
            context.cost_usd = cost

        try:
            trajectory: Trajectory | None = self._convert_goose_stream_json_to_atif(
                log_text, str(uuid.uuid4())
            )
        except Exception:
            trajectory = None
        if trajectory:
            trajectory.final_metrics = FinalMetrics(
                total_steps=len(trajectory.steps),
                total_prompt_tokens=inp,
                total_completion_tokens=out,
                total_cost_usd=cost,
                extra={"total_tokens": total} if total else None,
            )
            atif_path = self.logs_dir / "trajectory.json"
            atif_path.write_text(json.dumps(trajectory.to_json_dict(), indent=2))


# ---------------------------------------------------------------------------
# .env loader
# ---------------------------------------------------------------------------


def find_dotenv() -> Path | None:
    cwd_env = Path.cwd() / ".env"
    if cwd_env.is_file():
        return cwd_env
    script_env = HARBOR_DIR / ".env"
    if script_env.is_file():
        return script_env
    return None


def load_dotenv() -> None:
    env_path = find_dotenv()
    if env_path is None:
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


# ---------------------------------------------------------------------------
# config_template handling
# ---------------------------------------------------------------------------


def render_goose_config(extensions: list[str]) -> tuple[str, list[dict[str, str]]]:
    """Render config.yaml from the template, enabling the given extensions.

    Returns (config_yaml_text, recipe_extension_entries).
    Raises ValueError for any extension not found in the template.
    """
    if not CONFIG_TEMPLATE_PATH.is_file():
        raise FileNotFoundError(f"Missing template: {CONFIG_TEMPLATE_PATH}")
    template = yaml.safe_load(CONFIG_TEMPLATE_PATH.read_text())
    available = template.get("extensions") or {}

    unknown = [name for name in extensions if name not in available]
    if unknown:
        raise ValueError(
            f"Unknown extensions: {', '.join(unknown)}. "
            f"Known: {', '.join(sorted(available))}"
        )

    for name, entry in available.items():
        entry["enabled"] = name in extensions

    recipe_entries = [
        {"type": available[name]["type"], "name": name} for name in extensions
    ]
    return yaml.dump(template, sort_keys=False), recipe_entries


# ---------------------------------------------------------------------------
# `run` subcommand
# ---------------------------------------------------------------------------


def default_job_name(model: str, dataset: str) -> str:
    safe_model = re.sub(r"[^A-Za-z0-9._-]+", "-", model).strip("-")
    safe_dataset = re.sub(r"[^A-Za-z0-9._-]+", "-", dataset).strip("-")
    timestamp = datetime.now().strftime("%Y-%m-%d__%H-%M-%S")
    return f"goose-{safe_dataset}-{safe_model}-{timestamp}"


def validate_job_name(job_name: str) -> str:
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", job_name):
        raise ValueError(
            "Job name must start with a letter or number and contain only "
            "letters, numbers, dots, underscores, and hyphens"
        )
    return job_name


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def dataset_config(dataset_ref: str, tasks: list[str]) -> dict[str, Any]:
    name, sep, ref = dataset_ref.rpartition("@")
    dataset_name = name if sep else dataset_ref
    dataset: dict[str, Any] = {"name": dataset_name}
    if sep:
        dataset["ref" if "/" in name else "version"] = ref
    if tasks:
        dataset["task_names"] = tasks
    return dataset


def build_harbor_config(args: argparse.Namespace) -> dict[str, Any]:
    if "/" not in args.model:
        raise ValueError("--model must be in provider/model form, e.g. anthropic/claude-sonnet-4-6")
    if args.trials < 1:
        raise ValueError("--trials must be at least 1")
    if args.concurrency < 1:
        raise ValueError("--concurrency must be at least 1")
    if args.timeout_multiplier <= 0:
        raise ValueError("--timeout-multiplier must be positive")

    goose_binary = args.goose_binary.expanduser().resolve()
    if not goose_binary.is_file():
        raise ValueError(f"--goose-binary does not exist or is not a file: {args.goose_binary}")

    config_yaml, extension_entries = render_goose_config(args.extensions)

    provider = args.model.split("/", 1)[0]
    missing_secrets = [
        key for key in PROVIDER_SECRETS.get(provider, []) if not os.environ.get(key)
    ]
    if missing_secrets:
        raise ValueError(
            f"Missing env vars for provider '{provider}': {', '.join(missing_secrets)}. "
            f"Set them in a .env file (cwd or {HARBOR_DIR}) or your shell."
        )

    agent_kwargs: dict[str, Any] = {
        "goose_binary": str(goose_binary),
        "config_yaml": config_yaml,
        "extension_entries": extension_entries,
        "install_goose_runtime_deps": args.install_goose_runtime_deps,
    }
    if args.max_turns is not None:
        agent_kwargs["max_turns"] = args.max_turns

    job_name = (
        validate_job_name(args.job_name)
        if args.job_name
        else default_job_name(args.model, args.dataset)
    )

    container_env_passthrough = [
        f"{key}=${{{key}}}"
        for key in PROVIDER_SECRETS.get(provider, [])
        if os.environ.get(key)
    ]

    config: dict[str, Any] = {
        "job_name": job_name,
        "jobs_dir": str(RUNS_DIR),
        "n_attempts": args.trials,
        "n_concurrent_trials": args.concurrency,
        "environment": {
            "type": "docker",
            "force_build": False,
            "delete": True,
            "env": container_env_passthrough,
        },
        "agents": [
            {
                "import_path": f"{Path(__file__).stem}:GooseBinaryAgent",
                "model_name": args.model,
                "kwargs": agent_kwargs,
            }
        ],
        "datasets": [dataset_config(args.dataset, args.tasks)],
    }
    if args.timeout_multiplier != 1.0:
        config["timeout_multiplier"] = args.timeout_multiplier
    return config


def cmd_run(args: argparse.Namespace) -> int:
    load_dotenv()
    try:
        config = build_harbor_config(args)
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    job_dir = RUNS_DIR / config["job_name"]
    job_dir.mkdir(parents=True, exist_ok=True)
    config_path = job_dir / "_generated_config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n")

    command = ["harbor", "run", "-c", str(config_path)]
    print(f"Job:    {config['job_name']}")
    print(f"Config: {config_path}")
    print(f"Runs:   {RUNS_DIR}")
    if args.dry_run:
        return 0

    env = os.environ.copy()
    env["PYTHONPATH"] = f"{HARBOR_DIR}{os.pathsep}{env.get('PYTHONPATH', '')}".rstrip(os.pathsep)
    completed = subprocess.run(command, env=env, check=False)
    return completed.returncode


# ---------------------------------------------------------------------------
# report subcommands (list/show/task/compare)
# ---------------------------------------------------------------------------


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
        if "timeout" in error_class.lower():
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


def trial_duration(trial: dict[str, Any]) -> float | None:
    return (
        trial.get("duration_seconds")
        or trial.get("duration_sec")
        or trial.get("total_duration_seconds")
    )


def job_duration(job: dict[str, Any]) -> float | None:
    if job.get("duration_seconds") or job.get("duration_sec"):
        return job.get("duration_seconds") or job.get("duration_sec")
    durations = [trial_duration(t) for t in trial_records(job)]
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
    for trial in trial_records(job):
        agent = trial.get("agent")
        if isinstance(agent, dict) and agent.get("model"):
            return agent["model"]
        agent_info = trial.get("agent_info")
        if isinstance(agent_info, dict) and agent_info.get("model_name"):
            return agent_info["model_name"]
    return "?"


def task_name(trial: dict[str, Any]) -> str:
    task_id = trial.get("task_id")
    if isinstance(task_id, dict):
        name = task_id.get("name")
        if name:
            return name
    elif isinstance(task_id, str) and task_id:
        return task_id.split("/", 1)[-1]
    return trial.get("trial_name", "?").rsplit(".", 1)[0]


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


def status_counts(trials: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"pass": 0, "partial": 0, "fail": 0, "timeout": 0, "error": 0, "no-reward": 0}
    for trial in trials:
        counts[trial_status(trial)] += 1
    return counts


def cmd_list(args: argparse.Namespace) -> int:
    if not RUNS_DIR.is_dir():
        print(f"No runs directory at {RUNS_DIR}", file=sys.stderr)
        return 1

    rows = []
    for child in sorted(RUNS_DIR.iterdir()):
        if not child.is_dir():
            continue
        try:
            job = load_job(child)
        except FileNotFoundError:
            continue
        trials = trial_records(job)
        counts = status_counts(trials)
        total = len(trials)
        rate = f"{100 * counts['pass'] / total:.1f}%" if total else "-"
        rows.append(
            (
                child.name,
                job_model(job),
                counts["pass"],
                counts["partial"],
                counts["fail"],
                counts["timeout"],
                counts["error"],
                rate,
                fmt_duration(job_duration(job)),
            )
        )

    if not rows:
        print(f"No jobs found in {RUNS_DIR}")
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
    job = load_job(RUNS_DIR / args.job_name)
    trials = trial_records(job)
    counts = status_counts(trials)
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
    total_in = sum((trial_metric(t, "n_input_tokens") or 0) for t in trials)
    total_out = sum((trial_metric(t, "n_output_tokens") or 0) for t in trials)
    total_cost = sum((trial_metric(t, "cost_usd") or 0.0) for t in trials)
    print(f"Tokens:       in={fmt_tokens(total_in)}  out={fmt_tokens(total_out)}")
    print(f"Cost:         {fmt_cost(total_cost)}")
    print()
    print(
        f"{'task':<45} {'status':<10} {'reward':>7} {'dur':>7} "
        f"{'in':>7} {'out':>7} {'cost':>7}  error"
    )
    print("-" * 130)
    for trial in sorted(trials, key=task_name):
        status = trial_status(trial)
        if args.status and status != args.status:
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


def cmd_task(args: argparse.Namespace) -> int:
    job_dir = RUNS_DIR / args.job_name
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
        print(
            f"Tokens:       in={fmt_tokens(trial_metric(trial, 'n_input_tokens'))}  "
            f"out={fmt_tokens(trial_metric(trial, 'n_output_tokens'))}"
        )
        print(f"Cost:         {fmt_cost(trial_metric(trial, 'cost_usd'))}")
        err = trial_error_class(trial)
        if err:
            print(f"Error class:  {err}")
            for line in (trial.get("error_message") or "").splitlines()[:10]:
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


def cmd_compare(args: argparse.Namespace) -> int:
    job_a = load_job(RUNS_DIR / args.job_a)
    job_b = load_job(RUNS_DIR / args.job_b)
    a_by_task = {task_name(t): t for t in trial_records(job_a)}
    b_by_task = {task_name(t): t for t in trial_records(job_b)}
    only_a = sorted(set(a_by_task) - set(b_by_task))
    only_b = sorted(set(b_by_task) - set(a_by_task))
    common = sorted(set(a_by_task) & set(b_by_task))

    ca = status_counts(trial_records(job_a))
    cb = status_counts(trial_records(job_b))
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

    def total(job: dict[str, Any], key: str) -> float:
        return sum((trial_metric(t, key) or 0) for t in trial_records(job))

    print(f"{'tokens in':<18} {fmt_tokens(int(total(job_a, 'n_input_tokens'))):>10} "
          f"{fmt_tokens(int(total(job_b, 'n_input_tokens'))):>10}")
    print(f"{'tokens out':<18} {fmt_tokens(int(total(job_a, 'n_output_tokens'))):>10} "
          f"{fmt_tokens(int(total(job_b, 'n_output_tokens'))):>10}")
    print(f"{'cost':<18} {fmt_cost(total(job_a, 'cost_usd')):>10} "
          f"{fmt_cost(total(job_b, 'cost_usd')):>10}")
    print(f"{'wall clock':<18} {fmt_duration(job_duration(job_a)):>10} "
          f"{fmt_duration(job_duration(job_b)):>10}")

    if only_a or only_b:
        print()
        if only_a:
            print(f"Only in A ({len(only_a)}): {', '.join(only_a)}")
        if only_b:
            print(f"Only in B ({len(only_b)}): {', '.join(only_b)}")

    transitions: dict[tuple[str, str], list[str]] = {}
    for name in common:
        sa = trial_status(a_by_task[name])
        sb = trial_status(b_by_task[name])
        transitions.setdefault((sa, sb), []).append(name)

    same_pass = transitions.get(("pass", "pass"), [])
    same_not = [
        name
        for (sa, sb), names in transitions.items()
        if sa != "pass" and sb != "pass"
        for name in names
    ]
    a_only = [n for (sa, sb), ns in transitions.items() if sa == "pass" and sb != "pass" for n in ns]
    b_only = [n for (sa, sb), ns in transitions.items() if sa != "pass" and sb == "pass" for n in ns]

    print()
    print(f"Task-level comparison ({len(common)} shared tasks):")
    print(f"  both pass:          {len(same_pass)}")
    print(f"  both not-pass:      {len(same_not)}")
    print(f"  only A passes:      {len(a_only)}")
    print(f"  only B passes:      {len(b_only)}")

    if args.verbose:
        if a_only:
            print(f"\nOnly A ({args.job_a}) solved:")
            for name in sorted(a_only):
                print(f"  {name:<40} B={trial_status(b_by_task[name])}")
        if b_only:
            print(f"\nOnly B ({args.job_b}) solved:")
            for name in sorted(b_only):
                print(f"  {name:<40} A={trial_status(a_by_task[name])}")
    return 0


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="run a benchmark job")
    p_run.add_argument("goose_binary", type=Path, help="path to the goose binary to test")
    p_run.add_argument("--dataset", default=DEFAULT_DATASET)
    p_run.add_argument("--model", default=DEFAULT_MODEL)
    p_run.add_argument(
        "--tasks",
        type=parse_csv,
        default=[],
        help="comma-separated task names (default: all tasks in dataset)",
    )
    p_run.add_argument(
        "--extensions",
        type=parse_csv,
        default=DEFAULT_EXTENSIONS,
        help=f"comma-separated extension names (default: {','.join(DEFAULT_EXTENSIONS)})",
    )
    p_run.add_argument("--trials", type=int, default=1)
    p_run.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    p_run.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    p_run.add_argument("--timeout-multiplier", type=float, default=1.0)
    p_run.add_argument("--job-name")
    p_run.add_argument(
        "--no-install-goose-runtime-deps",
        dest="install_goose_runtime_deps",
        action="store_false",
        default=True,
        help="skip apt-get install libgomp1 inside the task container",
    )
    p_run.add_argument("--dry-run", action="store_true")

    sub.add_parser("list", help="list all runs with summary stats")

    p_show = sub.add_parser("show", help="per-task results for one run")
    p_show.add_argument("job_name")
    p_show.add_argument(
        "--status",
        choices=["pass", "partial", "fail", "timeout", "error", "no-reward"],
    )

    p_task = sub.add_parser("task", help="full detail for one task in one run")
    p_task.add_argument("job_name")
    p_task.add_argument("task_name")
    p_task.add_argument("--tail", type=int, default=0, help="tail N lines of the agent log")

    p_cmp = sub.add_parser("compare", help="compare two runs task-by-task")
    p_cmp.add_argument("job_a")
    p_cmp.add_argument("job_b")
    p_cmp.add_argument("-v", "--verbose", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "run":
        return cmd_run(args)
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
