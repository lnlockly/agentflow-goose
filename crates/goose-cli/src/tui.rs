use agent_client_protocol::schema::{
    ContentBlock, EmbeddedResourceResource, ToolCallContent as AcpToolCallContent, ToolCallStatus,
    ToolKind,
};
use anyhow::Result;
use crossterm::event::{Event as CrosstermEvent, EventStream, KeyCode, KeyModifiers};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use futures::StreamExt;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap};
use ratatui::{Frame, Terminal};
use std::io::stdout;
use std::time::Duration;
use tokio::sync::mpsc;

mod acp;
mod markdown;

use acp::{
    spawn_acp_client, AgentMessage, ClientCommand, ExtensionInfo, ProviderInfo, SessionInfo,
};
use markdown::push_markdown;

const BACKGROUND: Color = Color::Black;
const CRANBERRY: Color = Color::Rgb(238, 238, 238);
const TEAL: Color = Color::Rgb(245, 245, 245);
const GOLD: Color = Color::Rgb(210, 210, 210);
const TEXT_PRIMARY: Color = Color::White;
const TEXT_SECONDARY: Color = Color::Rgb(188, 188, 188);
const TEXT_DIM: Color = Color::Rgb(112, 112, 112);
const RULE_COLOR: Color = Color::Rgb(38, 38, 38);
const CEDAR: Color = Color::Rgb(72, 72, 72);
const SPINNER: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

fn fg(color: Color) -> Style {
    Style::default().fg(color)
}

fn bold(color: Color) -> Style {
    fg(color).add_modifier(Modifier::BOLD)
}

fn italic(color: Color) -> Style {
    fg(color).add_modifier(Modifier::ITALIC)
}

fn ui_block(border: Color, border_type: BorderType, padding: u16) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_type(border_type)
        .border_style(fg(border))
        .padding(ratatui::widgets::Padding::horizontal(padding))
}
#[derive(Clone, Copy)]
struct SlashCommand {
    name: &'static str,
    description: &'static str,
}

const SLASH_COMMANDS: &[SlashCommand] = &[
    SlashCommand {
        name: "/help",
        description: "show this command menu",
    },
    SlashCommand {
        name: "/extensions",
        description: "manage configured extensions",
    },
    SlashCommand {
        name: "/provider",
        description: "choose the active provider",
    },
    SlashCommand {
        name: "/model",
        description: "choose the active model",
    },
    SlashCommand {
        name: "/sessions",
        description: "view recent sessions",
    },
    SlashCommand {
        name: "/clear",
        description: "clear the current chat history",
    },
    SlashCommand {
        name: "/new",
        description: "start a new session",
    },
    SlashCommand {
        name: "/quit",
        description: "exit goose",
    },
];

const GOOSE_FRAMES: &[&[&str]] = &[
    &[
        r#"             __"#,
        r#"          __/o )_"#,
        r#"   .-.___/  ___/ \"#,
        r#"  /  _     /      \"#,
        r#" /__/ \___/  _/\_  \"#,
        r#"      `---' /    \__)"#,
        r#"            `-._,"#,
    ],
    &[
        r#"          __"#,
        r#"       __/o )_"#,
        r#"  _.-_/  ___/ \"#,
        r#" /  _     /    _\"#,
        r#"/__/ \___/  _/  `"#,
        r#"     `---' /"#,
        r#"           `-._,"#,
    ],
    &[
        r#"              __"#,
        r#"           __/o )_"#,
        r#"    __..__/  ___/ \"#,
        r#" __/  _      /     \"#,
        r#"    _/ \___/  _/\_ \"#,
        r#"   /    `---' /    \_)"#,
        r#"        _.-'"#,
    ],
    &[
        r#"           __"#,
        r#"        __/o )_"#,
        r#" .-.___/  ___/ \"#,
        r#"/  _      /      \"#,
        r#"  / \___/  _/\_  \"#,
        r#" /   `---' /    \__)"#,
        r#"       `-._,"#,
    ],
];

#[derive(Clone, PartialEq)]
enum View {
    Splash,
    Providers,
    Models,
    Chat,
    Sessions,
    Extensions,
}

#[derive(Clone)]
enum TimelineItem {
    Message { role: Role, content: String },
    ToolCall(ToolCall),
}

#[derive(Clone)]
enum Role {
    User,
    Assistant,
    System,
}

#[derive(Clone)]
struct ToolCall {
    title: String,
    id: String,
    kind: ToolKind,
    status: ToolCallStatus,
    raw_input: Option<serde_json::Value>,
    raw_output: Option<serde_json::Value>,
    content: Vec<AcpToolCallContent>,
}

struct App {
    view: View,
    tick: usize,
    timeline: Vec<TimelineItem>,
    input: String,
    cursor: usize,
    streaming: String,
    loading: bool,
    status: String,
    providers: Vec<ProviderInfo>,
    provider_search: String,
    providers_selected: usize,
    models: Vec<String>,
    model_search: String,
    models_selected: usize,
    sessions: Vec<SessionInfo>,
    sessions_selected: usize,
    extensions: Vec<ExtensionInfo>,
    extensions_selected: usize,
    selected_tool_call: Option<usize>,
    expanded_tool_call: bool,
    expanded_scroll: usize,
    show_help_menu: bool,
    slash_selected: usize,
    cmd_tx: mpsc::UnboundedSender<ClientCommand>,
    msg_rx: mpsc::UnboundedReceiver<AgentMessage>,
    should_quit: bool,
}

impl App {
    fn new(
        cmd_tx: mpsc::UnboundedSender<ClientCommand>,
        msg_rx: mpsc::UnboundedReceiver<AgentMessage>,
    ) -> Self {
        Self {
            view: View::Splash,
            tick: 0,
            timeline: Vec::new(),
            input: String::new(),
            cursor: 0,
            streaming: String::new(),
            loading: true,
            status: "starting".into(),
            providers: Vec::new(),
            provider_search: String::new(),
            providers_selected: 0,
            models: Vec::new(),
            model_search: String::new(),
            models_selected: 0,
            sessions: Vec::new(),
            sessions_selected: 0,
            extensions: Vec::new(),
            extensions_selected: 0,
            selected_tool_call: None,
            expanded_tool_call: false,
            expanded_scroll: 0,
            show_help_menu: false,
            slash_selected: 0,
            cmd_tx,
            msg_rx,
            should_quit: false,
        }
    }

