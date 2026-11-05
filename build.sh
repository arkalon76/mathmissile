#!/usr/bin/env bash
# Math Missile build helper.
#   ./build.sh build   release wasm into web/pkg (runs wasm-opt if installed)
#   ./build.sh dev     debug wasm (faster compile, slower game)
#   ./build.sh test    cargo test for the pure engine logic
#   ./build.sh serve   static server for web/ on http://localhost:${PORT:-8080}
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"

# wasm-pack writes a web/pkg/.gitignore containing "*" (and with packing, a README
# and package.json). The site ships web/pkg as-is, so keep only the .js and .wasm.
clean_pkg() {
  rm -f web/pkg/.gitignore web/pkg/README.md web/pkg/package.json web/pkg/LICENSE*
}

cmd="${1:-build}"
case "$cmd" in
  build)
    (cd engine && wasm-pack build --release --target web --out-dir ../web/pkg --no-typescript --no-pack)
    clean_pkg
    wasm="web/pkg/mathmissile_engine_bg.wasm"
    if command -v wasm-opt >/dev/null 2>&1; then
      wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
        "$wasm" -o "$wasm.opt" && mv "$wasm.opt" "$wasm"
      echo "wasm-opt applied"
    else
      echo "wasm-opt not found; skipping (brew install binaryen to enable)"
    fi
    ls -l "$wasm"
    ;;
  dev)
    (cd engine && wasm-pack build --dev --target web --out-dir ../web/pkg --no-typescript --no-pack)
    clean_pkg
    ;;
  test)
    (cd engine && cargo test)
    ;;
  serve)
    port="${PORT:-8080}"
    echo "Serving web/ on http://localhost:$port"
    cd web && exec python3 -m http.server "$port" --bind 127.0.0.1
    ;;
  *)
    echo "usage: $0 {build|dev|test|serve}" >&2
    exit 1
    ;;
esac
