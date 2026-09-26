# Design Brief: Haircut Technical View

Date: 2026-09-18. Scope v2. Implementation recovered and frozen; historical core evidence exists, full TV-1 acceptance pending review. See README handover. Evaluation loop added at the user's request; feature scope unchanged.

Implementation must follow the [visual evaluation loop](EVALUATION.md): capture screenshots after each completed build cycle and have an independent critic agent grade the evidence, then correct and recheck affected results.

## Problem

Barbers and stylists need to inspect a finished or nearly finished haircut's construction: its planes, profiles, and overall shape. They need a clear way to examine the result once happy with it, without grooming controls competing for attention.

## Solution

A dedicated **Technical view** opens on the current haircut. One inspectable viewport presents the head like a buildable object, accompanied by compact boxed controls and a clear **Return to grooming** action.

The slice has three core capabilities:

1. Illustrated rendering on white, with toon shading, sharp outlines and optional plane delineation.
2. Free orbit and axis-aligned orthographic camera presets.
3. A movable cutaway plane that clips both head and hair.

Content is the actual current head and haircut. View labels and control values describe real presentation state; invented measurements or instructional steps are not used.

## Experience Principles

1. **Construction clarity over visual realism.** Clear silhouettes and section controls reveal shape.
2. **Focused inspection over simultaneous comparison.** One viewport switches between views instead of multiplying them.
3. **Precision carries the humor.** Matter-of-fact labels treat the head like a furniture product while controls stay understandable.

## Aesthetic Direction

- **Philosophy:** Illustrated technical manual for a constructed haircut.
- **Tone:** Humorous, inventive, buildable, and dry.
- **Reference points:** IKEA instruction graphics, LEGO assembly illustrations, exploded technical drawings, the user's MoMA boxed-control reference, and Rhino 8 Technical/Pen modes as visual direction rather than feature parity.
- **Proposed anti-references:** Photorealistic salon marketing, cartoon characters, and dense diagnostic dashboards.
- **Required treatment:** White background, toon shading, sharp outlines; plane delineation can be switched on when wanted.
- **Typography/layout default:** Restrained readable system typography, strong box borders and generous white space. Humor belongs in sparse product-like framing, not ambiguous control labels.

Local references: `docs/reference/UIUX_References/`. The design agent inspected five local images. `MoMA.txt` points to MoMA UnBoxing; its exact visual panel treatment was not verified from the extracted web page and should be inspected before claiming a visual match.

## Existing Patterns

- **Typography:** System monospace in the current HUD/log; no custom font loading discovered.
- **Colors:** Dark presentation with muted gray-blue readouts; no authored color-token system discovered.
- **Spacing:** Inline pixel values; no shared spacing scale discovered.
- **Components:** Full-screen Three.js viewport, lil-gui control folders, and custom debug log. No separate component library discovered.
- **Integration:** Preserve application-owned tool arbitration, history callbacks, authored stores and growth preview behavior. Extend the existing application without introducing a framework solely for this slice.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| Technical view entry/return | New | Open on current haircut; clearly return to grooming |
| Single viewport | Modify | Support a dedicated presentation mode |
| Illustrated treatment | New | White, toon shading, sharp outlines, optional plane delineation |
| Camera controls | New | Labeled axis-aligned orthographic presets and free orbit |
| Cutaway controls | New | On/off, axis selector, position slider, Flip side |
| Compact boxed panel | New | Group controls using existing application actions |

## Key Interactions

- **Enter:** Show the current haircut with the technical treatment. Suspend grooming gestures during inspection. Cutaway starts off, showing the complete object.
- **Orbit:** Inspect freely with the mouse using familiar camera behavior.
- **Camera preset:** Snap to a labeled axis-aligned orthographic view. Reflect the selected view in controls; orbiting away updates that indication. Front, side and top are the core view vocabulary; opposite directions are a reasonable implementation default.
- **Enable cutaway:** Start with a vertical plane dividing the head into left and right halves.
- **Adjust:** Axis selects plane orientation, position moves the plane, and Flip side swaps the hidden half-space. Clip both head and hair consistently.
- **Disable cutaway:** Restore the complete visible object.
- **Plane delineation:** Offer optional surface-plane edges without making them necessary to read the silhouette. Exact edge selection is an implementation detail to verify visually.
- **Return:** Restore the ordinary simulator presentation and interactions.

Acceptance requires the three core capabilities to work together on the actual haircut. Mode entry, camera changes, clipping and return must preserve authored groom data and undo history. Presentation-only rendering changes are allowed; changes to geometry, solvers, persistent schemas or grooming behavior are outside scope. Inspection settings are transient presentation state.

Verify white/toon/outline legibility, camera presets, all clipping axes and both sides, clipping off, and repeated mode transitions in the browser. Run repository build/tests and report known failures separately. Browser regression checks must cover ordinary grooming, undo/redo and save/load; build and Node results alone cannot establish visual or pointer correctness.

## Responsive Behavior

Desktop mouse and keyboard are the agreed target. Maintain one viewport. Proposed narrow-desktop behavior: a narrower, scrollable panel with the return action still accessible, leaving room to inspect the model. Touch-specific behavior is deferred.

## Accessibility Requirements

- Native labeled buttons, selects and range inputs; logical keyboard order and visible focus.
- Normal text contrast at least 4.5:1; large text and essential control boundaries at least 3:1.
- Expose active view and toggle states programmatically and without relying on color alone.
- Provide an accessible slider value and keyboard adjustment. Position is a relative view control, not a physical measurement.
- Focus the inspection controls on entry and return focus to the entry action on exit.
- Camera presets must work without mouse input; provide readable orbit instructions.

## Out of Scope

- Grooming edits within Technical view.
- Recreating the cut, procedural steps or inferred cutting sequences.
- Dimensions and angle measurements.
- Image export or external document composition in this first slice.
- Simultaneous synchronized views and growth-stage grids.
- Simulator geometry, solver, serialization or history changes.
- Guaranteed solid caps on cut surfaces or a specified hidden-line algorithm.
- Mobile-specific interactions.

Exploded thin slices arranged along a horizontal axis are a **feasibility stretch only**, after the core works. They are not an acceptance requirement.
