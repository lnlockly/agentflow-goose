from __future__ import annotations

import json
import os
import shlex
import uuid
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from harbor.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from harbor.agents.installed.goose import Goose
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trajectories import FinalMetrics, Trajectory

CONTAINER_GOOSE_PATH_ROOT = "/installed-agent/goose-profile"
CONTAINER_RECIPE_PATH = "/installed-agent/harbor-recipe.yaml"
CONTAINER_CA_BUNDLE_PATH = "/installed-agent/ca-certificates.crt"

FATAL_GOOSE_NOTIFICATIONS = ("creditsExhausted",)


class GooseBinaryAgent(Goose):
    """Run a caller-provided Goose binary in the benchmark environment."""

    def __init__(
        self,
        *args,
        goose_binary: str,
        goose_profile: str,
        install_goose_runtime_deps: bool = False,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.goose_binary = Path(goose_binary).expanduser().resolve()
        self.goose_profile = Path(goose_profile).expanduser().resolve()
        self.install_goose_runtime_deps = install_goose_runtime_deps
        self.ca_bundle_env_path: str | None = None

    @staticmethod
    def name() -> str:
        return "goose-binary"

    def get_version_command(self) -> str | None:
        return "/installed-agent/goose --version"

    def _profile_source_target(self) -> tuple[Path, str]:
        if not self.goose_profile.is_dir():
            raise FileNotFoundError(f"Goose profile does not exist: {self.goose_profile}")

        if (self.goose_profile / "config.yaml").is_file():
            return self.goose_profile, f"{CONTAINER_GOOSE_PATH_ROOT}/config"

        return self.goose_profile, CONTAINER_GOOSE_PATH_ROOT

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
        if self.ca_bundle_env_path:
            env["SSL_CERT_FILE"] = self.ca_bundle_env_path
        return env

    def _host_ca_bundle(self) -> Path:
        candidates = [
            "SSL_CERT_FILE",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
        ]
        for env_var in candidates:
            value = os.environ.get(env_var)
            if value and Path(value).expanduser().is_file():
                return Path(value).expanduser().resolve()

        for path in [
            Path("/etc/ssl/certs/ca-certificates.crt"),
            Path("/etc/ssl/cert.pem"),
            Path("/opt/homebrew/etc/ca-certificates/cert.pem"),
        ]:
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

    def _build_register_skills_command(self) -> str | None:
        if not self.skills_dir:
            return None
        skills_target = f"{CONTAINER_GOOSE_PATH_ROOT}/config/skills"
        return (
            f"mkdir -p {shlex.quote(skills_target)} && "
            f"cp -r {shlex.quote(self.skills_dir)}/* "
            f"{shlex.quote(skills_target)}/ 2>/dev/null || true"
        )

    async def _agent_uid_gid(self, environment: BaseEnvironment) -> tuple[str, str]:
        result = await self.exec_as_agent(
            environment,
            command="id -u && id -g",
            timeout_sec=10,
        )
        ids = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if len(ids) < 2:
            raise RuntimeError(f"Could not determine agent uid/gid: {result.stdout!r}")

        return ids[0], ids[1]

    async def _chown_to_agent_user(
        self,
        environment: BaseEnvironment,
        path: str,
        *,
        recursive: bool = False,
    ) -> None:
        uid, gid = await self._agent_uid_gid(environment)
        recursive_flag = "-R " if recursive else ""
        await self.exec_as_root(
            environment,
            command=(
                f"chown {recursive_flag}{shlex.quote(uid)}:{shlex.quote(gid)} "
                f"{shlex.quote(path)}"
            ),
        )

    async def install(self, environment: BaseEnvironment) -> None:
        if not self.goose_binary.is_file():
            raise FileNotFoundError(f"Goose binary does not exist: {self.goose_binary}")

        await environment.upload_file(self.goose_binary, "/installed-agent/goose")
        await self.exec_as_root(environment, command="chmod 755 /installed-agent/goose")
        if self.install_goose_runtime_deps:
            await self._install_goose_runtime_deps(environment)
        await self._ensure_ca_bundle(environment)

        source, target = self._profile_source_target()
        await self.exec_as_root(environment, command=f"mkdir -p {shlex.quote(target)}")
        await environment.upload_dir(source, target)
        await self._chown_to_agent_user(
            environment, CONTAINER_GOOSE_PATH_ROOT, recursive=True
        )

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

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        env = self._run_env()
        recipe_yaml = self._create_recipe_yaml(instruction)

        skills_command = self._build_register_skills_command()
        if skills_command:
            await self.exec_as_agent(
                environment,
                command=skills_command,
                env=env,
                timeout_sec=10,
            )

        with TemporaryDirectory() as tmp_dir:
            recipe_path = Path(tmp_dir) / "harbor-recipe.yaml"
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
        """Extract (total_tokens, input_tokens, output_tokens) from the
        final ``complete`` stream-json event.

        Goose emits one ``{"type":"complete", ...}`` event at the end of a
        run carrying the aggregate token counts for the session.
        """
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
        self,
        prompt_tokens: int | None,
        completion_tokens: int | None,
    ) -> float | None:
        """Compute total cost in USD from token counts via LiteLLM's pricing
        table. Returns None when the model is missing from the table —
        callers should leave ``cost_usd`` unset rather than report $0.
        """
        if not self.model_name or not (prompt_tokens or completion_tokens):
            return None

        try:
            import litellm
        except ImportError:
            self.logger.warning(
                "litellm not available; leaving goose cost_usd as None"
            )
            return None

        pricing: dict[str, Any] | None = None
        for key in (self.model_name, self.model_name.split("/", 1)[-1]):
            entry = litellm.model_cost.get(key)
            if entry:
                pricing = entry
                break

        if pricing is None:
            self.logger.warning(
                "No LiteLLM pricing entry for model '%s'; leaving goose "
                "cost_usd as None",
                self.model_name,
            )
            return None

        input_rate = pricing.get("input_cost_per_token") or 0.0
        output_rate = pricing.get("output_cost_per_token") or 0.0

        return (prompt_tokens or 0) * input_rate + (completion_tokens or 0) * output_rate

    def populate_context_post_run(self, context: AgentContext) -> None:
        txt_path = self.logs_dir / "goose.txt"
        if not txt_path.exists():
            return

        log_text = txt_path.read_text()

        total_tokens, input_tokens, output_tokens = self._extract_complete_event_tokens(
            log_text
        )

        if input_tokens is not None:
            context.n_input_tokens = input_tokens
        elif total_tokens is not None:
            context.n_input_tokens = total_tokens

        if output_tokens is not None:
            context.n_output_tokens = output_tokens

        cost_usd = self._compute_cost_from_pricing(input_tokens, output_tokens)
        if cost_usd is not None:
            context.cost_usd = cost_usd

        trajectory: Trajectory | None = None
        session_id = str(uuid.uuid4())
        try:
            trajectory = self._convert_goose_stream_json_to_atif(log_text, session_id)
        except Exception:
            pass

        if trajectory is None:
            try:
                trajectory = self._convert_goose_to_atif(log_text, session_id)
            except Exception as e:
                self.logger.debug(f"Error converting goose log to ATIF: {e}")

        if trajectory:
            trajectory.final_metrics = FinalMetrics(
                total_steps=len(trajectory.steps),
                total_prompt_tokens=input_tokens,
                total_completion_tokens=output_tokens,
                total_cost_usd=cost_usd,
                extra={"total_tokens": total_tokens} if total_tokens else None,
            )
            try:
                atif_path = self.logs_dir / "trajectory.json"
                atif_path.write_text(json.dumps(trajectory.to_json_dict(), indent=2))
            except Exception as e:
                self.logger.debug(f"Error writing ATIF trajectory: {e}")
