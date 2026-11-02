//! Clap definitions for `papyri` and `papyri ctl`.

use clap::{Args, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
  name = "papyri",
  version,
  about = "Read Markdown, PDF, Typst, and LaTeX documents",
  long_about = "Papyri is a read-only document viewer for Markdown, PDF, Typst, and LaTeX.\n\nRun `papyri ctl --help` to control a running window over its local socket, or `papyri completions <shell>` to install shell completions.",
  after_help = "Examples:\n  papyri notes.md\n  papyri --decorationless notes.md\n  papyri ctl state --json\n  papyri ctl scroll by 400\n  papyri completions bash\n\nSee docs/control.md for the control protocol and editor integration examples."
)]
pub(crate) struct Cli {
  /// Document or directory to open. A running window receives this path.
  #[arg(value_name = "PATH")]
  pub(crate) path: Option<PathBuf>,
  /// Open in decoration-less reading mode
  #[arg(short = 'd', long)]
  pub(crate) decorationless: bool,
  #[command(subcommand)]
  pub(crate) command: Option<TopCommand>,
}

#[derive(Subcommand, Debug)]
pub(crate) enum TopCommand {
  /// Control a running Papyri window over its local socket
  #[command(
    long_about = "Control a running Papyri window over its local socket.\n\nCommands print a human-readable summary by default; `watch` always streams JSONL. Pass `--json` for one compact JSON object from other commands; runtime errors use the same JSON envelope. Use `--wait` to wait for the socket, or `ping --wait` to also wait for host readiness.",
    after_help = "Examples:\n  papyri ctl ping --wait 5\n  papyri ctl open notes.md --anchor intro\n  papyri ctl tab next\n  papyri ctl scroll by 400\n  papyri ctl decorationless on\n  papyri ctl preferences set '{\"theme\":\"latte\"}'\n  papyri ctl watch --events state,headings\n\nSet PAPYRI_CONTROL_SOCKET or pass --socket to target another instance."
  )]
  Ctl(CtlArgs),
  /// Generate shell completions for papyri
  Completions(CompletionsArgs),
}

#[derive(Args, Debug)]
#[command(version, display_name = "papyri ctl")]
pub(crate) struct CtlArgs {
  /// Print one compact JSON object instead of a human-readable summary (watch always streams JSONL)
  #[arg(short = 'j', long, global = true, help_heading = "Output")]
  pub(crate) json: bool,
  /// Wait up to this many seconds for the control socket (ping also waits for host readiness)
  #[arg(
    long,
    global = true,
    value_name = "SECONDS",
    default_value_t = 0.0,
    help_heading = "Connection"
  )]
  pub(crate) wait: f64,
  /// Control socket path, resolved to an absolute path (defaults to PAPYRI_CONTROL_SOCKET or the runtime directory)
  #[arg(
    short = 's',
    long,
    global = true,
    value_name = "PATH",
    help_heading = "Connection"
  )]
  pub(crate) socket: Option<PathBuf>,
  #[command(subcommand)]
  pub(crate) command: CtlCommand,
}

#[derive(Args, Debug)]
pub(crate) struct CompletionsArgs {
  /// Shell to generate completions for
  #[arg(value_enum)]
  pub(crate) shell: Shell,
}

