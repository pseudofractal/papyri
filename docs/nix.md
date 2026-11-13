# Configuration and Nix

Papyri stores interactive preferences, recent folders, and explorer navigation in the host WebView's local storage. On Linux, WebKit normally keeps this under `~/.local/share/io.github.pseudofractal.papyri/` (or the corresponding `XDG_DATA_HOME`); browser cookies and downloaded tools are also application data under that directory. Cache data uses `XDG_CACHE_HOME`. Browser builds use the browser's own storage. Nix and non-Nix installations use the same locations.

Native Papyri also reads a JSON object from `$XDG_CONFIG_HOME/papyri/config.json` (default `~/.config/papyri/config.json`) at startup. If absent, it searches `papyri/config.json` in `XDG_CONFIG_DIRS`, defaulting to `/etc/xdg`. The first file wins; files are not merged. Its preferences override saved interactive preferences at startup. The file is never modified by Papyri; changes to configured settings in the app last for the current session; other preferences are saved in WebView storage. Restart to apply changes to the file. A malformed file or unsupported preference is reported in the app.

Supported keys match `papyri ctl preferences get`: `theme` (`mocha` or `latte`), `network`, `documentZoom`, `pdfZoom`, `fitWidth`, `uiZoom`, `sidebarWidth`, `browserWidth`, `browserUrl`, `paletteWidth`, `paletteHeight`, `paletteMaxWidth`, `paletteMaxHeight`, `logWidth`, `logHeight`, `uiFont`, `textFont`, `codeFont`, `mathFont`, `delimiters`, `typstPath`, `latexEngine`, `latexPaths`, and `languageServerPaths`. The two path objects accept partial values; for example `languageServerPaths` accepts `markdown`, `typst`, and `latex`. Executable paths should include the binary name. Delimiters are objects with `left`, `right`, and boolean `display` fields.

## Home Manager

Add this flake as an input, then import `inputs.papyri.homeManagerModules.default` in your Home Manager configuration:

```nix
{ pkgs, ... }: {
  programs.papyri = {
    enable = true;
    settings = {
      theme = "mocha";
      languageServerPaths.typst = "${pkgs.tinymist}/bin/tinymist";
      languageServerPaths.markdown = "${pkgs.marksman}/bin/marksman";
      languageServerPaths.latex = "${pkgs.texlab}/bin/texlab";
      typstPath = "${pkgs.typst}/bin/typst";
      latexPaths.lualatex = "${pkgs.texliveMedium}/bin/lualatex";
    };
  };
}
```

`programs.papyri.package` selects a different package. The module installs it and generates the user config when settings are nonempty. Managing the same path independently causes a Home Manager conflict.

## NixOS without Home Manager

Import `inputs.papyri.nixosModules.default`, then set `programs.papyri.enable` and `programs.papyri.settings` as above. The module installs the package system-wide and writes `/etc/xdg/papyri/config.json`; a user configuration takes precedence.

## Other Nix setups

Install `papyri.packages.<system>.default` with a profile or include it in your own package set. Generate the JSON file using Nix's `builtins.toJSON` or `pkgs.formats.json`, or write it manually. Non-Nix installations use the same JSON format. Do not put secrets in Nix-generated configuration: the Nix store is world-readable.
