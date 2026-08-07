# Storybook 10.5 module-graph perf reproduction

A reproduction for a performance regression introduced in `storybook` 10.5. The `ModuleGraphEngine` rebuilds and broadcasts the entire module-graph reverse index on every file-watcher event.

## Problems demonstrated

1. **Unconditional rebuilds:** `ModuleGraphEngine.mirrorUpdate()` computes the delta of changed files (`bumpedStoryFiles`). But it then re-serializes the whole index anyway. `handleFileChange()` also discards `IncrementalPatcher.patch()`'s return, which already knows the dependency set was unchanged.
2. **Unrelated files trigger the rebuild:** A file absent from the graph skips the change check entirely, so writing a log file costs as much as editing a story.

## Setup

```sh
npm install
```

Optionally, instrument the cause:

```sh
node instrument.mjs      # logs each index rebuild and its size
node instrument.mjs --revert
```

## Reproduce

```sh
npm run storybook        # port 6008, no browser needed
```

Wait for startup to finish. Then note the dev-server process's cumulative CPU
(`ps -o time= -p <pid>`), and:

```sh
echo "" >> src/stories/Comp0.stories.jsx    # a real source edit
echo "noise" >> unrelated.log               # a file the graph has never seen
```

Check the CPU delta after each. Both cost the same.

Measured here (400 stories x 1200 modules => 480,800 index pairs, node 22, macOS arm64, 16 cores):

```
story save:           ~2.66s CPU, 1 rebuild
unrelated .log write: ~2.53s CPU, 1 rebuild
```

## Confirming it's a 10.5 regression

Downgrade Storybook, leaving everything else alone:

```sh
npm install --save-dev storybook@10.4.6 @storybook/react-vite@10.4.6
```

Re-run the same two tests. The cost disappears:

```
                      10.5.5    10.4.6
story save:           ~2.74s     ~0.18s
unrelated .log write: ~2.71s     ~0.01s
```

## Scaling

The performance gets worse with a larger module graph. If it's useful to see how performance degrades with module graph size, one can generate a larger repro with the `generate` script:

```sh
STORIES=2200 MODULES=1500 node generate.mjs
```

(Performance cost also seems to depend on module graph _topology_, but I left that out of this repro for simplicity. I can expand more for ya if it's actually useful data.)
