/**
 * defaultGroom — the groom every visitor is greeted by.
 *
 *
 * WHY APPLYING IT IS CONDITIONAL.
 *
 * A guide is not portable. `root`, `normal` and `tangent` are coordinates in
 * ONE mesh's local space, and `facetId` indexes ONE catalogue. Point this groom
 * at the procedural placeholder head and facet 309 either does not exist or is
 * somewhere else entirely, and you get guides floating beside the skull with no
 * error anywhere — which on a public page is indistinguishable from the app
 * being broken. So: real head, real catalogue, and every facet the file names
 * actually present, or we show the empty groom instead. An empty groom looks
 * like a blank canvas. A misapplied one looks like a bug.
 */

import { Groom } from './groom.js';

/** Schema v5. Migrated to current on load — see the header. */
export const DEFAULT_GROOM = {
  version: 5,
  masterSeed: 1337,
  globals: { density: 0.85, length: 0.5, segments: 4 },
  faces: [
    {
      facetId: 309, density: 0.85, length: 0.5, segments: 4,
      shape: [
        0, 0, 0, 0, 0, 0.125, 0, 0, 0.25, 0, 0, 0.375, 0, 0, 0.5,
        0, 0, 0.625, 0, 0, 0.75, 0, 0, 0.875, 0, 0, 1,
      ],
    },
    {
      facetId: 308, density: 0.85, length: 0.5, segments: 4,
      shape: [
        0, 0, 0, 0, 0, 0.125, 0, 0, 0.25, 0, 0, 0.375, 0, 0, 0.5,
        0, 0, 0.625, 0, 0, 0.75, 0, 0, 0.875, 0, 0, 1,
      ],
    },
    {
      facetId: 329, density: 0.85, length: 0.5, segments: 4,
      shape: [
        0, 0, 0, 0, 0, 0.125, 0, 0, 0.25, 0, 0, 0.375, 0, 0, 0.5,
        0, 0, 0.625, 0, 0, 0.75, 0, 0, 0.875, 0, 0, 1,
      ],
    },
  ],
  guides: [
    {
      id: 1,
      facetId: 309,
      root:    [-0.21980567089692946, 0.9173450332428539, 0.09429845119328469],
      normal:  [-0.12026077842219222, 0.9644063710126927, 0.23549457896821563],
      tangent: [0, -0.23721621461055528, 0.9714568788813217],
      points: [
        0, 0, 0,
        0.08881172866609423, -0.006796744922140391, 0.08769994931936143,
        0.190807465883203,   -0.014994942183138963, 0.15949590430706886,
        0.30499189932530335, -0.02480540827054687,  0.20940251625734402,
        0.42734063726103105, -0.036137367016153554, 0.23236712028815099,
        0.5516997732389999,  -0.04843544497793742,  0.22944093183837766,
        0.6741960409869346,  -0.06103510941118895,  0.2079720509840664,
        0.791960916396673,   -0.07374895088298682,  0.16803719959721694,
        0.9161055588755189,  -0.08448740764949489,  0.17792624859463466,
      ],
      length: 0.5,
    },
    {
      id: 2,
      facetId: 308,
      root:    [0.21980567089692946, 0.9173450332428539, 0.09429845119328469],
      normal:  [0.12026077842219222, 0.9644063710126927, 0.23549457896821563],
      tangent: [0, -0.23721621461055528, 0.9714568788813217],
      points: [
        0, 0, 0,
        0.0779936564597598,  -0.007417891718786375, 0.09740104945280709,
        0.1668841915381145,  -0.015673233402819668, 0.18489574704758255,
        0.26729096777940514, -0.02409331762767874,  0.25887264524236137,
        0.3798452496564439,  -0.03151645688175288,  0.31273757478653796,
        0.5022459416700427,  -0.03632675583724308,  0.33763600081276,
        0.6266352625243853,  -0.03672115546774568,  0.32530144340892575,
        0.7369218155295845,  -0.029926996542131108, 0.26685731940371615,
        0.8600880136193105,  -0.03018763275052938,  0.2455261282300102,
      ],
      length: 0.5,
    },
    {
      id: 3,
      facetId: 329,
      root:    [-0.5440319104199486, 0.8127379235225277, 0.007817496954284176],
      normal:  [-0.7182251814528086, 0.678788524234934, 0.15296642799660481],
      tangent: [0, -0.21983912974654343, 0.9755361382502866],
      points: [
        0, 0, 0,
        -0.0027102999837121102, -0.04996049633293356, 0.11454956604097884,
        -0.006348430038898439,  -0.11701037170264204, 0.21998237982599514,
        -0.010996220577853443,  -0.20249467701937965, 0.31106383560948714,
        -0.01679446401481847,   -0.30864126195349667, 0.37682311541003943,
        -0.02354300012676825,   -0.43126856817716347, 0.40010403095662084,
        -0.0303329961342565,    -0.553601396293402,   0.37533358244813286,
        -0.03641959455621442,   -0.6622864774641326,  0.31388843251287063,
        -0.04319834525668231,   -0.7852707909790629,  0.29258333527764985,
      ],
      length: 0.5,
    },
  ],
  seams: [],
};

/**
 * Load DEFAULT_GROOM into `groom`, or decline and say why.
 *
 * Never throws. This runs on the first paint of a public page, and the correct
 * behaviour when the greeting groom is unloadable is "an empty head appears",
 * not "the HUD says Error and nothing renders". main()'s catch is for genuine
 * bootstrap failures; a bad default is not one, so it must not reach it.
 *
 * @param {object}  o
 * @param {Groom}   o.groom          — mutated in place via copyFrom
 * @param {object?} o.catalogue      — the FacetCatalogue, or null
 * @param {boolean} o.isPlaceholder  — true when loadHead fell back
 * @returns {{ applied: boolean, reason: string }}
 */
export function applyDefaultGroom({ groom, catalogue, isPlaceholder }) {
  if (isPlaceholder) {
    return { applied: false, reason: 'placeholder head — guide roots belong to the GLB' };
  }
  if (!catalogue) {
    return { applied: false, reason: 'no facet catalogue' };
  }

  let next;
  try {
    next = Groom.fromJSON(DEFAULT_GROOM);
  } catch (err) {
    // Reachable if the mesh's SHAPE_POINTS changes under this literal, or a
    // future migration rejects a field. Loud in the console, silent on screen.
    console.error('[defaultGroom] rejected by the schema:', err.message);
    return { applied: false, reason: `schema rejected it — ${err.message}` };
  }

  // Every facet the file names must exist on THIS mesh. A partial match is the
  // dangerous case: enough hair appears that nothing looks wrong, but the groom
  // is not the one that was authored. All or nothing.
  const missing = [];
  for (const facetId of next.faces.keys()) {
    if (!catalogue.getFacet(facetId)) missing.push(facetId);
  }
  if (missing.length) {
    return {
      applied: false,
      reason: `mesh has no facet ${missing.join(', ')} — head.glb changed since this groom was authored`,
    };
  }

  groom.copyFrom(next);
  return {
    applied: true,
    reason: `${next.faces.size} facets, ${next.guides.count} guides`,
  };
}