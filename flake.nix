{
  description = "Analog Canvas development and deployment environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};

      nodejs = pkgs.nodejs_24;
      pnpm = pkgs.pnpm_11;

      runtimePackages = [
        nodejs
        pnpm
        pkgs.chromium
        pkgs.git
      ];

      mkProjectCommand = {
        name,
        text,
        extraRuntimeInputs ? [],
      }:
        pkgs.writeShellApplication {
          inherit name text;
          runtimeInputs = runtimePackages ++ extraRuntimeInputs;
        };

      install = mkProjectCommand {
        name = "analog-canvas-install";
        text = ''
          pnpm install --frozen-lockfile "$@"
        '';
      };

      dev = mkProjectCommand {
        name = "analog-canvas-dev";
        text = ''
          pnpm dev "$@"
        '';
      };

      build = mkProjectCommand {
        name = "analog-canvas-build";
        text = ''
          pnpm build "$@"
        '';
      };

      check = mkProjectCommand {
        name = "analog-canvas-check";
        text = ''
          pnpm verify:branch "$@"
        '';
      };

      release = mkProjectCommand {
        name = "analog-canvas-release";
        text = ''
          pnpm release:package "$@"
        '';
      };

      deploy = mkProjectCommand {
        name = "analog-canvas-deploy";
        extraRuntimeInputs = [pkgs.curl];
        text = ''
          if [[ -z "''${CLOUDFLARE_API_TOKEN:-}" || -z "''${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
            echo "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set" >&2
            exit 1
          fi

          pnpm --filter @icm/editor... build
          pnpm dlx wrangler@4.120.1 deploy "$@"
        '';
      };
    in {
      devShells.default = pkgs.mkShell {
        packages =
          runtimePackages
          ++ [
            pkgs.curl
            pkgs.jq
          ];

        shellHook = ''
          export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
          echo "Analog Canvas environment: Node $(node --version), pnpm $(pnpm --version)"
          echo "Use: pnpm install --frozen-lockfile && pnpm dev"
        '';
      };

      apps = {
        install = flake-utils.lib.mkApp {drv = install;};
        dev = flake-utils.lib.mkApp {drv = dev;};
        build = flake-utils.lib.mkApp {drv = build;};
        check = flake-utils.lib.mkApp {drv = check;};
        release = flake-utils.lib.mkApp {drv = release;};
        deploy = flake-utils.lib.mkApp {drv = deploy;};
        default = flake-utils.lib.mkApp {drv = dev;};
      };

      formatter = pkgs.alejandra;
    });
}
