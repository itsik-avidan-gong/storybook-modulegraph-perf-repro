// Patches a console.log into Storybook's `reverseIndexToStoriesByFile`
// so each rebuild of the module-graph reverse index announces itself and its
// size.
//
// Run `npm install` to remove the patch.
//
// usage: node instrument.mjs [--revert]
import {readdirSync, readFileSync, writeFileSync} from 'node:fs'

const DIR = 'node_modules/storybook/dist/_node-chunks'
const ANCHOR = 'function reverseIndexToStoriesByFile(index, workingDir) {'

// The chunk filename is a build hash and changes between Storybook releases.
// Find the file by content instead of hardcoding it.
const candidates = readdirSync(DIR)
  .filter(f => f.endsWith('.js'))
  .filter(f => readFileSync(`${DIR}/${f}`, 'utf8').includes(ANCHOR))

if (candidates.length !== 1) {
  console.error(
    `expected exactly one chunk defining reverseIndexToStoriesByFile, found ${candidates.length}`,
  )
  process.exit(1)
}
const file = `${DIR}/${candidates[0]}`

const PRISTINE = `${ANCHOR}
  let result = {};
  for (let [dep, stories] of index)
    result[toStoryIndexPath(dep, workingDir)] = Object.fromEntries(
      Array.from(stories, ([storyFile, depth]) => [toStoryIndexPath(storyFile, workingDir), depth])
    );
  return result;
}`

const INSTRUMENTED = `${ANCHOR}
  let result = {}, __pairs = 0, __t0 = process.hrtime.bigint();
  for (let [dep, stories] of index)
    result[toStoryIndexPath(dep, workingDir)] = Object.fromEntries(
      Array.from(stories, ([storyFile, depth]) => (__pairs++, [toStoryIndexPath(storyFile, workingDir), depth]))
    );
  console.log(\`[repro] REBUILT storiesByFile: \${__pairs} pairs in \${Number(process.hrtime.bigint() - __t0) / 1e6}ms\`);
  return result;
}`

const revert = process.argv.includes('--revert')
const from = revert ? INSTRUMENTED : PRISTINE
const to = revert ? PRISTINE : INSTRUMENTED

const src = readFileSync(file, 'utf8')
const count = src.split(from).length - 1
if (count !== 1) {
  console.error(
    `expected exactly 1 match in ${file}, found ${count} ` +
      `(already ${revert ? 'reverted' : 'instrumented'}, or the source shape changed in this Storybook version)`,
  )
  process.exit(1)
}

writeFileSync(file, src.replace(from, to))
console.log(`${revert ? 'reverted' : 'instrumented'} ${file}`)
