// Generates a synthetic project whose module-graph reverse index has roughly
// STORIES * MODULES entries.
import {mkdirSync, writeFileSync, rmSync} from 'node:fs'

const STORIES = Number(process.env.STORIES ?? 400)
const MODULES = Number(process.env.MODULES ?? 1200)

rmSync('src', {recursive: true, force: true})
mkdirSync('src/shared', {recursive: true})
mkdirSync('src/stories', {recursive: true})

for (let i = 0; i < MODULES; i++) {
  writeFileSync(
    `src/shared/mod${i}.js`,
    `export const mod${i} = ${i}\nexport const label${i} = 'module ${i}'\n`,
  )
}

// A barrel file that every story imports, to make each story transitively depend
// on all modules.
writeFileSync(
  'src/shared/index.js',
  Array.from({length: MODULES}, (_, i) => `export * from './mod${i}.js'`).join('\n') + '\n',
)

for (let i = 0; i < STORIES; i++) {
  writeFileSync(
    `src/stories/Comp${i}.stories.jsx`,
    `import {mod0} from '../shared/index.js'\n` +
      `export default {title: 'Generated/Comp${i}', component: () => <div>{mod0}</div>}\n` +
      `export const Default = {}\n`,
  )
}

console.log(`generated ${STORIES} stories x ${MODULES} modules => ~${(STORIES * MODULES / 1e6).toFixed(2)}M expected index pairs`)
