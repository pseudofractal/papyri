# App icon

Papyri uses logo study **14: Reed on paper**, a papyrus stem inside a rounded page. Its canonical source is [`packaging/papyri-symbolic.svg`](../../packaging/papyri-symbolic.svg). It has a transparent background and uses `currentColor`, so the interface can recolor it with the selected accent.

- The header and empty state use the source as a CSS mask and inherit text color.
- The favicon, Linux window, and desktop launcher use a generated neutral dark tile with a light mark, independent of the app accent.
- Tauri embeds the generated PNG and reapplies it after webview creation.
- Nix installs scalable icons and 32, 64, 128, 256, and 512 px PNGs in the hicolor icon theme. Desktop themes can recolor `papyri-symbolic` themselves.

Regenerate and check icons with the locked environment:

```sh
nix develop -c npm run icons
nix develop -c node scripts/build-icons.mjs --check
```

The script uses librsvg from the flake. Commit the canonical source, generated `packaging/papyri.svg`, and `src-tauri/icons/*.png` together. The flake rejects stale generated assets.

## Application identity

The executable, desktop entry, flake package, and NixOS option are `papyri` / `programs.papyri.enable`, with no alternate names. The application identifier is `io.github.pseudofractal.papyri`; preferences use `papyri.preferences`. This application identity starts with a fresh preference store.

The repository is [pseudofractal/papyri](https://github.com/pseudofractal/papyri).

The [Papyri studies](papyri-logos/index.html), [earlier name directions](brand-directions/index.html), [original icon options](logo-samples/index.html), [cat bookmark](cat-bookmark.html), and [bracket study](brackets.html) remain as design history.