    fn handle_agent_message(&mut self, msg: AgentMessage) {
        match msg {
            AgentMessage::Initialized => {
                self.status = "loading providers".into();
                let _ = self.cmd_tx.send(ClientCommand::ListProviders);
            }
            AgentMessage::ProvidersList(providers) => {
                let has_configured = providers.iter().any(|p| p.configured);
                self.providers = providers;
                self.providers_selected = 0;
                if has_configured && self.view == View::Splash {
                    self.start_session();
                } else {
                    self.status = "choose provider".into();
                    self.loading = false;
                    self.view = View::Providers;
                }
            }
            AgentMessage::SessionCreated => {
                self.loading = false;
                self.status = "ready".into();
                self.view = View::Chat;
                if self.timeline.is_empty() {
                    self.push_message(Role::System, "What would you like to work on?".into());
                }
            }
            AgentMessage::TextChunk(text) => {
                self.loading = true;
                self.status = "thinking".into();
                self.streaming.push_str(&text);
            }
            AgentMessage::ToolCallStarted {
                title,
                id,
                kind,
                status,
                raw_input,
                raw_output,
                content,
            } => {
                self.flush_streaming();
                self.loading = true;
                self.status = "using tools".into();
                self.timeline.push(TimelineItem::ToolCall(ToolCall {
                    title,
                    id,
                    kind,
                    status,
                    raw_input,
                    raw_output,
                    content,
                }));
                if self.selected_tool_call.is_none() {
                    self.selected_tool_call = self.tool_call_count().checked_sub(1);
                }
            }
            AgentMessage::ToolCallUpdate {
                id,
                title,
                kind,
                status,
                raw_input,
                raw_output,
                content,
            } => {
                if let Some(tool) = self.timeline.iter_mut().find_map(|item| match item {
                    TimelineItem::ToolCall(tool) if tool.id == id => Some(tool),
                    _ => None,
                }) {
                    if let Some(title) = title {
                        tool.title = title;
                    }
                    if let Some(kind) = kind {
                        tool.kind = kind;
                    }
                    if let Some(status) = status {
                        tool.status = status;
                    }
                    if raw_input.is_some() {
                        tool.raw_input = raw_input;
                    }
                    if raw_output.is_some() {
                        tool.raw_output = raw_output;
                    }
                    if let Some(content) = content {
                        tool.content = content;
                    }
                }
            }
            AgentMessage::ResponseComplete => {
                self.flush_streaming();
                self.loading = false;
                self.status = "ready".into();
            }
            AgentMessage::SessionsList(sessions) => {
                self.sessions = sessions;
                self.sessions_selected = self
                    .sessions_selected
                    .min(self.sessions.len().saturating_sub(1));
                self.view = View::Sessions;
                self.status = "sessions".into();
            }
            AgentMessage::ExtensionsList(extensions) => {
                self.extensions = extensions;
                self.extensions_selected = self
                    .extensions_selected
                    .min(self.extensions.len().saturating_sub(1));
                self.view = View::Extensions;
                self.status = "extensions".into();
            }
            AgentMessage::Error(error) => {
                self.loading = false;
                self.status = "error".into();
                self.push_message(Role::System, format!("Error: {error}"));
                self.view = View::Chat;
            }
        }
    }

    fn handle_key(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        if code == KeyCode::Char('c') && modifiers.contains(KeyModifiers::CONTROL) {
            self.should_quit = true;
            return;
        }
        match self.view {
            View::Splash => {}
            View::Chat => self.handle_chat_key(code, modifiers),
            View::Providers => self.handle_provider_key(code),
            View::Models => self.handle_model_key(code),
            View::Sessions => self.handle_sessions_key(code),
            View::Extensions => self.handle_extensions_key(code),
        }
    }

    fn handle_chat_key(&mut self, code: KeyCode, modifiers: KeyModifiers) {
        if self.handle_slash_command_key(code, modifiers) {
            return;
        }

        if self.expanded_tool_call {
            match code {
                KeyCode::Esc | KeyCode::Char(' ') => {
                    self.expanded_tool_call = false;
                    self.expanded_scroll = 0;
                    self.selected_tool_call = None;
                }
                KeyCode::Up => self.expanded_scroll = self.expanded_scroll.saturating_add(3),
                KeyCode::Down => self.expanded_scroll = self.expanded_scroll.saturating_sub(3),
                _ => {}
            }
            return;
        }

        match (code, modifiers) {
            (KeyCode::Char(' '), KeyModifiers::NONE) if self.selected_tool_call.is_some() => {
                self.expanded_tool_call = true;
                self.expanded_scroll = 0;
            }
            (KeyCode::Up, KeyModifiers::SHIFT) => self.move_tool_selection(-1),
            (KeyCode::Down, KeyModifiers::SHIFT) => self.move_tool_selection(1),
            (KeyCode::Esc, _) if self.show_help_menu => self.show_help_menu = false,
            (KeyCode::Esc, _) if self.selected_tool_call.is_some() => {
                self.selected_tool_call = None;
                self.expanded_scroll = 0;
            }
            (KeyCode::Tab, KeyModifiers::NONE) => self.autocomplete_slash(),
            (KeyCode::Enter, KeyModifiers::NONE) => {
                let input = self.take_input();
                if input.is_empty() {
                    return;
                }
                self.show_help_menu = false;
                if input.starts_with('/') {
                    self.handle_slash(&input);
                } else {
                    self.push_message(Role::User, input.clone());
                    self.loading = true;
                    self.status = "queued".into();
                    let _ = self.cmd_tx.send(ClientCommand::SendPrompt(input));
                }
            }
            (KeyCode::Backspace, _) => {
                self.input_backspace();
                self.reset_slash_selection();
            }
            (KeyCode::Delete, _) => {
                self.input_delete();
                self.reset_slash_selection();
            }
            (KeyCode::Left, _) => self.input_left(),
            (KeyCode::Right, _) => self.input_right(),
            (KeyCode::Home, _) => self.cursor = 0,
            (KeyCode::End, _) => self.cursor = self.input.len(),
            (KeyCode::Char(c), m)
                if !m.contains(KeyModifiers::CONTROL) && !m.contains(KeyModifiers::ALT) =>
            {
                self.input.insert(self.cursor, c);
                self.cursor += c.len_utf8();
                self.reset_slash_selection();
            }
            _ => {}
        }
    }

    fn handle_slash_command_key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> bool {
        if modifiers != KeyModifiers::NONE {
            return false;
        }

        let commands = self.slash_commands();
        if commands.is_empty() {
            return false;
        }

        match code {
            KeyCode::Up => {
                self.slash_selected = self.slash_selected.saturating_sub(1);
                true
            }
            KeyCode::Down => {
                self.slash_selected = (self.slash_selected + 1).min(commands.len() - 1);
                true
            }
            KeyCode::Enter => {
                let command = commands[self.slash_selected.min(commands.len() - 1)];
                self.input.clear();
                self.cursor = 0;
                self.slash_selected = 0;
                self.show_help_menu = false;
                self.handle_slash(command.name);
                true
            }
            _ => false,
        }
    }

    fn slash_commands(&self) -> Vec<SlashCommand> {
        if !self.input.starts_with('/') {
            return Vec::new();
        }
        if self.input.trim() == "/help" {
            SLASH_COMMANDS.to_vec()
        } else {
            matching_slash_commands(&self.input)
        }
    }

