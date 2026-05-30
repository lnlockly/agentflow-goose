//! Detect AI providers already present on the user's machine.
//!
//! AgentFlow Desktop offers the user their own locally-installed tools (Claude
//! Code, Codex, Cursor, Gemini CLI, Copilot, Ollama, LM Studio, env API keys)
//! as one-click providers alongside the default `flow`. Every provider here is
//! already implemented by the engine — this is detection only, no new adapters.
//!
//! Three signals, strongest first:
//!   1. `binary` — the provider's CLI (`catalog` `binary_name`) resolves on PATH.
//!   2. `local-server` — a local model server answers (Ollama :11434, an
//!      OpenAI-compatible server such as LM Studio :1234).
//!   3. `env-key` — a required secret config key for the provider is set in the
//!      environment (e.g. `ANTHROPIC_API_KEY`).
//!
//! Pure helpers (`binary_on_path`, `env_keys_present`, `merge_strongest`) are
//! unit-tested; `detect_local_providers` wires them to the real PATH / env /
//! network. Read-only: nothing is spawned, nothing leaves the machine.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use super::base::ProviderMetadata;
use super::catalog::get_setup_catalog_entries;

/// How a provider was found. Ordered strongest → weakest for de-duplication.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DetectionSource {
    /// The provider's CLI is on PATH.
    Binary,
    /// A local model server answered.
    LocalServer,
    /// A required secret key is set in the environment.
    EnvKey,
}

impl DetectionSource {
    /// Lower rank = stronger signal (kept when a provider matches several ways).
    fn rank(self) -> u8 {
        match self {
            DetectionSource::Binary => 0,
            DetectionSource::LocalServer => 1,
            DetectionSource::EnvKey => 2,
        }
    }
}

/// A provider found on the machine, ready to surface in the desktop picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedProvider {
    pub provider_id: String,
    pub display_name: String,
    /// Always true in the returned list (it lists only what was found); the
    /// field keeps the contract explicit for the UI.
    pub available: bool,
    pub source: DetectionSource,
    /// Short human line, e.g. "found `claude-agent-acp` on PATH" or
    /// "3 local models".
    pub detail: String,
}

#[cfg(windows)]
const PATH_SEP: char = ';';
#[cfg(not(windows))]
const PATH_SEP: char = ':';

/// Executable suffixes to try per PATH entry. Unix uses the bare name; Windows
/// tries the common executable extensions plus the bare name.
#[cfg(windows)]
const EXEC_EXTS: &[&str] = &["", ".exe", ".cmd", ".bat", ".com"];
#[cfg(not(windows))]
const EXEC_EXTS: &[&str] = &[""];

/// True when `name` resolves to a file on the given PATH string. `exists` lets
/// tests inject a filesystem without touching disk.
fn binary_on_path(name: &str, path_var: &str, exists: &dyn Fn(&Path) -> bool) -> bool {
    if name.is_empty() {
        return false;
    }
    path_var
        .split(PATH_SEP)
        .filter(|dir| !dir.is_empty())
        .any(|dir| {
            EXEC_EXTS
                .iter()
                .any(|ext| exists(&Path::new(dir).join(format!("{name}{ext}"))))
        })
}

/// Real on-disk check: a regular file (executable bit honoured on Unix).
fn path_entry_is_executable(p: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(p) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The required secret config keys of a provider that are currently set in the
/// environment (via the injected lookup). Empty when none are present.
fn env_keys_present(
    metadata: &ProviderMetadata,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Vec<String> {
    metadata
        .config_keys
        .iter()
        .filter(|k| k.secret && k.required)
        .filter(|k| {
            lookup(&k.name)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false)
        })
        .map(|k| k.name.clone())
        .collect()
}

/// Collapse multiple detections of the same provider to the strongest signal.
fn merge_strongest(found: Vec<DetectedProvider>) -> Vec<DetectedProvider> {
    let mut best: BTreeMap<String, DetectedProvider> = BTreeMap::new();
    for p in found {
        match best.get(&p.provider_id) {
            Some(existing) if existing.source.rank() <= p.source.rank() => {}
            _ => {
                best.insert(p.provider_id.clone(), p);
            }
        }
    }
    best.into_values().collect()
}

/// Probe a local HTTP model server. Returns a short detail string on a 200,
/// `None` otherwise (server absent / slow / error). Never blocks long.
async fn probe_local_server(client: &reqwest::Client, url: &str) -> Option<serde_json::Value> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().await.ok()
}

fn count_array(value: &serde_json::Value, key: &str) -> usize {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0)
}

