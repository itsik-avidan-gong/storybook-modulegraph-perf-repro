# Storybook 10.5 module-graph perf reproduction

Minimal, self-generating reproduction for a performance regression introduced in
`storybook` 10.5: the `ModuleGraphEngine` rebuilds and broadcasts the **entire**
module-graph reverse index on **every** file-watcher event, including events for
files it has never heard of.

Filed against `storybook` 10.5.5; also present on `next` at time of writing.
`vite` is pinned to 8.1.5 and is not involved.

## What it demonstrates

Two separate defects:

1. **Unconditional rebuild.** `ModuleGraphEngine.mirrorUpdate()` computes the
   precise delta (`bumpedStoryFiles`) and then re-serializes the whole index
   anyway. `handleFileChange()` also discards `IncrementalPatcher.patch()`'s
   return, which already knows the dependency set was unchanged.
2. **Unrelated files trigger the same work.** A file absent from the graph skips
   the change check entirely, so writing a log file costs as much as editing a
   story.

## Setup

```sh
npm install
node generate.mjs        # writes src/
git init && git add -A && git commit -m init
```

`git init` matters: without a git repo Storybook reports
`Change detection unavailable: not a git repository`. The module graph is still
built either way, but a git repo matches real-world usage.

Optionally, make the cause self-announcing:

```sh
node instrument.mjs      # logs each index rebuild and its size
node instrument.mjs --revert
```

This only adds a `console.log`; the CPU cost is measurable without it. Re-run
after any `npm install`, which restores the pristine dist.

## Reproduce

```sh
npm run storybook        # port 6008, no browser needed
```

Wait for startup to finish, then note the dev-server process's cumulative CPU
(`ps -o time= -p <pid>`), and:

```sh
echo "" >> src/stories/Comp0.stories.jsx    # a real source edit
echo "noise" >> unrelated.log               # a file the graph has never seen
```

Check the CPU delta after each. Both cost the same.

Measured here (400 stories x 1200 modules => 480,800 index pairs, node 22,
macOS arm64, 16 cores):

```
story save:           2.66s CPU, 1 rebuild
story save:           2.65s CPU, 1 rebuild
unrelated .log write: 2.53s CPU, 1 rebuild
unrelated .log write: 2.52s CPU, 1 rebuild
```

## Scaling

Cost tracks the reverse index's **pair count** (roughly stories x shared deps),
not the number of files. Both knobs are env vars:

```sh
STORIES=800 MODULES=2500 node generate.mjs   # ~2M pairs
```

| project | files | index pairs | CPU per save |
| --- | --- | --- | --- |
| this repro, defaults | 1,601 | 480,800 | 2.6s |
| a real ~37k-file app | ~37,000 | 3,267,696 | 13.8s |

Roughly linear in pairs. On that real app the same save costs **1.2s** on
storybook 10.4.6 versus **13.8s** on 10.5.5, an ~11.5x regression.

## Measurement notes

Two things that mislead if you measure them instead of process CPU time:

- **`Vite hmr update` log lines.** The count is identical on 10.4.6 and 10.5.5.
  The HMR loop did not change; only the cost per iteration did.
- **Wall clock.** Too dependent on what else the machine is doing. Use
  `ps -o time=` on the dev-server process.

No browser needs to be attached. The work happens on the watcher event,
independent of any connected client.

Beware of background writers inside the project directory while measuring
(lint caches, coverage output, editor temp files, AI coding agents). Because of
defect 2 above, each of their writes adds a full rebuild to your numbers. That
contamination is what made my own first measurements ~2.5x too high.
