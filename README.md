# Storybook 10.6.2: `RangeError: Invalid string length` on a large module graph

`storybook dev` prints "Storybook ready!", then the process dies after Vite's optimizer runs:

```
RangeError: Invalid string length
  at JSON.stringify
  at stringify2 (storybook/dist/_node-chunks/chunk-*.js)
  at ServerChannelTransport.send (storybook/dist/core-server/index.js)
```

## Cause

`ModuleGraphEngine` builds a reverse index (source file -> every story file reaching it, with BFS depth)
and applies it through the `core/module-graph-index` service's `_applyIndex` command. After every command,
`service-transport.ts` emits `services:patches` with the **full** state snapshot, and
`ServerChannelTransport.send` runs `stringify(event, {maxDepth: 15})` on it with no size guard. When the
index has `source files x stories` pairs in the millions, the JSON exceeds V8's ~512 MB string limit,
`JSON.stringify` throws inside a `setImmediate`, and the process exits.

`features.changeDetection: false` does not help: the index is still built and broadcast.

## Shape of the repro

`generate.mjs` mimics the real monorepo (~18.7k source files that every story transitively reaches):

| | default | env var |
|---|---|---|
| workspace packages | 40 | `PACKAGES` |
| source files per package | 467 (=> 18,680 total) | `MODULES_PER_PKG` |
| story files (in `apps/*` and `packages/*`) | 700 | `STORIES` |
| stories importing the root barrel (reach everything) | 85% | `ROOT_BARREL_RATIO` |

- Long package/app paths, as in the real repo, so each JSON pair is ~100+ bytes.
- Each module imports two earlier siblings, so dependency depths vary.
- Each package has an `index.js` barrel; `src/shared/index.js` re-exports all barrels.

Up to ~13M index pairs => well over 1 GB of JSON.

## Reproduce

```sh
pnpm install            # or npm install
node generate.mjs       # regenerates ./src (~19k files, ~77 MB)
NODE_OPTIONS=--max-old-space-size=16384 npm run storybook   # port 6008
```

Expected: crash with the stack above shortly after startup. The large heap is needed only so the index
itself can be built; the crash is the string limit, not heap exhaustion.

Not verified yet: the generator was written and run in a Linux sandbox, but `node_modules` was installed on
macOS (missing `oxc-resolver` linux binding), so Storybook was not started with this exact config. If it
does not crash, raise `STORIES` / `MODULES_PER_PKG`.

## Control

`npm install --save-dev storybook@10.4.6 @storybook/react-vite@10.4.6` (no module graph) starts fine on the
same project.

## Optional instrumentation

```sh
node instrument.mjs            # logs each index rebuild and its pair count
node instrument.mjs --revert
```
