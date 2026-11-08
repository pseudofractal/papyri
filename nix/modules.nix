{ self }:
let
  common = { lib, pkgs, ... }: {
    options.programs.papyri = {
      enable = lib.mkEnableOption "Papyri";
      package = lib.mkOption {
        type = lib.types.package;
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        defaultText = lib.literalExpression "inputs.papyri.packages.\${pkgs.stdenv.hostPlatform.system}.default";
        description = "Papyri package to install.";
      };
      settings = lib.mkOption {
        type = lib.types.attrsOf (pkgs.formats.json { }).type;
        default = { };
        example = lib.literalExpression ''{ theme = "latte"; languageServerPaths.typst = "''${pkgs.tinymist}/bin/tinymist"; }'';
        description = "Papyri preference overrides, applied when the application starts. See docs/nix.md for supported keys.";
      };
    };
  };
in {
  homeManager = { config, lib, pkgs, ... }: {
    imports = [ common ];
    config = lib.mkIf config.programs.papyri.enable {
      home.packages = [ config.programs.papyri.package ];
      xdg.configFile."papyri/config.json" = lib.mkIf (config.programs.papyri.settings != { }) {
        source = (pkgs.formats.json { }).generate "papyri-config.json" config.programs.papyri.settings;
      };
    };
  };
  nixos = { config, lib, pkgs, ... }: {
    imports = [ common ];
    config = lib.mkIf config.programs.papyri.enable {
      environment.systemPackages = [ config.programs.papyri.package ];
      environment.etc."xdg/papyri/config.json" = lib.mkIf (config.programs.papyri.settings != { }) {
        source = (pkgs.formats.json { }).generate "papyri-config.json" config.programs.papyri.settings;
      };
    };
  };
}
