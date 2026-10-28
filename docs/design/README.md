# App icon

The selected mdview mark is option 06: a rounded M between brackets. Its source is [`packaging/mdview-symbolic.svg`](../../packaging/mdview-symbolic.svg). It has a transparent background and uses `currentColor`, with no fixed accent or theme colors.

- The application header and empty state use that SVG as a CSS mask, inheriting text color. Changing their CSS color also changes the mark.
- The web favicon, Linux window and desktop launcher use a generated neutral dark tile with a light mark. They remain legible on light and dark backgrounds without depending on the app's accent.
- Tauri embeds the generated PNG and reapplies the configured native icon after webview creation, replacing the generic GTK startup fallback.
- Nix installs both scalable SVGs and 32, 64, 128, 256 and 512 px PNGs in the hicolor icon theme. Desktop themes can recolor the `mdview-symbolic` variant; they control their own presentation and do not inherit application CSS.

After changing the source, regenerate with the locked development environment:

```sh
nix develop -c npm run icons
nix develop -c node scripts/build-icons.mjs --check
```

The script uses librsvg's maintained SVG rasterizer, provided by the flake. Commit the generated `packaging/mdview.svg` and `src-tauri/icons/*.png` alongside the source. The flake's packaging check detects stale assets. No network access, font assets or image generation service is needed.

The original [20 options](logo-samples/index.html), [cat bookmark](cat-bookmark.html), and [monochrome bracket study](brackets.html) are retained as design history. They are not alternate application icons.