    fn reset_slash_selection(&mut self) {
        self.slash_selected = 0;
    }

    fn handle_provider_key(&mut self, code: KeyCode) {
        let count = self.filtered_providers().len();
        match code {
            KeyCode::Esc if !self.provider_search.is_empty() => {
                self.provider_search.clear();
                self.providers_selected = 0;
            }
            KeyCode::Esc => self.view = View::Chat,
            KeyCode::Left => self.providers_selected = self.providers_selected.saturating_sub(1),
            KeyCode::Right => {
                if count > 0 {
                    self.providers_selected = (self.providers_selected + 1).min(count - 1);
                }
            }
            KeyCode::Up => {
                self.providers_selected = self
                    .providers_selected
                    .saturating_sub(provider_columns(terminal_width()))
            }
            KeyCode::Down => {
                if count > 0 {
                    self.providers_selected = (self.providers_selected
                        + provider_columns(terminal_width()))
                    .min(count - 1);
                }
            }
            KeyCode::Enter => {
                let selected = self
                    .filtered_providers()
                    .get(self.providers_selected)
                    .copied()
                    .cloned();
                if let Some(provider) = selected {
                    let model = provider.models.first().cloned().unwrap_or_default();
                    let _ = self.cmd_tx.send(ClientCommand::SaveDefaults {
                        provider: provider.id,
                        model,
                    });
                    self.start_session();
                }
            }
            KeyCode::Backspace | KeyCode::Delete => {
                self.provider_search.pop();
                self.providers_selected = 0;
            }
            KeyCode::Char(c) => {
                self.provider_search.push(c);
                self.providers_selected = 0;
            }
            _ => {}
        }
    }

    fn handle_model_key(&mut self, code: KeyCode) {
        let count = self.filtered_models().len();
        match code {
            KeyCode::Esc if !self.model_search.is_empty() => {
                self.model_search.clear();
                self.models_selected = 0;
            }
            KeyCode::Esc => self.view = View::Chat,
            KeyCode::Up => self.models_selected = self.models_selected.saturating_sub(1),
            KeyCode::Down => {
                if count > 0 {
                    self.models_selected = (self.models_selected + 1).min(count - 1);
                }
            }
            KeyCode::Enter => {
                let model = self
                    .filtered_models()
                    .get(self.models_selected)
                    .cloned()
                    .cloned();
                if let Some(model) = model {
                    if let Some(provider) =
                        self.providers.iter().find(|p| p.models.contains(&model))
                    {
                        let _ = self.cmd_tx.send(ClientCommand::SaveDefaults {
                            provider: provider.id.clone(),
                            model,
                        });
                        self.start_session();
                    }
                }
            }
            KeyCode::Backspace | KeyCode::Delete => {
                self.model_search.pop();
                self.models_selected = 0;
            }
            KeyCode::Char(c) => {
                self.model_search.push(c);
                self.models_selected = 0;
            }
            _ => {}
        }
    }

    fn handle_sessions_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Esc => self.view = View::Chat,
            KeyCode::Char('n') | KeyCode::Enter => {
                self.timeline.clear();
                self.streaming.clear();
                self.selected_tool_call = None;
                self.expanded_tool_call = false;
                self.expanded_scroll = 0;
                self.start_session();
            }
            KeyCode::Up => self.sessions_selected = self.sessions_selected.saturating_sub(1),
            KeyCode::Down => {
                if !self.sessions.is_empty() {
                    self.sessions_selected =
                        (self.sessions_selected + 1).min(self.sessions.len() - 1);
                }
            }
            _ => {}
        }
    }

    fn handle_extensions_key(&mut self, code: KeyCode) {
        match code {
            KeyCode::Esc => self.view = View::Chat,
            KeyCode::Up => self.extensions_selected = self.extensions_selected.saturating_sub(1),
            KeyCode::Down => {
                if !self.extensions.is_empty() {
                    self.extensions_selected =
                        (self.extensions_selected + 1).min(self.extensions.len() - 1);
                }
            }
            KeyCode::Char(' ') | KeyCode::Enter => {
                if let Some(ext) = self.extensions.get_mut(self.extensions_selected) {
                    ext.enabled = !ext.enabled;
                    let _ = self.cmd_tx.send(ClientCommand::ToggleExtension {
                        key: ext.name.clone(),
                        enabled: ext.enabled,
                    });
                }
            }
            _ => {}
        }
    }

    fn handle_slash(&mut self, input: &str) {
        match input.split_whitespace().next().unwrap_or_default() {
            "/help" => {
                self.show_help_menu = true;
            }
            "/sessions" => {
                let _ = self.cmd_tx.send(ClientCommand::ListSessions);
            }
            "/extensions" => {
                let _ = self.cmd_tx.send(ClientCommand::ListExtensions);
            }
            "/provider" => {
                let _ = self.cmd_tx.send(ClientCommand::ListProviders);
                self.view = View::Providers;
            }
            "/model" => {
                self.ensure_models();
                self.model_search.clear();
                self.models_selected = 0;
                self.view = View::Models;
            }
            "/clear" => self.clear_chat(),
            "/new" => {
                self.timeline.clear();
                self.streaming.clear();
                self.selected_tool_call = None;
                self.expanded_tool_call = false;
                self.expanded_scroll = 0;
                self.start_session();
            }
            "/quit" => self.should_quit = true,
            cmd => self.push_message(Role::System, format!("Unknown command: {cmd}. Type /help")),
        }
    }

    fn autocomplete_slash(&mut self) {
        let matches = self.slash_commands();
        if matches.len() == 1 {
            self.input = format!("{} ", matches[0].name);
            self.cursor = self.input.len();
            self.reset_slash_selection();
        }
    }

    fn start_session(&mut self) {
        self.loading = true;
        self.status = "starting session".into();
        let _ = self.cmd_tx.send(ClientCommand::CreateSession);
    }

    fn clear_chat(&mut self) {
        self.timeline.clear();
        self.streaming.clear();
        self.selected_tool_call = None;
        self.expanded_tool_call = false;
        self.expanded_scroll = 0;
        self.push_message(Role::System, "Chat cleared.".into());
    }

    fn push_message(&mut self, role: Role, content: String) {
        self.timeline.push(TimelineItem::Message { role, content });
    }

    fn flush_streaming(&mut self) {
        if !self.streaming.is_empty() {
            let content = std::mem::take(&mut self.streaming);
            self.push_message(Role::Assistant, content);
        }
    }

    fn turn_count(&self) -> usize {
        self.timeline
            .iter()
            .filter(|item| matches!(item, TimelineItem::Message { .. }))
            .count()
    }

    fn tool_call_count(&self) -> usize {
        self.timeline
            .iter()
            .filter(|item| matches!(item, TimelineItem::ToolCall(_)))
            .count()
    }

    fn selected_tool(&self) -> Option<&ToolCall> {
        let selected = self.selected_tool_call?;
        self.timeline
            .iter()
            .filter_map(|item| match item {
                TimelineItem::ToolCall(tool) => Some(tool),
                _ => None,
            })
            .nth(selected)
    }

    fn move_tool_selection(&mut self, direction: isize) {
        let count = self.tool_call_count();
        if count == 0 {
            self.selected_tool_call = None;
            return;
        }
        let current = self
            .selected_tool_call
            .unwrap_or(if direction < 0 { count } else { 0 });
        let next = if direction < 0 {
            current.saturating_sub(1)
        } else {
            (current + 1).min(count - 1)
        };
        self.selected_tool_call = Some(next);
    }

    fn filtered_providers(&self) -> Vec<&ProviderInfo> {
        if self.provider_search.is_empty() {
            return self.providers.iter().collect();
        }
        let query = self.provider_search.to_lowercase();
        self.providers
            .iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&query) || p.id.to_lowercase().contains(&query)
            })
            .collect()
    }

    fn ensure_models(&mut self) {
        if self.models.is_empty() {
            let mut models: Vec<String> = self
                .providers
                .iter()
                .flat_map(|provider| provider.models.iter().cloned())
                .collect();
            models.sort();
            models.dedup();
            self.models = models;
        }
    }

    fn filtered_models(&self) -> Vec<&String> {
        if self.model_search.is_empty() {
            return self.models.iter().collect();
        }
        let query = self.model_search.to_lowercase();
        self.models
            .iter()
            .filter(|model| model.to_lowercase().contains(&query))
            .collect()
    }

    fn take_input(&mut self) -> String {
        self.cursor = 0;
        std::mem::take(&mut self.input).trim().to_string()
    }

    #[allow(clippy::string_slice)]
    fn input_backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        let prev = self.input[..self.cursor]
            .chars()
            .last()
            .map(char::len_utf8)
            .unwrap_or(0);
        self.cursor -= prev;
        self.input.remove(self.cursor);
    }

    fn input_delete(&mut self) {
        if self.cursor < self.input.len() {
            self.input.remove(self.cursor);
        }
    }

    #[allow(clippy::string_slice)]
    fn input_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= self.input[..self.cursor]
                .chars()
                .last()
                .map(char::len_utf8)
                .unwrap_or(0);
        }
    }

    #[allow(clippy::string_slice)]
    fn input_right(&mut self) {
        if self.cursor < self.input.len() {
            self.cursor += self.input[self.cursor..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(0);
        }
    }
}

