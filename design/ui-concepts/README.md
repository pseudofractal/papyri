# Papyri interface directions

Five static interface explorations sharing the same document fixture and side-panel states. These are design prototypes, not the application implementation.

Open `gallery.html` for an interactive review, or open any direction directly:

- `folio.html` — warm editorial
- `slate.html` — dark studio with a vertical side rail
- `halo.html` — floating glass cards
- `daylight.html` — clean light workspace
- `monograph.html` — editorial brutalist

## States

Append a query string to any direction:

- `?tab=chat` — document with the ChatGPT tab (default)
- `?tab=outline` — document with the outline tab
- `?tab=files` — document with the files tab
- `?tab=notes` — document with the notes tab
- `?modal=palette` — command palette over the files tab

Each page has working side-panel tabs and a palette overlay for review; the controls are intentionally mock interactions.

The `screens/` folder contains the five main document views and a fifteen-shot contact sheet at 1600 × 1000. The static pages are self-contained; the contact sheet is only for review.

## Shared direction

Every direction keeps the document first, replaces the 64 + 44 + 42 px chrome stack with a compact shell, and makes the right side a tabbed workspace for `Outline`, `ChatGPT`, `Files`, and `Notes`. The panel is the natural home for future tools such as history, references, translation, or a scratchpad.

## Folio v2

`folio-v2.html` is the realistic Catppuccin-only refinement of Folio. It includes the current app controls (command palette, open folder, theme, settings, explorer toggle, document search, split view, ChatGPT/browser, outline, zoom, fit width, trust, explorer actions, browser controls and status shortcuts), removes the duplicate Files tab from the right dock, and keeps the file explorer on the left.

States: `?theme=latte|mocha`, `?tab=outline|chat|notes`, `?search=1`, `?split=1`, `?panel=0`, `?sidebar=0`, `?modal=palette|settings`. The explorer and right dock also have working drag handles in the prototype.

Screens: `screens/v2-*.jpg` and `screens/folio-v2-contact-sheet.jpg`.

## Targeted shell mockup

`targeted-shell.html` is the targeted structural pass for the current Mocha app. It keeps the current visual language and content, then:

- combines the tab row and document actions into one line, with Copy raw replacing the zoom controls;
- removes the Jump to bar, top Open Folder, theme button, safe-preview control, and document breadcrumbs;
- moves document zoom to the bottom-right, with word count, character count and reading time before it;
- uses the bottom-left for local-folder/live-refresh information instead of read-only/Linux;
- makes the right panel a real column from the top edge to the bottom edge, so the one-line bar and status bar end at its left edge;
- keeps the explorer below the Papyri logo, with the path at the top and Open folder / Recent at the bottom;
- keeps the command palette unchanged.

States: `?panel=none|chat|outline|notes`, `?explorer=1`, `?split=1`, `?search=1`, plus `?tab=`. The explorer and right panel have working drag handles; Copy raw writes the active markdown source to the clipboard; the bottom zoom controls change the reading scale.
