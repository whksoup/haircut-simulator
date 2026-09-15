# 2026-09-15 — Agent and documentation workflow

Started 2026-09-15; final checkpoint 2026-09-16 (Asia/Singapore).

## Purpose and scope

Track: agent/documentation workflow, scope v1. Implement the requested documentation, seaming, and generic builder roles and a lightweight three-layer documentation procedure. Earlier conversation explored alternatives; this request authorizes this setup. It does not activate the suggested application backlog or a standing integrator pipeline.

## Progress and evidence

Added three project role definitions and a shared workflow covering status, dated sessions, canonical docs, handoffs, and scope revisions. Seeded status from existing documentation without inventing active product tracks. Kept planner/architect definitions and existing application work intact.

Source: local `C:/Users/He Kai/haircut-simulator`, base HEAD `218a0fdd847ee6ea544c92696de03180e9b577ac` plus a dirty working tree. Extensive relocation/application changes predate this task; this HEAD is not a snapshot of the tested source. Task edits are the three new agent TOMLs, workflow/status/this session, and workflow links/routing in README, AGENTS and architecture docs.

Validation on 2026-09-16, against the local dirty source described above:

- Python `tomllib` parsed all five `.codex/agents/*.toml` files; required fields and unique names checked. New files match the documented Codex custom-agent schema.
- Checked all local Markdown link targets in README, AGENTS, architecture, workflow, status and this session; targets exist. `git diff --check` passed (line-ending warnings only).
- `npm test`: five passing/four failing files, reproducing the documented console, seam-commit, seam-release and seam-tool failures. No tests skipped or assertions changed.
- `npm run build`: passed; `index-DPwTWVUH.js`, 814.21 kB, with the existing >500 kB warning.
- Initial sandbox runs failed with Node EPERM while resolving the workspace path. Approved outside-sandbox reruns produced the results above.
- Browser behavior was not rechecked because only documentation and role configuration changed. Runtime discovery and behavioral execution of the new roles have not been exercised; parsing does not establish either.

The requested file/configuration setup is complete. Existing application failures remain outside this track's scope.

## Decisions and scope changes

- Seaming reviews component boundaries, schemas and state contracts, including actual hair-seam integration; it is read-only and returns corrections to the implementer.
- Builder owns bounded source changes and evidence; architectural design remains with the existing architect role.
- Documentation or the primary coordinator is the single writer of shared documentation. Workspace-write permission is broader than the documentation role's instructed ownership.
- Checkpoint unstable work, preserve hypotheses and superseded requirements, and promote only accepted behavior into canonical docs.
- Inherit model choices. No extra plugins, hooks, persistent orchestration, or automatic commits are introduced.

## Explorations and open questions

The preceding discussion considered CI, browser automation, integrator pipelines and additional skills. These remain proposals. No application experiments or solver changes were performed for this task.

## Next starting point

On the next substantive task, use [workflow.md](../workflow.md) to assign roles and checkpoint evidence. If the current session cannot discover the new roles, use a fresh task/session and verify discovery there. There are no active builders or integration jobs from this setup task.