pub async fn run_tui() -> Result<()> {
    let (cmd_tx, msg_rx) = spawn_acp_client(std::env::current_exe()?);
    enable_raw_mode()?;
    stdout().execute(EnterAlternateScreen)?;

    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    terminal.clear()?;

    let mut app = App::new(cmd_tx.clone(), msg_rx);
    let mut events = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(120));
    let _ = cmd_tx.send(ClientCommand::Initialize);

    loop {
        terminal.draw(|frame| render(frame, &app))?;
        if app.should_quit {
            break;
        }

        tokio::select! {
            _ = tick.tick() => app.tick = app.tick.wrapping_add(1),
            event = events.next() => {
                if let Some(Ok(CrosstermEvent::Key(key))) = event {
                    app.handle_key(key.code, key.modifiers);
                }
            }
            msg = app.msg_rx.recv() => {
                if let Some(msg) = msg {
                    app.handle_agent_message(msg);
                } else {
                    break;
                }
            }
        }
    }

    let _ = cmd_tx.send(ClientCommand::Shutdown);
    disable_raw_mode()?;
    stdout().execute(LeaveAlternateScreen)?;
    Ok(())
}

fn render(frame: &mut Frame, app: &App) {
    let full_area = frame.area();
    frame.render_widget(
        Block::default().style(Style::default().bg(BACKGROUND).fg(TEXT_PRIMARY)),
        full_area,
    );
    let area = padded(full_area);
    match app.view {
        View::Splash => render_splash(frame, full_area, app.tick),
        View::Chat => render_chat(frame, area, app),
        View::Providers => render_providers(frame, area, app),
        View::Models => render_models(frame, area, app),
        View::Sessions => render_list_screen(
            frame,
            area,
            "Sessions",
            "recent sessions",
            "↑↓ navigate · enter resume · n new · esc back",
            app.sessions_selected,
            app.sessions
                .iter()
                .map(|s| (s.title.as_str(), s.updated_at.as_str(), false))
                .collect(),
        ),
        View::Extensions => render_list_screen(
            frame,
            area,
            "Extensions",
            "session extensions",
            "↑↓ navigate · space toggle · esc back",
            app.extensions_selected,
            app.extensions
                .iter()
                .map(|e| (e.name.as_str(), e.ext_type.as_str(), e.enabled))
                .collect(),
        ),
    }
}

fn matching_slash_commands(input: &str) -> Vec<SlashCommand> {
    let query = input.split_whitespace().next().unwrap_or(input);
    SLASH_COMMANDS
        .iter()
        .copied()
        .filter(|command| command.name.starts_with(query))
        .collect()
}

fn render_splash(frame: &mut Frame, area: Rect, tick: usize) {
    let frame_idx = (tick / 2) % GOOSE_FRAMES.len();
    let goose = GOOSE_FRAMES[frame_idx];
    let goose_width = goose
        .iter()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0);
    let goose_height = goose.len() as u16;
    let travel = area.width as usize + goose_width + 8;
    let position = ((tick * 2) % travel) as isize - goose_width as isize;
    let wing_lift = match tick % 12 {
        0..=2 => 0,
        3..=5 => 1,
        6..=8 => 0,
        _ => 1,
    };
    let y = area
        .y
        .saturating_add(area.height.saturating_sub(goose_height) / 2)
        .saturating_sub(wing_lift);

    let contrail_width = area.width.saturating_sub(8) as usize;
    let horizon = "·".repeat(contrail_width.min(48));
    let title = Rect {
        x: area.x,
        y: area.y + area.height.saturating_sub(5),
        width: area.width,
        height: 4.min(area.height),
    };
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(horizon, fg(RULE_COLOR).bg(BACKGROUND))),
            Line::from(vec![
                Span::styled(
                    "goose",
                    Style::default()
                        .fg(TEXT_PRIMARY)
                        .bg(BACKGROUND)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(" / ", fg(RULE_COLOR).bg(BACKGROUND)),
                Span::styled("initializing", fg(TEXT_DIM).bg(BACKGROUND)),
                Span::raw(" "),
                Span::styled(
                    SPINNER[tick % SPINNER.len()],
                    fg(TEXT_SECONDARY).bg(BACKGROUND),
                ),
            ]),
        ])
        .alignment(Alignment::Center),
        title,
    );

    if y >= area.y.saturating_add(area.height) {
        return;
    }

    let x = position.max(0) as u16;
    if x >= area.width {
        return;
    }

    let clipped = position.saturating_abs() as usize;
    let visible_height = area
        .y
        .saturating_add(area.height)
        .saturating_sub(y)
        .min(goose_height);
    let visible_width = area.width.saturating_sub(x) as usize;
    let lines: Vec<Line> = goose
        .iter()
        .take(visible_height as usize)
        .map(|line| {
            let text = line
                .chars()
                .skip(if position < 0 { clipped } else { 0 })
                .take(visible_width)
                .collect::<String>();
            Line::from(Span::styled(text, fg(TEXT_PRIMARY).bg(BACKGROUND)))
        })
        .collect();
    frame.render_widget(
        Paragraph::new(lines),
        Rect {
            x: area.x + x,
            y,
            width: visible_width as u16,
            height: visible_height,
        },
    );
}

