#!/bin/sh
cd $(git rev-parse --show-toplevel)
rm -rf dist
npx ncc build -m src/index.mjs
cat mstopn.js dist/index.mjs > dist/mstopn.mjs
chmod +x dist/mstopn.mjs
