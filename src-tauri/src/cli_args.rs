//! Clap definitions for `papyri` and `papyri ctl`.

use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
  name = "papyri",
  version,
  about = "Read Markdown, PDF, Typst, and LaTeX documents",
  long_about = "Papyri is a read-only document viewer. Run `papyri ctl --help` to control a running window."
)]
pub(crate) struct Cli {
  /// Document or directory to open. A running window receives this path.
  #[arg(value_name = "PATH")]
  pub(crate) path: Option<PathBuf>,
  #[command(subcommand)]
  pub(crate) command: Option<TopCommand>,
}

#[derive(Subcommand, Debug)]
pub(crate) enum TopCommand {
  /// Control a running Papyri window over its local socket
  Ctl(CtlArgs),
}

#[derive(Args, Debug)]
pub(crate) struct CtlArgs {
  /// Print compact JSON instead of a human-readable summary
  #[arg(long, global = true)]
  pub(crate) json: bool,
  /// Wait up to this many seconds for Papyri to start
  #[arg(long, global = true, value_name = "SECONDS", default_value_t = 0.0)]
  pub(crate) wait: f64,
  #[command(subcommand)]
  pub(crate) command: CtlCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum CtlCommand {
  /// Check whether Papyri is running
  Ping,
  /// Print the current document, tabs, view, and preferences
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
  Tab(TabArgs),
  /// Scroll a preview pane
  Scroll(ScrollArgs),
  /// Change document or interface zoom
  Zoom(ZoomArgs),
  /// Toggle or set fit-to-width
  FitWidth {
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
  Preferences(PreferencesArgs),
  /// Refresh the active document and explorer
  Refresh,
  /// Stream state events as newline-delimited JSON
  Watch(WatchArgs),
  /// Focus the main window
  Raise,
  /// Quit Papyri
  Quit,
  /// Send an arbitrary control method (advanced)
  Raw(RawArgs),
}

#[derive(Args, Debug)]
pub(crate) struct OpenArgs {
  #[arg(value_name = "PATH")]
  pub(crate) path: PathBuf,
  /// Scroll to an anchor after opening
  #[arg(long)]
  pub(crate) anchor: Option<String>,
  /// Open in the secondary split pane
  #[arg(long)]
  pub(crate) secondary: bool,
  /// Fail instead of launching Papyri when it is not running
  #[arg(long)]
  pub(crate) no_launch: bool,
  /// Seconds to wait for a launched window (default 30)
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
  /// Scroll to an absolute position
  To {
    #[arg(value_name = "Y", allow_hyphen_values = true)]
    y: f64,
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll by a relative amount
  By {
    #[arg(value_name = "DY", allow_hyphen_values = true)]
    dy: f64,
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the top
  Top {
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the bottom
  Bottom {
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
}

#[derive(Args, Debug)]
pub(crate) struct ZoomArgs {
  #[arg(value_enum)]
  pub(crate) action: ZoomAction,
  /// Percentage for `set`
  #[arg(value_name = "PERCENT")]
  pub(crate) value: Option<f64>,
  #[arg(long, value_enum, default_value_t = ZoomTarget::Document)]
  pub(crate) target: ZoomTarget,
}

#[derive(Args, Debug)]
pub(crate) struct ThemeArgs {
  #[arg(value_enum)]
  pub(crate) theme: ThemeArg,
}

#[derive(Args, Debug)]
pub(crate) struct PanelArgs {
  #[arg(value_enum)]
  pub(crate) name: PanelName,
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
  /// Event names to stream (default: all)
  #[arg(long, value_delimiter = ',')]
  pub(crate) events: Vec<String>,
  /// Do not print the initial state snapshot
  #[arg(long)]
  pub(crate) no_initial: bool,
}

#[derive(Args, Debug)]
pub(crate) struct RawArgs {
  #[arg(value_name = "METHOD")]
  pub(crate) method: String,
  /// JSON object with method parameters
  #[arg(value_name = "JSON", default_value = "{}")]
  pub(crate) params: String,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PaneArg {
  Main,
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
  In,
  Out,
  Reset,
  Set,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ZoomTarget {
  Document,
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
  Light,
  Dark,
  Toggle,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum PanelName {
  Sidebar,
  Outline,
  Settings,
  Palette,
  Search,
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
  On,
  Off,
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
