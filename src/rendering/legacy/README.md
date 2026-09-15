# Comparison renderers

`gpuHair.js` + `hairShader.js` implement R2's per-facet GPU shapes. `strands.js` implements straight CPU strands using LineSegments2.

The factory still exposes `kind: 'gpu'` and `kind: 'cpu'`. The application selects `kind: 'guides'`, implemented in the sibling `gpu/` directory. Comparison paths remain statically bundled and do not support every guide-based feature.