#[derive(Subcommand, Debug)]
pub(crate) enum CtlCommand {
  /// Check whether Papyri is running
  Ping,
  /// Print the current document, tabs, view, and preferences
  #[command(visible_alias = "status")]
  State,
  /// Print the active document's headings
  Headings,
  /// List palette commands that `command` can run
  Commands,
  /// Open a document or folder, launching Papyri if needed
  Open(OpenArgs),
  /// Close a tab (the active tab by default)
  Close {
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
  },
  /// Focus an open tab, opening it if needed
  Focus {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Switch, focus, close, or list tabs
  #[command(visible_alias = "tabs")]
  Tab(TabArgs),
  /// Scroll a preview pane
  Scroll(ScrollArgs),
  /// Change document or interface zoom
  Zoom(ZoomArgs),
  /// Toggle or set fit-to-width
  #[command(visible_alias = "fit")]
  FitWidth {
    #[arg(value_enum, value_name = "ACTION")]
    action: Option<ToggleAction>,
  },
  /// Toggle or set decoration-less reading mode
  #[command(visible_alias = "decoration-less")]
  Decorationless {
    #[arg(value_enum, value_name = "ACTION")]
    action: Option<ToggleAction>,
  },
  /// Set the color theme
  Theme(ThemeArgs),
  /// Show or hide a panel
  Panel(PanelArgs),
  /// Set the document search query (empty clears it)
  Search {
    #[arg(value_name = "QUERY")]
    query: String,
  },
  /// Scroll to a heading or PDF outline target
  Heading {
    #[arg(value_name = "ID")]
    id: String,
  },
  /// Go to a PDF page in the active document
  Page {
    #[arg(value_name = "PAGE")]
    page: u32,
  },
  /// Run a command palette action by id
  Command {
    #[arg(value_name = "ID")]
    id: String,
  },
  /// Read or update preferences
  #[command(visible_alias = "prefs")]
  Preferences(PreferencesArgs),
  /// Refresh the active document and explorer
  Refresh,
  /// Stream state events as newline-delimited JSON
  Watch(WatchArgs),
  /// Print the resolved control socket path
  Socket,
  /// Focus the main window
  Raise,
  /// Quit Papyri
  Quit,
  /// Send an arbitrary control method (advanced)
  Raw(RawArgs),
}

#[derive(Args, Debug)]
pub(crate) struct OpenArgs {
  /// Document or folder to open
  #[arg(value_name = "PATH")]
  pub(crate) path: PathBuf,
  /// Scroll to a heading, PDF outline target, or page anchor after opening
  #[arg(long, value_name = "ANCHOR")]
  pub(crate) anchor: Option<String>,
  /// Open in the secondary split pane
  #[arg(long)]
  pub(crate) secondary: bool,
  /// Fail instead of launching Papyri when it is not running
  #[arg(long)]
  pub(crate) no_launch: bool,
  /// Seconds to wait for an auto-launched window (default: 30)
  #[arg(long, value_name = "SECONDS")]
  pub(crate) launch_timeout: Option<f64>,
}

#[derive(Args, Debug)]
pub(crate) struct TabArgs {
  #[command(subcommand)]
  pub(crate) command: TabCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum TabCommand {
  /// Select the next tab
  Next,
  /// Select the previous tab
  Previous,
  /// Print open tabs
  List,
  /// Focus an open tab
  Activate {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Close a tab (the active tab by default)
  Close {
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
  },
}

#[derive(Args, Debug)]
pub(crate) struct ScrollArgs {
  #[command(subcommand)]
  pub(crate) command: ScrollCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ScrollCommand {
  /// Scroll to an absolute pixel position
  To {
    /// Vertical position in CSS pixels
    #[arg(value_name = "Y", allow_hyphen_values = true)]
    y: f64,
    /// Preview pane to scroll
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll by a relative pixel amount
  By {
    /// Vertical delta in CSS pixels; negative scrolls up
    #[arg(value_name = "DY", allow_hyphen_values = true)]
    dy: f64,
    /// Preview pane to scroll
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the top
  Top {
    /// Preview pane to scroll
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the bottom
  Bottom {
    /// Preview pane to scroll
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
}

#[derive(Args, Debug)]
pub(crate) struct ZoomArgs {
  /// Zoom action to perform
  #[arg(value_enum)]
  pub(crate) action: ZoomAction,
  /// Percentage for `zoom set`
  #[arg(value_name = "PERCENT")]
  pub(crate) value: Option<f64>,
  /// Zoom target: document content or the interface
  #[arg(long, value_enum, default_value_t = ZoomTarget::Document)]
  pub(crate) target: ZoomTarget,
}

#[derive(Args, Debug)]
pub(crate) struct ThemeArgs {
  /// Color theme to apply
  #[arg(value_enum)]
  pub(crate) theme: ThemeArg,
}

#[derive(Args, Debug)]
pub(crate) struct PanelArgs {
  /// Panel to show or hide
  #[arg(value_enum)]
  pub(crate) name: PanelName,
  /// Whether to turn the panel on, off, or toggle it
  #[arg(value_enum)]
  pub(crate) action: ToggleAction,
}

#[derive(Args, Debug)]
pub(crate) struct PreferencesArgs {
  #[command(subcommand)]
  pub(crate) command: PreferenceCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum PreferenceCommand {
  /// Print the current preferences
  Get,
  /// Merge a JSON object into preferences
  Set {
    #[arg(value_name = "JSON")]
    patch: String,
  },
}

#[derive(Args, Debug)]
pub(crate) struct WatchArgs {
  /// Comma-separated event names to stream (default: all events)
  #[arg(long, value_delimiter = ',', value_name = "EVENTS")]
  pub(crate) events: Vec<String>,
  /// Do not print the initial state snapshot
  #[arg(long)]
  pub(crate) no_initial: bool,
}

#[derive(Args, Debug)]
pub(crate) struct RawArgs {
  /// Control method name accepted by the socket protocol
  #[arg(value_name = "METHOD")]
  pub(crate) method: String,
  /// JSON object with method parameters
  #[arg(value_name = "JSON", default_value = "{}")]
  pub(crate) params: String,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PaneArg {
  /// Main preview pane
  Main,
  /// Secondary split pane
  Secondary,
}

impl PaneArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Main => "main",
      Self::Secondary => "secondary",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ZoomAction {
  /// Zoom in by one step
  In,
  /// Zoom out by one step
  Out,
  /// Reset to 100%
  Reset,
  /// Set an explicit percentage
  Set,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ZoomTarget {
  /// Document content zoom
  Document,
  /// Application interface zoom
  Ui,
}

impl ZoomTarget {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Document => "document",
      Self::Ui => "ui",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ThemeArg {
  /// Light theme (Catppuccin Latte)
  #[value(name = "latte", alias = "light")]
  Light,
  /// Dark theme (Catppuccin Mocha)
  #[value(name = "mocha", alias = "dark")]
  Dark,
  /// Switch to the other theme
  Toggle,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PanelName {
  /// Explorer sidebar
  Sidebar,
  /// Document outline
  Outline,
  /// Settings dialog
  Settings,
  /// Command palette
  Palette,
  /// Document search
  Search,
  /// Secondary split pane
  Split,
}

impl PanelName {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Sidebar => "sidebar",
      Self::Outline => "outline",
      Self::Settings => "settings",
      Self::Palette => "palette",
      Self::Search => "search",
      Self::Split => "split",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ToggleAction {
  /// Turn the target on
  On,
  /// Turn the target off
  Off,
  /// Invert the current state
  Toggle,
}

impl ToggleAction {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::On => "on",
      Self::Off => "off",
      Self::Toggle => "toggle",
    }
  }
}
