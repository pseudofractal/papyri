{
  description = "Papyri — a read-only Markdown, PDF, Typst, and LaTeX viewer";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
      forSystem = system:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;
          manifest = builtins.fromJSON (builtins.readFile ./package.json);
          source = lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let name = baseNameOf path; in
              !(builtins.elem name [ "node_modules" "target" "dist" ".git" ".agents" ".codex" ".aws" "test-results" "playwright-report" "gen" ])
              && !(lib.hasPrefix "result" name)
              && !(lib.hasPrefix ".env" name)
              && !(lib.hasSuffix ".keystore" name)
              && !(builtins.elem name [ "renderer.js" "renderer.css" "diagrams.js" "pdf.js" "pdf.css" "pdf-licenses" "pdf-resources" "pdf-resources.json" ]);
          };
          webSource = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json ./package-lock.json ./index.html ./vite.config.ts
              ./svelte.config.js ./tsconfig.json ./src ./scripts/build-renderer.mjs
              ./packaging/papyri.svg ./packaging/papyri-symbolic.svg
            ];
          };
          tauriDriver = pkgs.rustPlatform.buildRustPackage {
            pname = "tauri-driver";
            version = "2.1.0";
            src = pkgs.fetchCrate {
              pname = "tauri-driver";
              version = "2.1.0";
              sha256 = "sha256-Ttik3t/IUnze3SHcpH9zPS1UwW9B/V70Wvel+eBHhOE=";
            };
            cargoHash = "sha256-x7cz2KLNLJRlPqahV/BwyYJcncfUyhIp6/gORhvudZI=";
            meta = {
              description = "WebDriver server for Tauri applications";
              homepage = "https://tauri.app";
              license = with lib.licenses; [ asl20 mit ];
              mainProgram = "tauri-driver";
            };
          };
          web = pkgs.buildNpmPackage {
            pname = "papyri-web";
            version = manifest.version;
            src = webSource;
            nodejs = pkgs.nodejs_24;
            npmDepsHash = "sha256-zV5t6mJs//jdSbkJGctiuvZ4us/OM1gjwQ+Gsvr3Loo=";
            npmFlags = [ "--ignore-scripts" ];
            installPhase = ''
              runHook preInstall
              mkdir -p $out/dist
              cp -r dist/. $out/dist/
              runHook postInstall
            '';
          };
          nativeLibraries = with pkgs; [ glib gtk3 gdk-pixbuf cairo pango atk dbus webkitgtk_4_1 libsoup_3 openssl librsvg stdenv.cc.cc.lib ];
          desktop = pkgs.rustPlatform.buildRustPackage {
            pname = "papyri";
            version = manifest.version;
            src = lib.cleanSourceWith {
              src = ./src-tauri;
              filter = path: type: !(builtins.elem (baseNameOf path) [ "target" "gen" ]);
            };
            cargoLock.lockFile = ./src-tauri/Cargo.lock;
            buildFeatures = [ "custom-protocol" ];
            nativeBuildInputs = with pkgs; [ pkg-config wrapGAppsHook3 rustfmt desktop-file-utils ];
            buildInputs = nativeLibraries;
            PAPYRI_TYPST_BINARY = "${pkgs.typst}/bin/typst";
            PAPYRI_BWRAP_BINARY = "${pkgs.bubblewrap}/bin/bwrap";
            PAPYRI_PRLIMIT_BINARY = "${pkgs.util-linux}/bin/prlimit";
            postPatch = ''
              substituteInPlace tauri.conf.json --replace-fail '"../dist"' '"${web}/dist"'
            '';
            preCheck = "cargo fmt --all --check";
            postInstall = ''
              install -Dm644 ${./packaging/papyri.desktop} $out/share/applications/papyri.desktop
              substituteInPlace $out/share/applications/papyri.desktop \
                --replace-fail 'Exec=papyri %f' "Exec=$out/bin/papyri %f" \
                --replace-fail 'TryExec=papyri' "TryExec=$out/bin/papyri"
              desktop-file-validate $out/share/applications/papyri.desktop
              install -Dm644 ${./packaging/papyri.svg} $out/share/icons/hicolor/scalable/apps/papyri.svg
              install -Dm644 ${./packaging/papyri-symbolic.svg} $out/share/icons/hicolor/scalable/apps/papyri-symbolic.svg
              for size in 32 64 128; do
                install -Dm644 icons/''${size}x''${size}.png $out/share/icons/hicolor/''${size}x''${size}/apps/papyri.png
              done
              install -Dm644 icons/128x128@2x.png $out/share/icons/hicolor/256x256/apps/papyri.png
              install -Dm644 icons/icon.png $out/share/icons/hicolor/512x512/apps/papyri.png
            '';
            meta = { description = "Read-only Markdown, PDF, Typst, and LaTeX viewer"; homepage = "https://github.com/pseudofractal/papyri"; license = lib.licenses.mit; platforms = systems; mainProgram = "papyri"; };
          };
          quality = web.overrideAttrs (old: {
            pname = "papyri-quality";
            src = source;
            nativeBuildInputs = (old.nativeBuildInputs or []) ++ [ pkgs.git ];
            buildPhase = ''
              runHook preBuild
              npm run check
              npm test
              npm run lint
              runHook postBuild
            '';
            installPhase = "mkdir -p $out; touch $out/passed";
          });
          packagingSource = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./packaging ./scripts/build-icons.mjs ./scripts/check-release.mjs
              ./package.json ./package-lock.json ./src-tauri/Cargo.toml
              ./src-tauri/tauri.conf.json ./src-tauri/icons
            ];
          };
          packaging = pkgs.runCommand "papyri-packaging-check" {
            nativeBuildInputs = with pkgs; [ nodejs_24 librsvg desktop-file-utils ];
          } ''
            cp -r ${packagingSource} source
            cd source
            node scripts/build-icons.mjs --check
            node scripts/check-release.mjs v${manifest.version}
            if node scripts/check-release.mjs v-invalid >/dev/null 2>&1; then
              echo "Mismatched release tag was accepted" >&2
              exit 1
            fi
            desktop-file-validate packaging/papyri.desktop
            touch $out
          '';
        in { inherit pkgs web desktop nativeLibraries quality packaging tauriDriver; };
    in {
      packages = eachSystem (system: let p = forSystem system; in { default = p.desktop; papyri = p.desktop; web = p.web; tauri-driver = p.tauriDriver; });
      apps = eachSystem (system: { default = { type = "app"; meta.description = "Open Markdown, PDF, Typst, LaTeX, or a directory"; program = "${self.packages.${system}.default}/bin/papyri"; }; });
      checks = eachSystem (system: let p = forSystem system; in { inherit (p) web quality packaging; linux = p.desktop; });
      devShells = eachSystem (system: let p = forSystem system; in { default = p.pkgs.mkShell {
        packages = with p.pkgs; [ nodejs_24 rustc cargo rustfmt clippy pkg-config chromium prefetch-npm-deps python3 xvfb-run librsvg desktop-file-utils typst bubblewrap util-linux xdotool p.tauriDriver ];
        PAPYRI_TYPST_BINARY = "${p.pkgs.typst}/bin/typst";
        PAPYRI_BWRAP_BINARY = "${p.pkgs.bubblewrap}/bin/bwrap";
        PAPYRI_PRLIMIT_BINARY = "${p.pkgs.util-linux}/bin/prlimit";
        buildInputs = p.nativeLibraries;
        LD_LIBRARY_PATH = p.pkgs.lib.makeLibraryPath p.nativeLibraries;
        PLAYWRIGHT_CHROMIUM_EXECUTABLE = "${p.pkgs.chromium}/bin/chromium";
        shellHook = ''
          export PATH="$PWD/node_modules/.bin:$PATH"
          echo "papyri: npm ci; npm run dev (web) or npm run tauri dev (native)"
          echo "native smoke: PAPYRI_BINARY=... ./scripts/native-smoke.sh"
        '';
      }; });
      nixosModules.default = { config, lib, pkgs, ... }: {
        options.programs.papyri.enable = lib.mkEnableOption "the papyri document viewer";
        config = lib.mkIf config.programs.papyri.enable { environment.systemPackages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.default ]; };
      };
    };
}
