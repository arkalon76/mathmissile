# Engine requests from the shell

The shell (`web/`) runs on engine API v2 only (`engine/API.md`). The v1 adapter
and its items are gone. Open items:

1. **Portrait palette for avatar colour sets.** `portrait()` has no colour option,
   so the avatar colour sets (Sunset, Ocean, Forest, Candy) are a CSS `hue-rotate`
   on the portrait image (`web/js/ui/art.js`, `COLOR_FILTERS`). A
   `portrait(species, {colors: [c1, c2]})` option would let the engine draw them
   properly.
2. **Golden `graded` flag.** `summary.results` reports golden monsters with
   `graded: true`. The shell treats golden as extra (rewards only) and never lets it
   move SRS, so nothing breaks, but the flag should probably be `false` to match
   "golden, minis and engine-inserted copies are ungraded".
