# Device use-case recipes

Goose recipes that back the AgentFlow cabinet's "What should this device do?" picker.
The user picks an **outcome**; the cabinet dispatches the matching recipe to the device.

- **L\*** = local desktop agent (leverages YOU — your logged-in sessions, files, repos).
- **C\*** = cloud device (leverages TIME — always-on, scheduled).

## Catalog

| id | home | approval | status | what |
|---|---|---|---|---|
| `l1-inbox-triage` | local | yes | ready | Triage Kwork+Telegram, draft replies, one-tap approve |
| `l2-freelance-autopilot` | local | yes | draft | Scan gigs, draft proposals, submit on approve |
| `l3-file-butler` | local | yes | draft | Sort/rename/archive a folder, invoice totals → CSV |
| `l4-research-brief` | local | no | draft | Research topic + open tabs → sourced 1-page brief |
| `l5-repo-chores` | local | yes | draft | Bump deps / lint / tests → open a PR |
| `l6-social-crosspost` | local | yes | draft | Draft + cross-post to logged-in socials |
| `c1-watcher-alerter` | cloud | no | draft | Watch a target; alert on change only |
| `c2-morning-digest` | cloud | no | ready | Scrape niche sources on cron → Telegram brief |
| `c3-leadgen-outreach` | cloud | yes | draft | Scan channels, warm-outreach on approve |
| `c4-data-pipeline` | cloud | no | draft | Pull → transform → push on cron |
| `c5-content-factory` | cloud | yes | draft | Generate posts/drafts on cadence, queued for approve |
| `c6-concierge` | cloud | yes | draft | Answer FAQs / route tickets 24/7 |

`manifest.json` is the single source the picker reads (id, home, draft, approval, icon,
params). Keep it in sync with each recipe's `metadata:` block and the TS copy in
`agentflow-landing/src/data/deviceUseCases.ts`.

## Extensions

- `developer`, `computercontroller`, `memory` — Goose builtins.
- `agentflow` (stdio) — the `agentflow-mcp-server` af_* platform tools (telegram,
  memory, projects). Built/owned elsewhere; consumed here. The pod mounts it at
  `/opt/agentflow-mcp-server/dist/index.js` with `AGENTFLOW_API_KEY` / `AGENTFLOW_BASE_URL`.
- `kwork_inbox` (streamable_http) — the kwork-inbox MCP (`list_dialogs`, `get_dialog`,
  `send_message`) at `{{ kwork_inbox_mcp_url }}` (e.g. the backend's
  `/internal/mcp/kwork-inbox`).

## Approval gate

There is no interactive `request_approval` MCP tool. Outbound recipes implement approval
as a Telegram round-trip: send the draft to the owner's Saved Messages, then poll for
`ok` / `отправь` / `send` (or an edit) before sending the real reply. `manifest.json`
marks these `approval: true`; the picker badges them.

## Run

```bash
# headless, once (local)
goose run --recipe recipes/devices/l1-inbox-triage.yaml --params sources=telegram

# cloud recipes carry metadata.cron; the device bridge registers them with Goose's
# scheduler (manage_schedule) instead of running once.
goose run --recipe recipes/devices/c2-morning-digest.yaml --params niche="AI agents"
```

The cabinet dispatches these through `POST /me/devices/:id/dispatch_task` with
`tool: 'agent_run_recipe'` and `scope: { recipe, params, cron? }`; the device bridge
turns that into the `goose run` / scheduler call above.