fn render_chat(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(1),
        Constraint::Length(3),
    ])
    .split(area);

    render_header(
        frame,
        chunks[0],
        &app.status,
        app.loading,
        app.tick,
        app.turn_count(),
    );
    if app.expanded_tool_call {
        if let Some(tool) = app.selected_tool() {
            render_tool_expanded(frame, chunks[1], tool, app.expanded_scroll);
        } else {
            render_messages(frame, chunks[1], app);
        }
    } else {
        render_messages(frame, chunks[1], app);
    }
    render_input(frame, chunks[2], app);
    render_slash_popover(frame, area, app);
    render_help_menu(frame, area, app);
}

fn render_header(
    frame: &mut Frame,
    area: Rect,
    status: &str,
    loading: bool,
    tick: usize,
    turns: usize,
) {
    let width = area.width as usize;
    let left_width = width.saturating_mul(7) / 10;
    let right_width = width.saturating_sub(left_width);
    let row = Layout::horizontal([
        Constraint::Length(left_width as u16),
        Constraint::Length(right_width as u16),
    ])
    .split(area);
    let status_color = match status {
        "ready" => TEAL,
        "error" => CRANBERRY,
        _ => TEXT_DIM,
    };
    let mut left = vec![
        Span::styled(
            "goose",
            Style::default()
                .fg(TEXT_PRIMARY)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" · ", fg(RULE_COLOR)),
        Span::styled(
            truncate(status, left_width.saturating_sub(10)),
            fg(status_color),
        ),
    ];
    if loading {
        left.push(Span::raw(" "));
        left.push(Span::styled(SPINNER[tick % SPINNER.len()], fg(TEAL)));
    }
    frame.render_widget(Paragraph::new(Line::from(left)), row[0]);
    let right = if turns > 1 {
        format!("{turns} turns  /help commands")
    } else {
        "/help commands".to_string()
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            truncate(&right, right_width),
            fg(TEXT_DIM),
        )))
        .alignment(Alignment::Right),
        row[1],
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled("─".repeat(width), fg(RULE_COLOR)))),
        Rect {
            y: area.y + 1,
            height: 1,
            ..area
        },
    );
}

