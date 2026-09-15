# Inactive reference material

Nothing here is imported by the application. Files are preserved to make cleanup reversible; this is not a supported alternate application.

- `experiments/Workplane.js`: unused construction-plane tool.
- `experiments/arcResample.js`: alternate resampler; active cutting uses `src/hair/strandResample.js`.
- `experiments/guideBinding copy.js`: unused binder; active binding lives in `src/rendering/gpu/guideBinding.js`.
- `assets/lowPolyHead.glb`: alternate mesh; the app loads `public/models/head.glb`.

Experiment imports were updated for navigation, but experiments were not independently validated. See `docs/architecture.md` before reviving them.
