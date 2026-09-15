# 2026-09-16 — Critic and builder test-first procedure

## Purpose and scope

Track: agent/documentation workflow, scope v2. Extend [the initial setup](2026-09-15-agent-workflow.md) with a reusable critic and a proportionate test-first procedure for builder. No separate TDD agent, blanket coverage threshold, application changes, or implementation-loop trial is included.

## Progress and evidence

Added `.codex/agents/critic.toml`; updated builder instructions, AGENTS routing, canonical workflow and project status. Critic consumes versioned rubrics and actual artifacts, separates missing evidence from failure, and cannot override mandatory requirements with quality scores. Builder records meaningful RED/GREEN evidence, characterization tests, or justified alternatives.

Source: local `C:/Users/He Kai/haircut-simulator`, HEAD `218a0fdd847ee6ea544c92696de03180e9b577ac` plus existing dirty relocation/application/workflow changes. HEAD alone does not identify these files. This task changes only critic/builder configuration, AGENTS, workflow, status and this session note.

Validation performed 2026-09-16:

- Python `tomllib` parsed all six agent definitions; required fields and unique names checked.
- Local Markdown link targets in the changed docs resolve; `git diff --check` passed with existing line-ending warnings.
- `npm test` on this dirty checkout: five passing/four failing files, matching the documented console, seam-commit, seam-release and seam-tool failures. No skipped tests or changed assertions.
- `npm run build`: passed with existing >500 kB warning; output `index-DPwTWVUH.js`, 814.21 kB. Both repository commands ran with approved escalation because the sandbox previously blocked Node path resolution.
- No RED/GREEN cycle was appropriate for these configuration/documentation edits; syntax/schema checks, link checks and instruction review were the direct validation. Browser checks were not needed for this change. Runtime discovery/behavior of the new role has not been exercised.

The requested configuration/procedure extension is complete; the application baseline still has its four known failures.

## Decisions and scope changes

The user adopted the proposed critic and builder procedure after discussing a separate TDD specialist. This is scope v2 of workflow setup; no product work is activated. The coordinator owns rubric clarification and acceptance. Critic is read-only; builder/coordinator collects fresh evidence. Performance and temporal claims need appropriate measurements/recordings. Existing four test failures do not count as a new test's RED step.

## Explorations and open questions

No application experiments performed. Rubrics and evidence capture remain task-specific. A separate test-design agent and coverage gate remain deferred.

## Next starting point

In a later authorized implementation trial, supply a rubric and scenario, use builder's handoff, and ask critic to grade the actual evidence. See [the critic input/output contract](../workflow.md#critic-evaluation-contract). Runtime discovery may require a fresh task/session. No implementation trial or background review loop is running.