fn render_messages(frame: &mut Frame, area: Rect, app: &App) {
    let width = area.width as usize;
    let content_width = width.saturating_sub(4).max(10);
    let mut lines = Vec::new();
    let mut tool_index = 0;

    for item in &app.timeline {
        if !lines.is_empty() {
            lines.push(Line::from(""));
        }
        match item {
            TimelineItem::Message { role, content } => match role {
                Role::User => push_user_message(&mut lines, content, content_width),
                Role::Assistant => push_markdown(&mut lines, content, content_width),
                Role::System => lines.push(Line::from(Span::styled(
                    truncate_flat(content, width),
                    italic(TEXT_DIM),
                ))),
            },
            TimelineItem::ToolCall(tool) => {
                push_tool_call(
                    &mut lines,
                    tool,
                    app.tick,
                    width,
                    app.selected_tool_call == Some(tool_index),
                );
                tool_index += 1;
            }
        }
    }

    if !app.streaming.is_empty() {
        if !lines.is_empty() {
            lines.push(Line::from(""));
        }
        push_markdown(&mut lines, &app.streaming, content_width);
    }

    let scroll = lines.len().saturating_sub(area.height as usize) as u16;
    frame.render_widget(
        Paragraph::new(lines)
            .scroll((scroll, 0))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn push_user_message(lines: &mut Vec<Line<'static>>, content: &str, width: usize) {
    lines.push(Line::from(vec![
        Span::styled("› ", bold(CRANBERRY)),
        Span::styled(truncate_flat(content, width), fg(TEXT_PRIMARY)),
    ]));
}

fn push_tool_call(
    lines: &mut Vec<Line<'static>>,
    tool: &ToolCall,
    tick: usize,
    width: usize,
    selected: bool,
) {
    let safe_width = width.max(10);
    let inner_width = safe_width.saturating_sub(4).max(6);
    let border_color = if selected {
        GOLD
    } else if matches!(tool.status, ToolCallStatus::Failed) {
        CRANBERRY
    } else {
        CEDAR
    };
    let h_rule = "─".repeat(safe_width.saturating_sub(2));
    if selected {
        lines.push(Line::from(Span::styled(
            format!("╭{h_rule}╮"),
            fg(border_color),
        )));
    }

    let status_icon = tool_status_icon(tool.status, tick);
    let kind_icon = tool_kind_icon(tool.kind);
    let running_text = if matches!(tool.status, ToolCallStatus::InProgress) {
        " running…"
    } else {
        ""
    };
    let hint_text = if selected { "space to expand" } else { "" };
    let fixed_len = 4 + running_text.chars().count() + hint_text.chars().count();
    let title = truncate_flat(&tool.title, inner_width.saturating_sub(fixed_len).max(4));
    let used = display_width(&format!(
        "{status_icon} {kind_icon} {title}{running_text}{hint_text}"
    ));
    let spacer = " ".repeat(inner_width.saturating_sub(used));

    lines.push(Line::from(vec![
        Span::styled("  ", fg(border_color)),
        Span::styled(status_icon, fg(tool_status_color(tool.status))),
        Span::raw(format!(" {kind_icon} ")),
        Span::styled(
            title,
            Style::default()
                .fg(TEXT_SECONDARY)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(running_text, italic(TEXT_DIM)),
        Span::raw(spacer),
        Span::styled(hint_text, italic(GOLD)),
        Span::styled("  ", fg(border_color)),
    ]));
    if selected {
        lines.push(Line::from(Span::styled(
            format!("╰{h_rule}╯"),
            fg(border_color),
        )));
    }
}

fn tool_status_icon(status: ToolCallStatus, tick: usize) -> &'static str {
    match status {
        ToolCallStatus::Pending => "·",
        ToolCallStatus::InProgress => SPINNER[tick % SPINNER.len()],
        ToolCallStatus::Completed => "•",
        ToolCallStatus::Failed => "✗",
        _ => "·",
    }
}

fn tool_status_color(status: ToolCallStatus) -> Color {
    match status {
        ToolCallStatus::Pending => TEXT_DIM,
        ToolCallStatus::InProgress => GOLD,
        ToolCallStatus::Completed => TEAL,
        ToolCallStatus::Failed => CRANBERRY,
        _ => TEXT_DIM,
    }
}

fn tool_kind_icon(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "run",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "mode",
        ToolKind::Other => "tool",
        _ => "tool",
    }
}

fn render_tool_expanded(frame: &mut Frame, area: Rect, tool: &ToolCall, scroll_offset: usize) {
    let width = area.width as usize;
    let height = area.height as usize;
    let content_width = width.saturating_sub(4).max(10);
    let body_height = height.saturating_sub(4).max(1);
    let mut body = expanded_tool_lines(tool, content_width);
    if body.is_empty() {
        body.push(Line::from(Span::styled(
            "(no details yet)",
            italic(TEXT_DIM),
        )));
    }

    let total = body.len();
    let content_height = if total > body_height {
        body_height.saturating_sub(2).max(1)
    } else {
        body_height
    };
    let end = total
        .saturating_sub(scroll_offset)
        .max(content_height)
        .min(total);
    let start = end.saturating_sub(content_height);

    let mut lines = vec![Line::from(vec![
        Span::styled("•", fg(tool_status_color(tool.status))),
        Span::styled(format!(" {:?}", tool.status), fg(TEXT_DIM)),
        Span::raw("  "),
        Span::styled(
            truncate_flat(&tool.title, content_width.saturating_sub(18)),
            Style::default()
                .fg(TEXT_PRIMARY)
                .add_modifier(Modifier::BOLD),
        ),
    ])];
    lines.push(Line::from(Span::styled(
        "─".repeat(content_width),
        fg(RULE_COLOR),
    )));

    if total > body_height {
        let above = start;
        lines.push(Line::from(Span::styled(
            if above > 0 {
                format!("▲ {above} more (↑)")
            } else {
                String::new()
            },
            fg(TEXT_DIM),
        )));
    }
    lines.extend(body[start..end].iter().cloned());
    for _ in 0..content_height.saturating_sub(end - start) {
        lines.push(Line::from(""));
    }
    if total > body_height {
        let below = total.saturating_sub(end);
        lines.push(Line::from(Span::styled(
            if below > 0 {
                format!("▼ {below} more (↓)")
            } else {
                String::new()
            },
            fg(TEXT_DIM),
        )));
    }

    let block = ui_block(GOLD, BorderType::Rounded, 1);
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn expanded_tool_lines(tool: &ToolCall, width: usize) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    push_expanded_section(
        &mut lines,
        "arguments",
        format_json(tool.raw_input.as_ref()),
        width,
    );
    push_expanded_section(&mut lines, "result", tool_result_text(tool), width);
    lines
}

fn push_expanded_section(lines: &mut Vec<Line<'static>>, label: &str, text: String, width: usize) {
    if !lines.is_empty() {
        lines.push(Line::from(""));
    }
    lines.push(Line::from(Span::styled(
        label.to_string(),
        Style::default()
            .fg(TEXT_SECONDARY)
            .add_modifier(Modifier::BOLD),
    )));
    if text.is_empty() {
        lines.push(Line::from(Span::styled("(empty)", italic(TEXT_DIM))));
        return;
    }
    for raw in text.lines() {
        for wrapped in wrap_words(raw, width) {
            lines.push(Line::from(Span::styled(wrapped, fg(TEXT_PRIMARY))));
        }
    }
}

fn render_help_menu(frame: &mut Frame, area: Rect, app: &App) {
    if app.view != View::Chat || !app.show_help_menu {
        return;
    }
    render_command_menu(
        frame,
        centered(area, 56.min(area.width), 12.min(area.height)),
        SLASH_COMMANDS,
        None,
    );
}

fn render_slash_popover(frame: &mut Frame, area: Rect, app: &App) {
    if app.view != View::Chat {
        return;
    }
    let commands = app.slash_commands();
    if commands.is_empty() {
        return;
    }

    let width = 52.min(area.width.saturating_sub(2)).max(24);
    let height = (commands.len() as u16 + 2).min(10);
    let x = area.x + 1;
    let y = area.y + area.height.saturating_sub(height + 3);
    let popover = Rect {
        x,
        y,
        width,
        height,
    };
    let visible = height.saturating_sub(2) as usize;
    let selected = app.slash_selected.min(commands.len() - 1);
    let start = selected.saturating_sub(visible.saturating_sub(1));
    let end = (start + visible).min(commands.len());
    render_command_menu(
        frame,
        popover,
        &commands[start..end],
        Some(selected - start),
    );
}

fn render_command_menu(
    frame: &mut Frame,
    area: Rect,
    commands: &[SlashCommand],
    selected: Option<usize>,
) {
    let inner_width = area.width.saturating_sub(4) as usize;
    let lines: Vec<Line> = commands
        .iter()
        .enumerate()
        .map(|(index, command)| {
            let is_selected = selected == Some(index);
            let name_style = Style::default()
                .fg(if is_selected { BACKGROUND } else { GOLD })
                .bg(if is_selected { GOLD } else { BACKGROUND })
                .add_modifier(Modifier::BOLD);
            let description_style = Style::default()
                .fg(if is_selected { BACKGROUND } else { TEXT_DIM })
                .bg(if is_selected { GOLD } else { BACKGROUND });
            let available = inner_width.saturating_sub(command.name.len() + 4);
            Line::from(vec![
                Span::styled(if is_selected { "› " } else { "  " }, name_style),
                Span::styled(command.name, name_style),
                Span::styled("  ", description_style),
                Span::styled(truncate(command.description, available), description_style),
            ])
        })
        .collect();
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(fg(GOLD))
        .title(Span::styled(" commands ", fg(TEXT_SECONDARY)));
    frame.render_widget(Clear, area);
    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_input(frame: &mut Frame, area: Rect, app: &App) {
    let block = ui_block(RULE_COLOR, BorderType::Rounded, 2);
    let input_area = block.inner(area);
    frame.render_widget(block, area);

    let text = if app.input.is_empty() {
        vec![
            Span::styled("› ", bold(CRANBERRY)),
            Span::styled("Type a message or /help for commands…", fg(TEXT_DIM)),
        ]
    } else {
        vec![
            Span::styled("› ", bold(CRANBERRY)),
            Span::styled(
                truncate(&app.input, input_area.width.saturating_sub(2) as usize),
                fg(TEXT_PRIMARY),
            ),
        ]
    };
    frame.render_widget(Paragraph::new(Line::from(text)), input_area);
    if app.view == View::Chat && !app.loading {
        let x = input_area.x + 2 + (app.cursor as u16).min(input_area.width.saturating_sub(3));
        frame.set_cursor_position((x, input_area.y));
    }
}

fn render_models(frame: &mut Frame, area: Rect, app: &App) {
    render_picker_screen(
        frame,
        area,
        PickerScreen {
            title: "Models",
            subtitle: "Choose a model for your provider",
            help: "type to filter · ↑↓ navigate · enter select · esc back",
            search: &app.model_search,
            selected: app.models_selected,
            items: app
                .filtered_models()
                .into_iter()
                .map(|model| (model.as_str(), ""))
                .collect(),
        },
    );
}

fn render_providers(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(3),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(area);

    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                "goose",
                Style::default()
                    .fg(TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(
                "Connect an AI model provider to get started",
                fg(TEXT_DIM),
            )),
        ])
        .alignment(Alignment::Center),
        chunks[0],
    );

    let search_width = area.width.saturating_sub(4).min(60);
    let search = centered(chunks[1], search_width, 3);
    let block = ui_block(RULE_COLOR, BorderType::Rounded, 2);
    let inner = block.inner(search);
    frame.render_widget(block, search);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("› ", bold(CRANBERRY)),
            Span::styled(
                if app.provider_search.is_empty() {
                    "search providers…".into()
                } else {
                    app.provider_search.clone()
                },
                fg(if app.provider_search.is_empty() {
                    TEXT_DIM
                } else {
                    TEXT_PRIMARY
                }),
            ),
        ])),
        inner,
    );

    render_provider_grid(frame, chunks[2], app);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "↑↓←→ navigate · enter select · type to search · esc clear/back",
            fg(TEXT_DIM),
        )))
        .alignment(Alignment::Center),
        chunks[3],
    );
}

