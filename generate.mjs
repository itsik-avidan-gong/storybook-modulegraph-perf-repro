// Generates a single-project (non-monorepo) layout that reproduces
// `RangeError: Invalid string length` in Storybook 10.5+/10.6.2.
//
// The module-graph reverse index maps every source file to every story file that reaches it.
// Its JSON snapshot is broadcast over the channel, and fails once it exceeds V8's ~512MB string
// limit. Size ~= MODULES * (stories reaching each module) * (bytes per story path).
//
// Defaults mirror the real repo: ~18.7k source files, 700 stories, long story paths
// => ~13M index pairs, ~1GB of JSON.
//
// usage: node generate.mjs   (idempotent: wipes and recreates ./src; see cleanup.mjs)
import {mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {posix, join} from 'node:path'

const MODULES = Number(process.env.MODULES ?? 18700)
const STORIES = Number(process.env.STORIES ?? 700)
const GROUPS = Number(process.env.GROUPS ?? 50)
// share of stories that import the root barrel (so they reach every module); the rest import
// only a few group barrels
const ROOT_BARREL_RATIO = Number(process.env.ROOT_BARREL_RATIO ?? 0.85)

const SRC = join(import.meta.dirname, 'src')

// deterministic PRNG so every run generates the same project
let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const perGroup = Math.ceil(MODULES / GROUPS)
const groupName = g => `conversation-intelligence-feature-group-${g}`
const modulePath = (g, i) => `modules/${groupName(g)}/feature-module-${g}-${i}.js`
const groupBarrel = g => `modules/${groupName(g)}/index.js`
const STORY_AREAS = 20
const storyPath = s =>
  `stories/revenue-intelligence-area-${s % STORY_AREAS}/ForecastingDashboardPanel${s}.stories.jsx`

const write = (file, content) => {
  const path = join(SRC, file)
  mkdirSync(posix.dirname(path), {recursive: true})
  writeFileSync(path, content)
}
const importPath = (from, to) => {
  const r = posix.relative(posix.dirname(from), to)
  return r.startsWith('.') ? r : `./${r}`
}

rmSync(SRC, {recursive: true, force: true})

let created = 0
for (let g = 0; g < GROUPS && created < MODULES; g++) {
  const barrel = []
  for (let i = 0; i < perGroup && created < MODULES; i++, created++) {
    const file = modulePath(g, i)
    // chain to earlier siblings so BFS depths vary
    const deps = [1, 7].filter(back => i - back >= 0).map(back => i - back)
    const imports = deps.map(
      d => `import {value_${g}_${d}} from '${importPath(file, modulePath(g, d))}'`,
    )
    const sum = [i, ...deps.map(d => `value_${g}_${d}`)].join(' + ')
    write(file, `${imports.join('\n')}${imports.length ? '\n' : ''}export const value_${g}_${i} = ${sum}\n`)
    barrel.push(`export * from '${importPath(groupBarrel(g), file)}'`)
  }
  write(groupBarrel(g), barrel.join('\n') + '\n')
}

const usedGroups = Math.ceil(created / perGroup)
write(
  'index.js',
  Array.from(
    {length: usedGroups},
    (_, g) => `export * from '${importPath('index.js', groupBarrel(g))}'`,
  ).join('\n') + '\n',
)

for (let s = 0; s < STORIES; s++) {
  const file = storyPath(s)
  let imports
  if (rand() < ROOT_BARREL_RATIO) {
    imports = `import {value_0_0} from '${importPath(file, 'index.js')}'\n`
  } else {
    const groups = new Set([0, 1, 2].map(() => Math.floor(rand() * usedGroups)))
    imports =
      [...groups]
        .map(g => `import {value_${g}_0} from '${importPath(file, groupBarrel(g))}'`)
        .join('\n') + '\n'
  }
  write(
    file,
    imports +
      `export default {title: 'Generated/Area${s % STORY_AREAS}/Panel${s}', component: () => <div>panel ${s}</div>}\n` +
      `export const Default = {}\n`,
  )
}

console.log(
  `generated ${created} modules in ${usedGroups} groups + ${STORIES} stories => up to ~${((created * STORIES) / 1e6).toFixed(1)}M index pairs`,
)
