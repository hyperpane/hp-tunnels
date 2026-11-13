#!/bin/sh
# An author's helper: installs this plugin's dependencies and checks it.
# It builds nothing: the app runs the package from its TypeScript sources,
# and a plugin without npm dependencies needs none of this to run.
#
#   ./build.sh               install, type-check, validate plugin.json
#   ./build.sh --test        and run the tests (node --test test/)
#   ./build.sh --no-install  only check
#   ./build.sh --quiet       print only problems
#
# The SDK (types, tests) comes from $HYPERPANE_SDK (a .tgz), the hyperpane
# repo this is in, the app's resources, or else the release.

set -eu
cd "$(dirname "$0")"

install=1
tests=0
quiet=0
for arg in "$@"; do
  case "$arg" in
    --no-install) install=0 ;;
    --test) tests=1 ;;
    --quiet) quiet=1 ;;
    *) echo "Unknown option: $arg (use --test, --no-install, --quiet)" >&2; exit 2 ;;
  esac
done

say() { [ "$quiet" = 1 ] || echo "$@"; }
npm_quiet() { if [ "$quiet" = 1 ]; then npm "$@" --silent; else npm "$@"; fi; }

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node 24 or newer, with npm, is needed. Install it with one of:" >&2
  echo "  brew install node@24" >&2
  echo "  winget install OpenJS.NodeJS.LTS" >&2
  echo "  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 24" >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 24 ]; then
  echo "Node $(node --version) is too old: plugins need Node 24 or newer (brew install node@24, or fnm install 24)." >&2
  exit 1
fi

version=0.1.5
sdk_tgz() {
  if [ -n "${HYPERPANE_SDK:-}" ]; then echo "$HYPERPANE_SDK"; return; fi
  for f in \
    ../../../sdk/js/dist/pack/hyperpane-sdk-$version.tgz \
    ../../sdk/js/dist/pack/hyperpane-sdk-$version.tgz \
    /Applications/hyperpane.app/Contents/Resources/sdk/hyperpane-sdk-$version.tgz \
    "$HOME/Applications/hyperpane.app/Contents/Resources/sdk/hyperpane-sdk-$version.tgz" \
    /opt/hyperpane/resources/sdk/hyperpane-sdk-$version.tgz; do
    if [ -f "$f" ]; then echo "$f"; return; fi
  done
  mkdir -p node_modules/.cache
  f=node_modules/.cache/hyperpane-sdk-$version.tgz
  if [ ! -f "$f" ]; then
    curl -fsSL -o "$f" "https://github.com/astralyxdev/hyperpane/releases/download/v$version/hyperpane-sdk-$version.tgz" || {
      echo "Couldn't find the SDK: set HYPERPANE_SDK to hyperpane-sdk-$version.tgz (it comes with the app, in its resources/sdk)." >&2
      rm -f "$f"
      exit 1
    }
  fi
  echo "$f"
}

if [ "$install" = 1 ]; then
  if [ -f package.json ]; then
    say "Dev tools (npm install)"
    npm_quiet install --ignore-scripts --no-audit --no-fund
  fi
  tgz=$(sdk_tgz)
  say "SDK: $tgz"
  rm -rf node_modules/@hyperpane/sdk
  mkdir -p node_modules/@hyperpane/sdk
  tar -xzf "$tgz" -C node_modules/@hyperpane/sdk --strip-components=1
  for part in server client; do
    if [ -f "src/$part/package.json" ]; then
      say "src/$part (npm install --omit=dev --omit=optional --ignore-scripts)"
      (cd "src/$part" && npm_quiet install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund)
    fi
  done
fi

if [ ! -x node_modules/.bin/tsc ]; then
  echo "TypeScript isn't installed here: run ./build.sh without --no-install." >&2
  exit 1
fi
status=0
for part in server client; do
  if [ -f "src/$part/tsconfig.json" ]; then
    say "tsc --noEmit -p src/$part"
    node_modules/.bin/tsc --noEmit -p "src/$part" || status=1
  fi
done
say "plugin.json"
if [ "$quiet" = 1 ]; then
  node node_modules/@hyperpane/sdk/manifest/cli.js check . --quiet || status=1
else
  node node_modules/@hyperpane/sdk/manifest/cli.js check . || status=1
fi
if [ "$tests" = 1 ] && [ -d test ]; then
  say "node --test"
  # shellcheck disable=SC2046
  node --import ./node_modules/@hyperpane/sdk/register.mjs --test $(find test -name '*.test.ts' -o -name '*.test.mjs' -o -name '*.test.js' | sort) || status=1
fi
exit $status
