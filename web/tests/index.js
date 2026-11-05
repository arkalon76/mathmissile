// Entry for `node --test web/tests/` (Node treats a directory argument as a
// module and loads this file). Imports every *.test.mjs next to it.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, f)).href);
}