fn render_provider_grid(frame: &mut Frame, area: Rect, app: &App) {
    let providers = app.filtered_providers();
    if providers.is_empty() {
        frame.render_widget(
            Paragraph::new("No matching providers found")
                .style(fg(TEXT_DIM))
                .alignment(Alignment::Center),
            area,
        );
        return;
    }

    let card_width = 36u16;
    let card_height = 8u16;
    let columns = provider_columns(area.width);
    let rows_visible = ((area.height as usize + 1) / (card_height as usize + 1)).max(1);
    let selected_row = app.providers_selected / columns;
    let total_rows = providers.len().div_ceil(columns);
    let scroll_row = selected_row.saturating_sub(rows_visible.saturating_sub(1));
    let visible_rows = rows_visible.min(total_rows.saturating_sub(scroll_row));
    let grid_width = (columns as u16 * card_width) + (columns.saturating_sub(1) as u16 * 2);
    let grid = centered(
        area,
        grid_width.min(area.width),
        (visible_rows as u16 * (card_height + 1))
            .saturating_sub(1)
            .min(area.height),
    );

    for row in 0..visible_rows {
        for col in 0..columns {
            let idx = (scroll_row + row) * columns + col;
            let Some(provider) = providers.get(idx) else {
                continue;
            };
            let x = grid.x + col as u16 * (card_width + 2);
            let y = grid.y + row as u16 * (card_height + 1);
            if x + card_width <= area.x + area.width && y + card_height <= area.y + area.height {
                render_provider_card(
                    frame,
                    Rect {
                        x,
                        y,
                        width: card_width,
                        height: card_height,
                    },
                    provider,
                    idx == app.providers_selected,
                );
            }
        }
    }

    if scroll_row > 0 {
        frame.render_widget(
            Paragraph::new(format!("▲ {} more above", scroll_row * columns))
                .style(fg(TEXT_DIM))
                .alignment(Alignment::Center),
            Rect {
                y: area.y,
                height: 1,
                ..area
            },
        );
    }
    if scroll_row + visible_rows < total_rows {
        let remaining = providers
            .len()
            .saturating_sub((scroll_row + visible_rows) * columns);
        frame.render_widget(
            Paragraph::new(format!("▼ {remaining} more below"))
                .style(fg(TEXT_DIM))
                .alignment(Alignment::Center),
            Rect {
                y: area.y + area.height.saturating_sub(1),
                height: 1,
                ..area
            },
        );
    }
}

fn render_provider_card(frame: &mut Frame, area: Rect, provider: &ProviderInfo, selected: bool) {
    let border = BorderType::Plain;
    let border_color = if selected { GOLD } else { RULE_COLOR };
    let block = ui_block(border_color, border, 1);
    let inner = block.inner(area);
    frame.render_widget(Clear, area);
    frame.render_widget(block, area);

    let icon = if provider.configured { "✓" } else { "" };
    let title_width = inner.width.saturating_sub(2) as usize;
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                truncate(&provider.name, title_width),
                Style::default()
                    .fg(if selected {
                        TEXT_PRIMARY
                    } else {
                        TEXT_SECONDARY
                    })
                    .add_modifier(if selected {
                        Modifier::BOLD
                    } else {
                        Modifier::empty()
                    }),
            ),
            Span::styled(icon, fg(TEAL)),
        ])),
        Rect { height: 1, ..inner },
    );
    frame.render_widget(
        Paragraph::new(truncate(&provider.id, inner.width as usize)).style(fg(TEXT_DIM)),
        Rect {
            y: inner.y + 2,
            height: 1,
            ..inner
        },
    );
    let desc = truncate_flat(&provider.description, (inner.width as usize) * 3);
    frame.render_widget(
        Paragraph::new(desc)
            .style(fg(TEXT_DIM))
            .wrap(Wrap { trim: true }),
        Rect {
            y: inner.y + 4,
            height: 3,
            ..inner
        },
    );
}

struct PickerScreen<'a> {
    title: &'a str,
    subtitle: &'a str,
    help: &'a str,
    search: &'a str,
    selected: usize,
    items: Vec<(&'a str, &'a str)>,
}

fn render_picker_screen(frame: &mut Frame, area: Rect, picker: PickerScreen<'_>) {
    let chunks = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(3),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                format!("{}", picker.title),
                Style::default()
                    .fg(TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(picker.subtitle.to_string(), fg(TEXT_DIM))),
        ])
        .alignment(Alignment::Center),
        chunks[0],
    );

    let search_width = area.width.saturating_sub(4).min(60);
    let search_area = centered(chunks[1], search_width, 3);
    let block = ui_block(RULE_COLOR, BorderType::Rounded, 2);
    let inner = block.inner(search_area);
    frame.render_widget(block, search_area);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("› ", bold(CRANBERRY)),
            Span::styled(
                if picker.search.is_empty() {
                    "search…"
                } else {
                    picker.search
                },
                fg(if picker.search.is_empty() {
                    TEXT_DIM
                } else {
                    TEXT_PRIMARY
                }),
            ),
        ])),
        inner,
    );

    let list_width = area.width.saturating_sub(4).min(86);
    let list = centered(chunks[2], list_width, chunks[2].height);
    let visible = list.height.saturating_sub(2) as usize;
    let scroll = picker.selected.saturating_sub(visible.saturating_sub(1));
    let mut lines = Vec::new();
    if picker.items.is_empty() {
        lines.push(Line::from(Span::styled("No matches", fg(TEXT_DIM))));
    } else {
        for (idx, (name, meta)) in picker.items.iter().enumerate().skip(scroll).take(visible) {
            lines.push(Line::from(vec![
                Span::styled(
                    if idx == picker.selected { "› " } else { "  " },
                    bold(CRANBERRY),
                ),
                Span::styled(
                    truncate_flat(name, list_width.saturating_sub(8) as usize),
                    Style::default()
                        .fg(if idx == picker.selected {
                            TEXT_PRIMARY
                        } else {
                            TEXT_SECONDARY
                        })
                        .add_modifier(if idx == picker.selected {
                            Modifier::BOLD
                        } else {
                            Modifier::empty()
                        }),
                ),
                Span::styled(format!("  {meta}"), fg(TEXT_DIM)),
            ]));
        }
    }
    let block = ui_block(RULE_COLOR, BorderType::Rounded, 1);
    frame.render_widget(Paragraph::new(lines).block(block), list);
    frame.render_widget(
        Paragraph::new(picker.help)
            .style(fg(TEXT_DIM))
            .alignment(Alignment::Center),
        chunks[3],
    );
}

