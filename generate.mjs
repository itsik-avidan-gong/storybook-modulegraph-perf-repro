// Generates a synthetic monorepo-like project that mimics the shape of a large project:
//   - PACKAGES workspace packages, each with MODULES_PER_PKG source files, long paths, and an
//     index.js barrel that re-exports them all (PACKAGES * MODULES_PER_PKG ~= 18.7k source files)
//   - modules import siblings, forming dependency chains (BFS depths > 1)
//   - a root barrel (src/shared/index.js) re-exporting every package barrel
//   - STORIES story files spread over apps/ and packages/; most import the root barrel, so they
//     transitively reach nearly every source file, the rest import only a few package barrels
// The module-graph reverse index (source file -> story files) therefore has roughly
// 18.7k keys * ~STORIES values, whose JSON exceeds V8's max string length (~512MB).
import {mkdirSync, writeFileSync, rmSync} from 'node:fs'

const PACKAGES = Number(process.env.PACKAGES ?? 40)
const MODULES_PER_PKG = Number(process.env.MODULES_PER_PKG ?? 467)
const STORIES = Number(process.env.STORIES ?? 700)
const ROOT_BARREL_RATIO = Number(process.env.ROOT_BARREL_RATIO ?? 0.85)

// deterministic PRNG so the generated project is stable between runs
let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const SUBDIRS = ['components', 'hooks', 'utils', 'models']
const pkgName = p => `custom-package-${p}`
const modPath = (p, i) =>
  `packages/${pkgName(p)}/src/${SUBDIRS[i % SUBDIRS.length]}/feature-module-${i}.js`

rmSync('src', {recursive: true, force: true})
const write = (file, content) => {
  const path = `src/${file}`
  mkdirSync(path.slice(0, path.lastIndexOf('/')), {recursive: true})
  writeFileSync(path, content)
}
// relative import specifier from one src-relative file to another
const rel = (from, to) => {
  const f = from.split('/').slice(0, -1)
  const t = to.split('/')
  while (f.length && t.length > 1 && f[0] === t[0]) (f.shift(), t.shift())
  return (f.length ? '../'.repeat(f.length) : './') + t.join('/')
}

for (let p = 0; p < PACKAGES; p++) {
  const barrel = []
  for (let i = 0; i < MODULES_PER_PKG; i++) {
    const file = modPath(p, i)
    const imports = []
    // chain to up to two earlier siblings => dependency depth grows along the package
    for (const back of [1, 7]) {
      if (i - back >= 0) {
        imports.push(`import {value_${p}_${i - back}} from '${rel(file, modPath(p, i - back))}'`)
      }
    }
    const sum = [i, ...imports.map((_, k) => `value_${p}_${i - [1, 7][k]}`)].join(' + ')
    write(file, `${imports.join('\n')}\nexport const value_${p}_${i} = ${sum}\n`)
    barrel.push(`export * from '${rel(`packages/${pkgName(p)}/src/index.js`, file)}'`)
  }
  write(`packages/${pkgName(p)}/src/index.js`, barrel.join('\n') + '\n')
}

write(
  'shared/index.js',
  Array.from(
    {length: PACKAGES},
    (_, p) => `export * from '${rel('shared/index.js', `packages/${pkgName(p)}/src/index.js`)}'`,
  ).join('\n') + '\n',
)

for (let s = 0; s < STORIES; s++) {
  const inApp = s % 3 !== 0
  const dir = inApp
    ? `apps/revenue-intelligence-application-${s % 20}/src/features/forecasting/components`
    : `packages/${pkgName(s % PACKAGES)}/src/stories`
  const file = `${dir}/feature${s}.stories.jsx`
  let importLines
  if (rand() < ROOT_BARREL_RATIO) {
    importLines = `import {value_0_0} from '${rel(file, 'shared/index.js')}'\n`
  } else {
    const picked = [0, 1, 2].map(() => Math.floor(rand() * PACKAGES))
    importLines = [...new Set(picked)]
      .map(p => `import {value_${p}_0} from '${rel(file, `packages/${pkgName(p)}/src/index.js`)}'`)
      .join('\n') + '\n'
  }
  write(
    file,
    importLines +
      `export default {title: 'Generated/${inApp ? 'Apps' : 'Packages'}/Panel${s}', component: () => <div>panel ${s}</div>}\n` +
      `export const Default = {}\n`,
  )
}

const files = PACKAGES * MODULES_PER_PKG
console.log(
  `generated ${STORIES} stories, ${files} source files => up to ~${((files * STORIES) / 1e6).toFixed(1)}M index pairs`,
)
