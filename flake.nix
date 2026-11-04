{
  description = "Rasen - AI-native system for spec-driven development";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, nixpkgs, rust-overlay }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f system);
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };
          inherit (pkgs) lib;
          cargoVendor = pkgs.rustPlatform.importCargoLock {
            lockFile = ./native/linux-process-authority/Cargo.lock;
          };
          rustToolchainSource = pkgs.rust-bin.stable."1.88.0".minimal;
          # rust-overlay's combined toolchain is a symlink tree. The native
          # authority build intentionally rejects symlinked compiler inputs,
          # so materialize a self-contained sysroot whose binaries are exact
          # regular files without weakening that boundary.
          rustToolchain = pkgs.runCommand "rust-toolchain-1.88.0-exact" {
            nativeBuildInputs = [ pkgs.makeWrapper ];
          } ''
            mkdir -p "$out"
            cp -RL "${rustToolchainSource}/." "$out/"
            # rustc's upstream RUNPATH still locates rustc_driver in the
            # overlay component store. Force sysroot discovery back to this
            # materialized tree for both direct calls and Cargo subprocesses.
            chmod u+w "$out/bin" "$out/bin/cargo" "$out/bin/rustc"
            wrapProgram "$out/bin/cargo" \
              --add-flags '--offline' \
              --add-flags '--config=source.crates-io.replace-with=\"vendored-sources\"' \
              --add-flags '--config=source.vendored-sources.directory=\"${cargoVendor}\"'
            wrapProgram "$out/bin/rustc" --add-flags "--sysroot $out"
          '';
        in
        {
          default = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "rasen";
            version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

            src = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions [
                ./src
                ./bin
                ./schemas
                ./scripts
                ./native
                ./test
                ./package.json
                ./pnpm-lock.yaml
                ./tsconfig.json
                ./build.js
                ./rust-toolchain.toml
                ./vitest.config.ts
                ./vitest.setup.ts
                ./eslint.config.js
              ];
            };

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              pnpm = pkgs.pnpm_9;
              fetcherVersion = 3;
              hash = "sha256-unul1t4aewBcjYL89zZZStumdct08znWPqNhFWYw7E4=";
            };

            nativeBuildInputs = with pkgs; [
              nodejs_20
              npmHooks.npmInstallHook
              pnpmConfigHook
              pnpm_9
              rustToolchain
              which
            ];

            buildPhase = ''
              runHook preBuild

              # stdenv injects these toolchain selectors. Rasen's reproducible
              # authority builders deliberately reject inherited overrides and
              # resolve their pinned tools themselves.
              unset AR CC CXX LD
              pnpm run build

              runHook postBuild
            '';

            dontNpmPrune = true;

            meta = with pkgs.lib; {
              description = "AI-native system for spec-driven development";
              homepage = "https://github.com/DumoeDss/rasen";
              license = licenses.mit;
              maintainers = [ ];
              mainProgram = "rasen";
            };
          });
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/rasen";
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_20
              pnpm_9
              cargo
              rustc
            ];

            shellHook = ''
              echo "Rasen development environment"
              echo "Node version: $(node --version)"
              echo "pnpm version: $(pnpm --version)"
              echo "Run 'pnpm install' to install dependencies"
            '';
          };
        }
      );
    };
}
