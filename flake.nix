{
  description = "mdview — a local, read-only Markdown viewer";
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
              && !(builtins.elem name [ "renderer.js" "renderer.css" "diagrams.js" ]);
          };
          webSource = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json ./package-lock.json ./index.html ./vite.config.ts
              ./svelte.config.js ./tsconfig.json ./src ./scripts/build-renderer.mjs
              ./packaging/mdview.svg ./packaging/mdview-symbolic.svg
            ];
          };
          web = pkgs.buildNpmPackage {
            pname = "mdview-web";
            version = manifest.version;
            src = webSource;
            nodejs = pkgs.nodejs_24;
            npmDepsHash = "sha256-UI0dh94AkukyujSgHnidttSRWsK6H7x9ks0ityqDUoA=";
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
            pname = "mdview";
            version = manifest.version;
            src = lib.cleanSourceWith {
              src = ./src-tauri;
              filter = path: type: !(builtins.elem (baseNameOf path) [ "target" "gen" ]);
            };
            cargoLock.lockFile = ./src-tauri/Cargo.lock;
            buildFeatures = [ "custom-protocol" ];
            nativeBuildInputs = with pkgs; [ pkg-config wrapGAppsHook3 rustfmt desktop-file-utils ];
            buildInputs = nativeLibraries;
            postPatch = ''
              substituteInPlace tauri.conf.json --replace-fail '"../dist"' '"${web}/dist"'
            '';
            preCheck = "cargo fmt --all --check";
            postInstall = ''
              install -Dm644 ${./packaging/mdview.desktop} $out/share/applications/mdview.desktop
              substituteInPlace $out/share/applications/mdview.desktop \
                --replace-fail 'Exec=mdview %f' "Exec=$out/bin/mdview %f" \
                --replace-fail 'TryExec=mdview' "TryExec=$out/bin/mdview"
              desktop-file-validate $out/share/applications/mdview.desktop
              install -Dm644 ${./packaging/mdview.svg} $out/share/icons/hicolor/scalable/apps/mdview.svg
              install -Dm644 ${./packaging/mdview-symbolic.svg} $out/share/icons/hicolor/scalable/apps/mdview-symbolic.svg
              for size in 32 64 128; do
                install -Dm644 icons/''${size}x''${size}.png $out/share/icons/hicolor/''${size}x''${size}/apps/mdview.png
              done
              install -Dm644 icons/128x128@2x.png $out/share/icons/hicolor/256x256/apps/mdview.png
              install -Dm644 icons/icon.png $out/share/icons/hicolor/512x512/apps/mdview.png
            '';
            meta = { description = "Local, read-only Markdown viewer"; homepage = "https://github.com/pseudofractal/mdview"; license = lib.licenses.mit; platforms = systems; mainProgram = "mdview"; };
          };
          quality = web.overrideAttrs (_: {
            pname = "mdview-quality";
            src = source;
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
          packaging = pkgs.runCommand "mdview-packaging-check" {
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
            desktop-file-validate packaging/mdview.desktop
            touch $out
          '';
        in { inherit pkgs web desktop nativeLibraries quality packaging; };
    in {
      packages = eachSystem (system: let p = forSystem system; in { default = p.desktop; mdview = p.desktop; web = p.web; });
      apps = eachSystem (system: { default = { type = "app"; meta.description = "Open Markdown documents or a directory"; program = "${self.packages.${system}.default}/bin/mdview"; }; });
      checks = eachSystem (system: let p = forSystem system; in { inherit (p) web quality packaging; linux = p.desktop; });
      devShells = eachSystem (system: let p = forSystem system; in { default = p.pkgs.mkShell {
        packages = with p.pkgs; [ nodejs_24 rustc cargo rustfmt clippy pkg-config chromium prefetch-npm-deps python3 xvfb-run librsvg desktop-file-utils ];
        buildInputs = p.nativeLibraries;
        LD_LIBRARY_PATH = p.pkgs.lib.makeLibraryPath p.nativeLibraries;
        PLAYWRIGHT_CHROMIUM_EXECUTABLE = "${p.pkgs.chromium}/bin/chromium";
        shellHook = ''
          export PATH="$PWD/node_modules/.bin:$PATH"
          echo "mdview: npm ci; npm run dev (web) or npm run tauri dev (native)"
        '';
      }; });
      nixosModules.default = { config, lib, pkgs, ... }: {
        options.programs.mdview.enable = lib.mkEnableOption "the mdview Markdown viewer";
        config = lib.mkIf config.programs.mdview.enable { environment.systemPackages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.default ]; };
      };
    };
}