fn render_list_screen(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    label: &str,
    help: &str,
    selected: usize,
    items: Vec<(&str, &str, bool)>,
) {
    let chunks = Layout::vertical([
        Constraint::Length(4),
        Constraint::Min(1),
        Constraint::Length(2),
    ])
    .split(area);
    frame.render_widget(
        Paragraph::new(vec![
            Line::from(Span::styled(
                title.to_string(),
                Style::default()
                    .fg(TEXT_PRIMARY)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(Span::styled(label, fg(TEXT_DIM))),
        ])
        .alignment(Alignment::Center),
        chunks[0],
    );

    let list_width = area.width.saturating_sub(4).min(86);
    let list = centered(chunks[1], list_width, chunks[1].height);
    let visible = chunks[1].height.saturating_sub(2) as usize;
    let scroll = selected.saturating_sub(visible.saturating_sub(1));
    let mut lines = Vec::new();
    if items.is_empty() {
        lines.push(Line::from(Span::styled("Nothing here yet", fg(TEXT_DIM))));
    } else {
        for (idx, (name, meta, enabled)) in items.iter().enumerate().skip(scroll).take(visible) {
            lines.push(Line::from(vec![
                Span::styled(if idx == selected { "› " } else { "  " }, bold(CRANBERRY)),
                Span::styled(if *enabled { "✓ " } else { "" }, fg(TEAL)),
                Span::styled(
                    truncate_flat(
                        if name.is_empty() {
                            "Untitled Session"
                        } else {
                            name
                        },
                        list_width as usize / 2,
                    ),
                    Style::default()
                        .fg(if idx == selected {
                            TEXT_PRIMARY
                        } else {
                            TEXT_SECONDARY
                        })
                        .add_modifier(if idx == selected {
                            Modifier::BOLD
                        } else {
                            Modifier::empty()
                        }),
                ),
                Span::styled(format!("  {meta}"), fg(TEXT_DIM)),
            ]));
        }
    }
    let block = ui_block(RULE_COLOR, BorderType::Rounded, 1);
    frame.render_widget(Paragraph::new(lines).block(block), list);
    frame.render_widget(
        Paragraph::new(help)
            .style(fg(TEXT_DIM))
            .alignment(Alignment::Center),
        chunks[2],
    );
}

fn wrap_words(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        if line.is_empty() {
            line.push_str(word);
        } else if line.len() + 1 + word.len() <= width {
            line.push(' ');
            line.push_str(word);
        } else {
            lines.push(std::mem::take(&mut line));
            line.push_str(word);
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn display_width(text: &str) -> usize {
    text.chars().count()
}

fn format_json(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| serde_json::to_string_pretty(value).ok())
        .unwrap_or_default()
}

fn tool_result_text(tool: &ToolCall) -> String {
    let raw = format_json(tool.raw_output.as_ref());
    if !raw.is_empty() {
        return raw;
    }
    let mut parts = Vec::new();
    for item in &tool.content {
        match item {
            AcpToolCallContent::Content(content) => match &content.content {
                ContentBlock::Text(text) => parts.push(text.text.clone()),
                ContentBlock::ResourceLink(link) => parts.push(format!("link {}", link.uri)),
                ContentBlock::Image(image) => parts.push(format!(
                    "image ({}){}",
                    image.mime_type,
                    image
                        .uri
                        .as_deref()
                        .map(|uri| format!(" {uri}"))
                        .unwrap_or_default()
                )),
                ContentBlock::Audio(audio) => parts.push(format!("audio ({})", audio.mime_type)),
                ContentBlock::Resource(resource) => match &resource.resource {
                    EmbeddedResourceResource::TextResourceContents(text) => {
                        parts.push(text.text.clone())
                    }
                    EmbeddedResourceResource::BlobResourceContents(blob) => {
                        parts.push(format!("blob {}", blob.uri))
                    }
                    _ => {}
                },
                _ => {}
            },
            AcpToolCallContent::Diff(diff) => {
                let mut diff_text = vec![format!("diff {}", diff.path.display())];
                if let Some(old) = &diff.old_text {
                    diff_text.extend(old.lines().map(|line| format!("- {line}")));
                }
                diff_text.extend(diff.new_text.lines().map(|line| format!("+ {line}")));
                parts.push(diff_text.join("\n"));
            }
            AcpToolCallContent::Terminal(terminal) => {
                parts.push(format!("▶ terminal: {}", terminal.terminal_id.0));
            }
            _ => {}
        }
    }
    parts.join("\n\n")
}

fn truncate(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        text.to_string()
    } else if max > 1 {
        format!("{}…", text.chars().take(max - 1).collect::<String>())
    } else {
        "…".into()
    }
}

fn truncate_flat(text: &str, max: usize) -> String {
    truncate(&text.split_whitespace().collect::<Vec<_>>().join(" "), max)
}

fn provider_columns(width: u16) -> usize {
    ((width.saturating_sub(4) / 38).max(1)) as usize
}

fn terminal_width() -> u16 {
    crossterm::terminal::size().map(|(w, _)| w).unwrap_or(80)
}

fn padded(area: Rect) -> Rect {
    let horizontal = area.width.min(2);
    let vertical = area.height.min(1);
    Rect {
        x: area.x + horizontal,
        y: area.y + vertical,
        width: area.width.saturating_sub(horizontal * 2),
        height: area.height.saturating_sub(vertical * 2),
    }
}

fn centered(area: Rect, width: u16, height: u16) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(area.height.saturating_sub(height) / 2),
            Constraint::Length(height.min(area.height)),
            Constraint::Min(0),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(area.width.saturating_sub(width) / 2),
            Constraint::Length(width.min(area.width)),
            Constraint::Min(0),
        ])
        .split(vertical[1])[1]
}
