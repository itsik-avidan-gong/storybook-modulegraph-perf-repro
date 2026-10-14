# Storybook 10.6.2: `RangeError: Invalid string length` on a large module graph

`storybook dev` prints "Storybook ready!", then the process dies:

```
RangeError: Invalid string length
  at JSON.stringify
  at stringify2 (storybook/dist/_node-chunks/chunk-*.js)
  at ServerChannelTransport.send (storybook/dist/core-server/index.js)
  at Immediate.handler
```

## Cause

`ModuleGraphEngine` builds a reverse index (source file -> every story file reaching it, with BFS depth)
and applies it through the `core/module-graph-index` service's `_applyIndex` command. After every
command, `service-transport.ts` emits `services:patches` with the **full** state snapshot, and
`ServerChannelTransport.send` runs `stringify(event, {maxDepth: 15})` on it with no size guard. When the
index has millions of `source file x story` pairs, the JSON exceeds V8's ~512 MB string limit,
`JSON.stringify` throws inside a `setImmediate`, and the process exits.

`features.changeDetection: false` does not help: the index is still built and broadcast.

## Scripts

| Command | What it does |
|---|---|
| `pnpm run generate` | Wipes and recreates `./src` (idempotent). |
| `pnpm run validate` | Estimates the index JSON size from `./src` without starting Storybook. Exit code 1 if too small. |
| `pnpm run storybook` | Starts the dev server on port 6008. |
| `pnpm run cleanup` | Removes `./src`, `storybook-static`, `unrelated.log`, and the `node_modules` caches. |

## Run it

```sh
pnpm install
pnpm run generate     # 18,700 modules in 50 groups, 1,000 stories, 2 barrel levels
pnpm run validate     # expect: estimated index JSON ~788MB (limit ~512MB), "OK"
pnpm run storybook    # expect: "Storybook ready!" then the crash above within seconds
```

To rerun from scratch: `pnpm run cleanup`, then repeat from `pnpm run generate`.

Expected result: the process exits with code 1 and the `RangeError` stack above, right after
"Storybook ready!" (reproduced on Node 24.21.0, Linux arm64, with 8 GB `--max-old-space-size`).

### Shape of the generated project

A single project (not a monorepo) that mimics the real one (~18.7k source files reached by many stories):

- `src/modules/feature-group-N/feature-module-N-I.js`: each module imports two earlier siblings, so
  dependency depths vary.
- Each group has an `index.js` barrel; `src/index.js` re-exports all group barrels.
- `src/stories/area-N/FeatureStoryN.stories.jsx`: 85% import the root barrel (and so reach every module);
  the rest import 1-3 group barrels.

Tunables (env vars): `MODULES` (18700), `STORIES` (1000), `GROUPS` (50), `ROOT_BARREL_RATIO` (0.85).
Index size is about `MODULES x STORIES x ratio x bytes per story path`; with shorter paths or fewer stories
it can drop below the limit (700 stories gives ~555 MB, too close), so check with `pnpm run validate`.

### Validate that it is this bug

- The stack ends in `ServerChannelTransport.send` -> `stringify2` -> `JSON.stringify` (not a heap OOM).
- `STORIES=100 pnpm run generate && pnpm run storybook` starts and stays up (index too small to hit the limit).
- Control: `pnpm install --save-dev storybook@10.4.6 @storybook/react-vite@10.4.6` (no module graph) runs the
  full-size project fine.

## Optional instrumentation

```sh
node instrument.mjs            # logs each index rebuild and its pair count
node instrument.mjs --revert
```
