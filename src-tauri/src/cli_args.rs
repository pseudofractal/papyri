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
  after_help = "Examples:\n  papyri notes.md\n  papyri --decorationless notes.md\n  papyri --log terminal notes.md\n  papyri ctl state --json\n  papyri ctl scroll by 400\n  papyri completions bash\n\nSee docs/control.md for the control protocol and editor integration examples."
)]
pub(crate) struct Cli {
  /// Document or directory to open. A running window receives this path.
  #[arg(value_name = "PATH")]
  pub(crate) path: Option<PathBuf>,
  /// Open in decoration-less reading mode
  #[arg(short = 'd', long)]
  pub(crate) decorationless: bool,
  /// Stream output to `terminal`, a file, or `cmd:<command>`
  #[arg(
    short = 'l',
    long,
    value_name = "TARGET",
    long_help = "Stream application output to TARGET.\n\nUse `terminal` (or `-`) to stay attached to the terminal, a file path to append to a file, or `cmd:<command>` to pipe both output streams through a shell command such as `cmd:wl-copy`.\n\nWhen launched from a terminal without `--log`, release builds detach and append to the default Papyri log file. Use `--log terminal` to stay in the foreground."
  )]
  pub(crate) log: Option<String>,
  #[command(subcommand)]
  pub(crate) command: Option<TopCommand>,
}

