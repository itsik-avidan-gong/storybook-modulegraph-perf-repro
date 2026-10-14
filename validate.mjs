// Estimates the size of the module-graph index JSON for the generated ./src, without starting
// Storybook: walks each story's transitive imports, counts story->source pairs, and sums the
// bytes of the story paths. Compare with V8's max string length (~512MB).
// usage: node validate.mjs   (run `node generate.mjs` first)
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

const LIMIT_MB = 512
const SRC = join(import.meta.dirname, 'src')
const walk = dir =>
  readdirSync(dir, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
const files = walk(SRC)
const imports = new Map()
const importsOf = file => {
  if (!imports.has(file)) {
    const text = readFileSync(file, 'utf8')
    imports.set(file, [...text.matchAll(/from '([^']+)'/g)].map(m => join(file, '..', m[1])))
  }
  return imports.get(file)
}

let pairs = 0
let bytes = 0
const stories = files.filter(f => f.endsWith('.stories.jsx'))
for (const story of stories) {
  const seen = new Set()
  const queue = [story]
  while (queue.length) {
    for (const dep of importsOf(queue.pop())) {
      if (!seen.has(dep)) {
        seen.add(dep)
        queue.push(dep)
      }
    }
  }
  pairs += seen.size
  bytes += seen.size * (story.length - SRC.length + 6)
}

const mb = bytes / 1e6
console.log(`${files.length} files, ${stories.length} stories, ${pairs} index pairs`)
console.log(`estimated index JSON: ~${mb.toFixed(0)}MB (limit ~${LIMIT_MB}MB)`)
console.log(mb > LIMIT_MB ? 'OK: should exceed the string limit' : 'TOO SMALL: raise STORIES or MODULES')
process.exit(mb > LIMIT_MB ? 0 : 1)
