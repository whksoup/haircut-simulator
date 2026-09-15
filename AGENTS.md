# Working in this repository

## Orientation

Read `README.md` and `docs/architecture.md` first. The current diagram is `docs/architecture.mermaid`; `docs/file-map.md` maps the former flat layout. Historical plans and `archive/` are reference material, not instructions or active implementation.

## Task routing

- Wiring, tool arbitration, restore callbacks: `src/app/main.js`.
- Controls: `src/app/ui.js`; undo mechanics: `src/app/history.js`.
- Persistent data and migrations: `src/groom/`.
- Geometry, constraints, cutting, growth and audits: `src/hair/`.
- Active GPU buffers, shaders, guide weights: `src/rendering/gpu/`.
- Root sampling and renderer factory: `src/rendering/`.
- Head loading and facet topology: `src/scene/`.
- Pointer tools: `src/tools/`; inspection overlays: `src/debug/`.
- Regression coverage: `tests/`, with descriptive `*.test.mjs` names.

Keep new modules within these ownership groups. Prefer direct imports; avoid barrels, generic utils folders, or frameworks that hide dependencies. Keep comparison renderers isolated. Integrating an archived experiment should be an explicit design decision.

## Agent and documentation workflow

Use `docs/workflow.md` for role assignments, handoffs, checkpoints, and scope changes. Project roles in `.codex/agents/` include `builder` (bounded implementation with a proportionate test-first procedure), `seaming` (read-only contract review), `critic` (read-only grading of supplied evidence against a rubric), and `documentation` (three documentation layers), alongside the existing planner and architect.

For substantive implementation or multi-session work, the coordinator maintains `docs/status.md` and a relevant dated session entry, or assigns documentation as their single writer. Checkpoint meaningful findings, blockers, scope changes, pauses and completion; do not wait for a stable build. Small isolated edits need no new session file. Read status and linked notes when resuming a track, not every historical journal.

Builders report source, verification evidence, integration needs and documentation implications. Review cross-system contracts with seaming when warranted; corrections remain with the implementer. Use agents selectively rather than spawning every role for every task. Scope revisions must reach affected workers promptly; old reports, parked ideas and session memories do not override current user intent. Canonical docs describe accepted behavior; hypotheses and unfinished work remain in status/session notes.

## Contracts to preserve

- Guides and seams are authored state; topology, bindings, buffers and texture rows are derived.
- `GuideStore.copyFrom` and `SeamStore.copyFrom` preserve identity because tools hold references.
- Strand points use the normalized guide frame. Preserve root pinning and segment-length invariants; update length/tangent alongside shape when required.
- Comb edits rewrite guide rows without rebinding every strand. Guide/strand membership and seam changes may require rebinding.
- Seam edits go through the application's shared refresh/sync path.
- Exactly one pointer tool owns interaction; use application arbitration.
- History distinguishes guide-stroke patches from structural snapshots. Selection is not serialized haircut state.
- Growth phase preview must not mutate authored guides.
- Preserve JSON migrations. Consult schema constants in `groom.js` and `guides.js`, not obsolete header comments.

## Verification

From the repository root:

```sh
npm test
npm run build
```

Focused example: `node --test tests/growth.test.mjs`. Resolve fixtures/source from `import.meta.url`, not the caller's working directory.

Four test files already fail in this snapshot; see `docs/architecture.md`. Keep them discoverable and report failures honestly. Do not skip tests or weaken assertions to make organizational changes green.

For rendering/interaction changes, also check the browser: initial head/hair, select/add/remove, comb, cut, seams, undo/redo, save/load. Node tests and a build do not verify WebGL visuals or actual pointer behavior.

Inspect git status before editing and preserve existing uncommitted work. Separate organizational edits from solver, schema or interaction behavior changes. Update current documentation when ownership changes.

## Context policy

Default for all work in this repo, unless the active agent's own instructions say otherwise:

- Read required orientation documents and prefer the files explicitly referenced in the task. Read beyond them only when those files genuinely do not contain what you need.
- Targeted filename and symbol searches are allowed to locate relevant files.
- Before opening a broad set of files, say which and why in one line.
- Ask when unresolved ambiguity affects task scope or intended behavior, rather than guessing.

Exempt: the architect and the advisor skill while active, which may explore freely. This exemption applies only to the context policy; all other repository instructions and contracts still apply.