#[derive(Subcommand, Debug)]
pub(crate) enum TopCommand {
  /// Control a running Papyri window over its local socket
  #[command(
    long_about = "Control a running Papyri window over its local socket.\n\nCommands print a human-readable summary by default; `watch` always streams JSONL. Pass `--json` for one compact JSON object from other commands; runtime errors use the same JSON envelope. Use `--wait` to wait for the socket, or `ping --wait` to also wait for host readiness.",
    after_help = "Examples:\n  papyri ctl ping --wait 5\n  papyri ctl open notes.md --anchor intro\n  papyri ctl editor open\n  papyri ctl editor set --file draft.tex\n  papyri ctl explorer list\n  papyri ctl note set 'Check section 3'\n  papyri ctl browser navigate 'https://example.com'\n  papyri ctl tools status\n  papyri ctl tab next\n  papyri ctl scroll by 400\n  papyri ctl decorationless on\n  papyri ctl preferences set '{\"theme\":\"latte\"}'\n  papyri ctl watch --events state,headings,browser,selection\n\nSet PAPYRI_CONTROL_SOCKET or pass --socket to target another instance."
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
  /// Timeout for one control request in seconds (default: 60, or 3600 for tools)
  #[arg(
    long,
    global = true,
    value_name = "SECONDS",
    help_heading = "Connection"
  )]
  pub(crate) timeout: Option<f64>,
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
  /// Read, replace, save, reload, or reveal source text
  Editor(EditorArgs),
  /// Inspect or modify the explorer tree
  Explorer(ExplorerArgs),
  /// Read or write the active document's note
  Note(NoteArgs),
  /// Enable or disable scripts for the active Markdown document
  Trust {
    #[arg(value_enum, value_name = "ACTION")]
    action: Option<ToggleAction>,
  },
  /// Inspect, open, activate, or close context menus
  Menu(MenuArgs),
  /// Inspect or interact with DOM nodes in the main window
  Dom(DomArgs),
  /// Capture the screen, app webview, a DOM element, or a rectangle
  Screenshot(ScreenshotArgs),
  /// Inject mouse or keyboard input at screen coordinates
  Input(InputArgs),
  /// Read or write the system clipboard
  Clipboard(ClipboardArgs),
  /// List, focus, or capture native windows
  Window(WindowArgs),
  /// Wait for a selector, state value, or the app to become idle
  Wait(WaitArgs),
  /// Capture a short series of screen or app frames
  Record(RecordArgs),
  /// Select the right-panel tab
  Right {
    #[arg(value_enum, value_name = "TAB")]
    tab: RightTabArg,
  },
  /// Control the embedded web browser
  Browser(BrowserArgs),
  /// Set or step through the document search
  Search(SearchArgs),
  /// Unlock a password-protected PDF
  Pdf(PdfArgs),
  /// Show, hide, or toggle the live preview
  #[command(name = "live-preview")]
  LivePreview {
    #[arg(value_enum, value_name = "ACTION")]
    action: Option<ToggleAction>,
  },
  /// Zoom the live preview
  #[command(name = "live-preview-zoom")]
  LivePreviewZoom {
    #[arg(value_enum, value_name = "ACTION")]
    action: LivePreviewZoomAction,
  },
  /// Fit the live preview to the available width
  #[command(name = "live-preview-fit")]
  LivePreviewFit,
  /// Set the editor/live-preview split percentage
  #[command(name = "live-preview-split")]
  LivePreviewSplit {
    #[arg(value_name = "PERCENT")]
    percent: f64,
  },
  /// Read, set, clear, or copy the current preview selection
  Selection(SelectionArgs),
  /// Download or update managed tools and TeX Live
  Tools(ToolsArgs),
  /// Open settings, optionally on a specific tab
  Settings {
    #[arg(value_enum, value_name = "TAB")]
    tab: Option<SettingsTabArg>,
  },
  /// Copy or inspect the active document
  Document(DocumentArgs),
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
pub(crate) struct EditorArgs {
  #[command(subcommand)]
  pub(crate) command: EditorCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum EditorCommand {
  /// Open the source editor for the active document
  Open,
  /// Close the source editor, keeping the draft
  Close,
  /// Toggle the source editor
  Toggle,
  /// Save the active source draft
  Save,
  /// Reload the source from disk
  Reload {
    /// Discard unsaved changes without prompting
    #[arg(long)]
    force: bool,
  },
  /// Reload the source and discard unsaved changes
  Discard,
  /// Print the active source text and dirty state
  Get,
  /// Replace the active source text
  Set(TextInputArgs),
  /// Reveal a one-based line and column in the source editor
  Reveal {
    #[arg(value_name = "LINE")]
    line: u32,
    /// One-based column
    #[arg(long, default_value_t = 1, value_name = "COLUMN")]
    column: u32,
  },
  /// Reveal the current source position in the live preview
  Sync,
  /// Undo the last source edit
  Undo,
  /// Redo the next source edit
  Redo,
  /// Select the entire source document
  SelectAll,
  /// Select a zero-based character range
  Select {
    #[arg(value_name = "FROM")]
    from: u32,
    #[arg(value_name = "TO")]
    to: u32,
  },
  /// Copy the current source selection
  Copy,
  /// Cut the current source selection
  Cut,
  /// Paste the clipboard at the cursor or selection
  Paste,
  /// Print language-server diagnostics for the active source
  Diagnostics,
}

#[derive(Args, Debug)]
pub(crate) struct TextInputArgs {
  /// Text to write
  #[arg(value_name = "TEXT")]
  pub(crate) text: Option<String>,
  /// Read the text from a file
  #[arg(long, value_name = "PATH", conflicts_with = "stdin")]
  pub(crate) file: Option<PathBuf>,
  /// Read the text from standard input
  #[arg(long, conflicts_with_all = ["text", "file"])]
  pub(crate) stdin: bool,
}

#[derive(Args, Debug)]
pub(crate) struct ExplorerArgs {
  #[command(subcommand)]
  pub(crate) command: ExplorerCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ExplorerCommand {
  /// List a directory (defaults to the explorer's working directory)
  List {
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
  },
  /// Set the explorer's working directory
  Cwd {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Expand a folder and make it the working directory
  Expand {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Collapse a folder
  Collapse {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Select an explorer entry
  Select {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Print a file's current text (including unsaved drafts)
  Read {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Create a file or folder
  Create {
    /// Path of the new entry
    #[arg(value_name = "PATH")]
    path: PathBuf,
    /// Entry type; a matching extension is added when missing
    #[arg(long, value_enum, default_value_t = EntryKindArg::Markdown)]
    kind: EntryKindArg,
  },
  /// Rename a file or folder
  Rename {
    #[arg(value_name = "PATH")]
    path: PathBuf,
    #[arg(value_name = "NAME")]
    name: String,
  },
  /// Permanently delete a file
  Delete {
    #[arg(value_name = "PATH")]
    path: PathBuf,
    /// Confirm permanent deletion
    #[arg(long)]
    yes: bool,
  },
  /// Refresh the explorer tree
  Refresh,
}

#[derive(Args, Debug)]
pub(crate) struct NoteArgs {
  #[command(subcommand)]
  pub(crate) command: NoteCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum NoteCommand {
  /// Print the active document's note
  Get,
  /// Replace the active document's note
  Set(TextInputArgs),
  /// Clear the active document's note
  Clear,
}

#[derive(Args, Debug)]
pub(crate) struct MenuArgs {
  #[command(subcommand)]
  pub(crate) command: MenuCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum MenuCommand {
  /// Open the menu for an application, document, tab, file, or selection
  Open {
    #[arg(value_enum, value_name = "KIND")]
    kind: MenuTargetArg,
    /// Tab or file path for `tab` and `file` menus
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
    /// Horizontal position in CSS pixels
    #[arg(long, value_name = "X")]
    x: Option<f64>,
    /// Vertical position in CSS pixels
    #[arg(long, value_name = "Y")]
    y: Option<f64>,
    /// Treat a file-menu target as a folder
    #[arg(long)]
    directory: bool,
    /// Treat a file-menu target as a document
    #[arg(long)]
    document: bool,
  },
  /// Activate a menu entry by its zero-based index
  Activate {
    #[arg(value_name = "INDEX")]
    index: usize,
  },
  /// Close any open context menu or selection action pad
  Close,
  /// Print the open menu and its entries
  Get,
}

#[derive(Args, Debug)]
pub(crate) struct DomArgs {
  /// DOM surface to inspect (default: main)
  #[arg(long, global = true, value_enum, default_value_t = DomFrameArg::Main)]
  pub(crate) frame: DomFrameArg,
  #[command(subcommand)]
  pub(crate) command: DomCommand,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum DomFrameArg {
  Main,
  Preview,
  Browser,
}

impl DomFrameArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Main => "main",
      Self::Preview => "preview",
      Self::Browser => "browser",
    }
  }
}

#[derive(Subcommand, Debug)]
pub(crate) enum DomCommand {
  /// List matching DOM nodes with stable references
  Query {
    #[arg(value_name = "SELECTOR")]
    selector: Option<String>,
    /// Maximum nodes to return (1-1000)
    #[arg(long, value_name = "COUNT")]
    limit: Option<u32>,
    /// Include nodes with no visible box
    #[arg(long)]
    all: bool,
  },
  /// Print one node's text, HTML, attributes, and computed style
  Get {
    #[arg(value_name = "REF")]
    reference: String,
  },
  /// Focus a node
  Focus {
    #[arg(value_name = "REF")]
    reference: String,
  },
  /// Click a node
  Click {
    #[arg(value_name = "REF")]
    reference: String,
  },
  /// Set an input, textarea, select, or editable node's value
  Type {
    #[arg(value_name = "REF")]
    reference: String,
    #[command(flatten)]
    input: TextInputArgs,
  },
  /// Return a compact accessibility-style tree for the surface
  Ax,
}

#[derive(Args, Debug)]
pub(crate) struct ScreenshotArgs {
  /// PNG output path (defaults to the Papyri cache directory)
  #[arg(long, global = true, value_name = "PATH")]
  pub(crate) output: Option<PathBuf>,
  /// Copy the PNG to the system clipboard
  #[arg(long, global = true)]
  pub(crate) clipboard: bool,
  #[command(subcommand)]
  pub(crate) target: Option<ScreenshotTarget>,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ScreenshotTarget {
  /// Capture the entire compositor screen
  Screen,
  /// Capture the main app webview (excludes the native browser panel)
  App,
  /// Capture one DOM element
  Element {
    #[arg(value_name = "REF")]
    reference: Option<String>,
    /// CSS selector instead of a DOM reference
    #[arg(long, value_name = "SELECTOR", conflicts_with = "reference")]
    selector: Option<String>,
    /// DOM surface containing the element
    #[arg(long, value_enum, default_value_t = DomFrameArg::Main)]
    frame: DomFrameArg,
  },
  /// Capture an absolute screen rectangle in physical pixels
  Rect {
    #[arg(value_name = "X")]
    x: f64,
    #[arg(value_name = "Y")]
    y: f64,
    #[arg(value_name = "WIDTH")]
    width: f64,
    #[arg(value_name = "HEIGHT")]
    height: f64,
  },
}

#[derive(Args, Debug)]
pub(crate) struct InputArgs {
  #[command(subcommand)]
  pub(crate) command: InputCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum InputCommand {
  /// Move the pointer
  Move {
    #[arg(value_name = "X")]
    x: i32,
    #[arg(value_name = "Y")]
    y: i32,
  },
  /// Click at screen coordinates
  Click {
    #[arg(value_name = "X")]
    x: i32,
    #[arg(value_name = "Y")]
    y: i32,
    #[arg(long, value_enum, default_value_t = MouseButtonArg::Left)]
    button: MouseButtonArg,
    /// Number of clicks (1-3)
    #[arg(long, default_value_t = 1)]
    count: u8,
  },
  /// Drag from one screen position to another
  Drag {
    #[arg(value_name = "X")]
    x: i32,
    #[arg(value_name = "Y")]
    y: i32,
    #[arg(value_name = "TO_X")]
    to_x: i32,
    #[arg(value_name = "TO_Y")]
    to_y: i32,
    #[arg(long, value_enum, default_value_t = MouseButtonArg::Left)]
    button: MouseButtonArg,
  },
  /// Scroll at screen coordinates
  Scroll {
    #[arg(value_name = "X")]
    x: i32,
    #[arg(value_name = "Y")]
    y: i32,
    #[arg(long, default_value_t = 0)]
    dx: i32,
    #[arg(long, default_value_t = -3)]
    dy: i32,
  },
  /// Press a key combination such as ctrl+l or shift+tab
  Key {
    #[arg(value_name = "KEYS")]
    keys: String,
  },
  /// Type text into the focused control
  Type(TextInputArgs),
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum MouseButtonArg {
  Left,
  Middle,
  Right,
}

impl MouseButtonArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Left => "left",
      Self::Middle => "middle",
      Self::Right => "right",
    }
  }
}

#[derive(Args, Debug)]
pub(crate) struct ClipboardArgs {
  #[command(subcommand)]
  pub(crate) command: ClipboardCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ClipboardCommand {
  /// Print the clipboard text
  Get,
  /// Replace the clipboard text
  Set(TextInputArgs),
  /// Save the clipboard image as PNG
  GetImage {
    #[arg(long, value_name = "PATH")]
    output: Option<PathBuf>,
  },
  /// Copy a PNG file to the clipboard
  SetImage {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
}

#[derive(Args, Debug)]
pub(crate) struct WindowArgs {
  #[command(subcommand)]
  pub(crate) command: WindowCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum WindowCommand {
  /// List native windows with ids, titles, geometry, and focus state
  List,
  /// Focus a native window
  Focus {
    #[arg(value_name = "ID")]
    id: String,
  },
  /// Capture a native window as PNG
  Capture {
    #[arg(value_name = "ID")]
    id: String,
    #[arg(long, value_name = "PATH")]
    output: Option<PathBuf>,
    #[arg(long)]
    clipboard: bool,
  },
}

#[derive(Args, Debug)]
pub(crate) struct WaitArgs {
  #[command(subcommand)]
  pub(crate) command: WaitCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum WaitCommand {
  /// Wait until no document/editor/tool/browser work is active
  Idle {
    #[arg(long, default_value_t = 30_000, value_name = "MILLISECONDS")]
    timeout_ms: u64,
  },
  /// Wait until a selector matches at least one node
  Selector {
    #[arg(value_name = "SELECTOR")]
    selector: String,
    #[arg(long, value_enum, default_value_t = DomFrameArg::Main)]
    frame: DomFrameArg,
    #[arg(long, default_value_t = 30_000, value_name = "MILLISECONDS")]
    timeout_ms: u64,
  },
  /// Wait until a dotted state path equals a JSON value
  State {
    #[arg(value_name = "PATH")]
    path: String,
    #[arg(value_name = "JSON")]
    equals: String,
    #[arg(long, default_value_t = 30_000, value_name = "MILLISECONDS")]
    timeout_ms: u64,
  },
}

#[derive(Args, Debug)]
pub(crate) struct RecordArgs {
  /// Directory for numbered frame PNGs
  #[arg(long, value_name = "DIR")]
  pub(crate) output_dir: PathBuf,
  /// Number of frames (1-300)
  #[arg(long, default_value_t = 10)]
  pub(crate) count: u32,
  /// Milliseconds between frames
  #[arg(long, default_value_t = 500, value_name = "MILLISECONDS")]
  pub(crate) interval_ms: u64,
  /// Capture surface
  #[arg(long, value_enum, default_value_t = RecordTarget::App)]
  pub(crate) target: RecordTarget,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum RecordTarget {
  Screen,
  App,
}

impl RecordTarget {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Screen => "screen",
      Self::App => "app",
    }
  }
}

#[derive(Args, Debug)]
pub(crate) struct BrowserArgs {
  #[command(subcommand)]
  pub(crate) command: BrowserCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum BrowserCommand {
  /// Navigate to an address, hostname, or search query
  Navigate {
    #[arg(value_name = "TARGET")]
    target: String,
  },
  /// Go back in browser history
  Back,
  /// Go forward in browser history
  Forward,
  /// Reload the current page
  Reload,
  /// Stop loading the current page
  Stop,
  /// Change the web page zoom
  Zoom {
    #[arg(value_enum, value_name = "ACTION")]
    action: BrowserZoomAction,
  },
  /// Open the current page in a separate browser window
  Window {
    #[arg(value_name = "URL")]
    url: Option<String>,
  },
  /// Send text to a site composer as a quote
  Quote {
    #[arg(value_name = "TEXT")]
    text: String,
    /// Site to receive the quote
    #[arg(long, value_enum, default_value_t = QuoteSiteArg::Chatgpt)]
    site: QuoteSiteArg,
  },
  /// Search Wikipedia for text
  Search {
    #[arg(value_name = "TEXT")]
    text: String,
  },
}

#[derive(Args, Debug)]
pub(crate) struct SearchArgs {
  /// Text to find (empty clears the search)
  #[arg(value_name = "QUERY")]
  pub(crate) query: Option<String>,
  /// Scroll to the next match
  #[arg(long, conflicts_with = "previous")]
  pub(crate) next: bool,
  /// Scroll to the previous match
  #[arg(long)]
  pub(crate) previous: bool,
}

#[derive(Args, Debug)]
pub(crate) struct PdfArgs {
  #[command(subcommand)]
  pub(crate) command: PdfCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum PdfCommand {
  /// Provide the password for a locked PDF
  Password {
    /// Password value; prefer --stdin on shared machines
    #[arg(value_name = "PASSWORD")]
    password: Option<String>,
    /// Read the password from standard input
    #[arg(long, conflicts_with = "password")]
    stdin: bool,
  },
}

#[derive(Args, Debug)]
pub(crate) struct SelectionArgs {
  #[command(subcommand)]
  pub(crate) command: Option<SelectionCommand>,
}

#[derive(Subcommand, Debug)]
pub(crate) enum SelectionCommand {
  /// Print the current preview selection
  Get,
  /// Copy the current preview selection
  Copy {
    #[arg(value_enum, default_value_t = SelectionKindArg::Source)]
    kind: SelectionKindArg,
  },
  /// Select the first visible occurrence of text in the preview
  Set {
    #[arg(value_name = "TEXT")]
    text: String,
  },
  /// Clear the preview selection
  Clear,
}

#[derive(Args, Debug)]
pub(crate) struct ToolsArgs {
  #[command(subcommand)]
  pub(crate) command: ToolsCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum ToolsCommand {
  /// Download or update managed tools
  Install {
    #[arg(value_enum, value_name = "TOOL", required = true)]
    names: Vec<ManagedToolArg>,
  },
  /// Install or update the managed TeX Live distribution
  Texlive {
    #[arg(value_enum, value_name = "ACTION")]
    action: TexliveActionArg,
  },
  /// Print managed tool status and configured paths
  Status,
}

#[derive(Args, Debug)]
pub(crate) struct DocumentArgs {
  #[command(subcommand)]
  pub(crate) command: DocumentCommand,
}

#[derive(Subcommand, Debug)]
pub(crate) enum DocumentCommand {
  /// Copy the active document's raw source
  CopyRaw,
  /// Print document statistics
  Stats,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum EntryKindArg {
  Folder,
  Markdown,
  Typst,
  Latex,
}

impl EntryKindArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Folder => "folder",
      Self::Markdown => "markdown",
      Self::Typst => "typst",
      Self::Latex => "latex",
    }
  }

  pub(crate) fn extension(self) -> &'static str {
    match self {
      Self::Folder => "",
      Self::Markdown => ".md",
      Self::Typst => ".typ",
      Self::Latex => ".tex",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum RightTabArg {
  Outline,
  Notes,
  Chatgpt,
  Wikipedia,
  Gemini,
}

impl RightTabArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Outline => "outline",
      Self::Notes => "notes",
      Self::Chatgpt => "chatgpt",
      Self::Wikipedia => "wikipedia",
      Self::Gemini => "gemini",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum BrowserZoomAction {
  In,
  Out,
  Reset,
}

impl BrowserZoomAction {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::In => "in",
      Self::Out => "out",
      Self::Reset => "reset",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum MenuTargetArg {
  App,
  Document,
  Tab,
  File,
  Selection,
}

impl MenuTargetArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::App => "app",
      Self::Document => "document",
      Self::Tab => "tab",
      Self::File => "file",
      Self::Selection => "selection",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum QuoteSiteArg {
  Chatgpt,
  Gemini,
}

impl QuoteSiteArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Chatgpt => "chatgpt",
      Self::Gemini => "gemini",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum SelectionKindArg {
  Source,
  Text,
  Quote,
}

impl SelectionKindArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Source => "source",
      Self::Text => "text",
      Self::Quote => "quote",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum ManagedToolArg {
  Marksman,
  Tinymist,
  Texlab,
  Typst,
}

impl ManagedToolArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Marksman => "marksman",
      Self::Tinymist => "tinymist",
      Self::Texlab => "texlab",
      Self::Typst => "typst",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum TexliveActionArg {
  Install,
  Update,
}

impl TexliveActionArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Install => "install",
      Self::Update => "update",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum LivePreviewZoomAction {
  In,
  Out,
  Reset,
}

impl LivePreviewZoomAction {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::In => "in",
      Self::Out => "out",
      Self::Reset => "reset",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub(crate) enum SettingsTabArg {
  Appearance,
  Reading,
  Documents,
  Compilers,
}

impl SettingsTabArg {
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Self::Appearance => "appearance",
      Self::Reading => "reading",
      Self::Documents => "documents",
      Self::Compilers => "compilers",
    }
  }
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
