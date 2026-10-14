// Removes everything the repro generates or caches, leaving config and scripts, so that
// `node generate.mjs` + `npm run storybook` can be re-run from scratch. Safe to run repeatedly.
// usage: node cleanup.mjs
import {rmSync, existsSync} from 'node:fs'
import {join} from 'node:path'

const TARGETS = ['src', 'storybook-static', 'unrelated.log', 'node_modules/.cache', 'node_modules/.vite']

for (const target of TARGETS) {
  const path = join(import.meta.dirname, target)
  if (existsSync(path)) {
    rmSync(path, {recursive: true, force: true})
    console.log(`removed ${target}`)
  }
}
