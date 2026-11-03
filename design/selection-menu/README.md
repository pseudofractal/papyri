# Selection menu directions

Five static concepts for the Markdown selection menu. Open `samples.html` for the full sheet.

| Option | Direction             | Best for                                                  |
| ------ | --------------------- | --------------------------------------------------------- |
| A      | Compact list          | Lowest-risk polish; keeps current muscle memory           |
| B      | Action pad            | Discoverability; shows the selected text and copy choices |
| C      | Selection toolbar     | Speed; copy/quote actions close to the selection          |
| D      | Context card + flyout | Explaining actions and nesting send targets               |
| E      | Command menu          | Keyboard-first users; searchable actions                  |

Screens are in `screens/` at 2000 px wide (2× capture).

## Implemented

The app now uses **B · Action pad**. The preview renders the selected fragment as Markdown (including KaTeX), and hovering or focusing the **Source** control swaps it to the enclosing Markdown block source; clicking the control pins the source view. Screens: `screens/implemented-action-pad-rendered.png`, `screens/implemented-action-pad-source.png`, and `screens/implemented-action-pad-native.png`.