/// Detect the local providers on this machine. Read-only; safe to call often.
pub async fn detect_local_providers() -> Vec<DetectedProvider> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut found: Vec<DetectedProvider> = Vec::new();

    // 1. CLI binaries from the provider catalog.
    for entry in get_setup_catalog_entries().await {
        if let Some(bin) = entry.binary_name.as_deref() {
            if binary_on_path(bin, &path_var, &path_entry_is_executable) {
                found.push(DetectedProvider {
                    provider_id: entry.provider_id.clone(),
                    display_name: entry.display_name.clone(),
                    available: true,
                    source: DetectionSource::Binary,
                    detail: format!("found `{bin}` on PATH"),
                });
            }
        }
    }

    // 2. Environment API keys from each provider's required secret config keys.
    let env_lookup = |k: &str| std::env::var(k).ok();
    for (metadata, _) in super::providers().await {
        let keys = env_keys_present(&metadata, &env_lookup);
        if let Some(first) = keys.first() {
            found.push(DetectedProvider {
                provider_id: metadata.name.clone(),
                display_name: metadata.display_name.clone(),
                available: true,
                source: DetectionSource::EnvKey,
                detail: format!("using ${first}"),
            });
        }
    }

    // 3. Local model servers (best-effort, short timeout so absence is cheap).
    if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(400))
        .build()
    {
        if let Some(body) = probe_local_server(&client, "http://localhost:11434/api/tags").await {
            let n = count_array(&body, "models");
            found.push(DetectedProvider {
                provider_id: "ollama".to_string(),
                display_name: "Ollama".to_string(),
                available: true,
                source: DetectionSource::LocalServer,
                detail: if n > 0 {
                    format!("local, no key — {n} model{}", if n == 1 { "" } else { "s" })
                } else {
                    "local, no key".to_string()
                },
            });
        }
        if let Some(body) = probe_local_server(&client, "http://localhost:1234/v1/models").await {
            let n = count_array(&body, "data");
            found.push(DetectedProvider {
                provider_id: "lmstudio".to_string(),
                display_name: "LM Studio".to_string(),
                available: true,
                source: DetectionSource::LocalServer,
                detail: if n > 0 {
                    format!(
                        "local OpenAI-compatible — {n} model{}",
                        if n == 1 { "" } else { "s" }
                    )
                } else {
                    "local OpenAI-compatible".to_string()
                },
            });
        }
    }

    merge_strongest(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::base::{ConfigKey, ProviderMetadata};

    fn meta_with_keys(name: &str, keys: Vec<ConfigKey>) -> ProviderMetadata {
        ProviderMetadata {
            name: name.to_string(),
            display_name: name.to_string(),
            description: String::new(),
            default_model: String::new(),
            known_models: vec![],
            model_doc_link: String::new(),
            config_keys: keys,
            setup_steps: vec![],
            model_selection_hint: None,
        }
    }

    #[test]
    fn binary_on_path_finds_name_in_a_dir() {
        let exists = |p: &Path| p == Path::new("/usr/local/bin/claude-agent-acp");
        let path = format!("/usr/bin{PATH_SEP}/usr/local/bin{PATH_SEP}/opt/bin");
        assert!(binary_on_path("claude-agent-acp", &path, &exists));
    }

    #[test]
    fn binary_on_path_misses_when_absent() {
        let exists = |_: &Path| false;
        assert!(!binary_on_path("codex-acp", "/usr/bin:/bin", &exists));
    }

    #[test]
    fn binary_on_path_ignores_empty_name_and_empty_path() {
        let exists = |_: &Path| true;
        assert!(!binary_on_path("", "/usr/bin", &exists));
        assert!(!binary_on_path("codex", "", &exists));
    }

    #[test]
    fn env_keys_present_picks_set_required_secret_keys_only() {
        let meta = meta_with_keys(
            "anthropic",
            vec![
                ConfigKey::new("ANTHROPIC_API_KEY", true, true, None, true),
                ConfigKey::new("ANTHROPIC_HOST", false, false, None, false),
            ],
        );
        let lookup = |k: &str| match k {
            "ANTHROPIC_API_KEY" => Some("sk-ant-xxx".to_string()),
            _ => None,
        };
        assert_eq!(env_keys_present(&meta, &lookup), vec!["ANTHROPIC_API_KEY"]);
    }

    #[test]
    fn env_keys_present_ignores_blank_and_non_secret() {
        let meta = meta_with_keys(
            "openai",
            vec![
                ConfigKey::new("OPENAI_API_KEY", true, true, None, true),
                ConfigKey::new("OPENAI_HOST", false, false, None, false),
            ],
        );
        let blank = |k: &str| match k {
            "OPENAI_API_KEY" => Some("   ".to_string()),
            "OPENAI_HOST" => Some("https://example.com".to_string()),
            _ => None,
        };
        assert!(env_keys_present(&meta, &blank).is_empty());
    }

    #[test]
    fn merge_strongest_keeps_binary_over_env_key() {
        let mk = |source: DetectionSource| DetectedProvider {
            provider_id: "claude-acp".to_string(),
            display_name: "Claude Code".to_string(),
            available: true,
            source,
            detail: String::new(),
        };
        let merged = merge_strongest(vec![
            mk(DetectionSource::EnvKey),
            mk(DetectionSource::Binary),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].source, DetectionSource::Binary);
    }

    #[test]
    fn merge_strongest_preserves_distinct_providers() {
        let merged = merge_strongest(vec![
            DetectedProvider {
                provider_id: "ollama".to_string(),
                display_name: "Ollama".to_string(),
                available: true,
                source: DetectionSource::LocalServer,
                detail: String::new(),
            },
            DetectedProvider {
                provider_id: "claude-acp".to_string(),
                display_name: "Claude Code".to_string(),
                available: true,
                source: DetectionSource::Binary,
                detail: String::new(),
            },
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn count_array_reads_models_and_data() {
        let ollama = serde_json::json!({"models": [{"name": "llama3"}, {"name": "qwen"}]});
        assert_eq!(count_array(&ollama, "models"), 2);
        let lmstudio = serde_json::json!({"data": [{"id": "m1"}]});
        assert_eq!(count_array(&lmstudio, "data"), 1);
        assert_eq!(count_array(&serde_json::json!({}), "models"), 0);
    }
}
