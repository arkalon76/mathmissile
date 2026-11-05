# Math Missile

A times-tables game for kids: type the answer, then swipe the monster that carries the sum.
Rust → WebAssembly engine with WebGL rendering, plain ES-module shell, no runtime dependencies.

- Play: https://arkalon76.github.io/mathmissile/
- `./build.sh build`: build the engine into `web/pkg/` (needs rustup, the wasm32 target, wasm-pack, binaryen)
- `./build.sh test`: engine tests; `node --test web/tests/index.js`: game-logic tests
- `make serve`: run locally at http://127.0.0.1:8080/

See `SPEC.md` for what we agreed to build and `DESIGN.md` for the game design.
Audio was generated once with ElevenLabs (`tools/gen_audio.mjs`); the game never calls it at runtime.
