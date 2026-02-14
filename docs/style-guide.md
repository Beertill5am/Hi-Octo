# Octo Style Guide

Purpose: this guide is the default UI/UX/Branding contract for Octo. Use it as the source of truth so style decisions are not re-litigated each sprint.

## 1) Brand Foundation

- Product personality: expert, transparent, calm, practical.
- Tone: direct, concise, no hype, no marketing fluff.
- Promise: "Show your work, then ask for control at high-cost or high-risk checkpoints."

## 2) Visual Language

- Layout: single primary reading column, inline progress, no hidden wizard steps.
- Density: compact, developer-oriented spacing, minimal chrome.
- Hierarchy:
- `User query` -> `Pipeline/Reasoning` -> `Evidence/Results` -> `HITL decision` -> `Final answer`.
- Iconography: functional-only icons from existing Lucide set.
- Motion: subtle and purpose-driven only (typing, progressive reveal, loading states).

## 3) Core Colors and States

- Keep current theme tokens in `frontend/src/app/globals.css` as canonical palette.
- Use violet only as action emphasis (`approve`, active highlights).
- Neutral surfaces must dominate; avoid introducing new accent families without approval.
- Status colors:
- `running`: neutral + subtle pulse
- `hitl_waiting`: neutral surface + clear call-to-action controls
- `failed/cancelled`: red semantic text only, no full-screen alert patterns

## 4) Typography and Content

- Body copy: short and instructional.
- Labels: action-first (`Approve & Generate`, `Reject`, `Edit Draft Plan`).
- Error text: factual, include what failed and the next likely action.
- Keep sentences <= 22 words when possible.

## 5) Interaction Rules

- Inline-first policy: do not open popups for normal pipeline states.
- While HITL is waiting:
- keep all prior steps visible inline for auditability,
- render prior interactive elements in disabled state,
- keep only current HITL controls interactive.
- Never remove prior evidence cards after new stages start.
- If data is partially missing, degrade gracefully with text fallback; never hard-crash UI.

## 6) HITL UX Contract

- Pre-web-search HITL:
- title: `Web Search Approval`
- goal: explicit consent before external search.
- Retrieval HITL:
- title: `Citation Review`
- goal: approve evidence before generation.
- Reasoning HITL:
- title: `Reasoning Review`
- show streamed reasoning text,
- allow `Accept`, `Reject`, `Edit` (editable draft plan),
- apply edited text directly to generation blueprint.
- Post-web-search HITL:
- title: `Web Review`
- show source cards + validated summary.

## 7) Evidence and Summary Safety

- Any displayed summary claim must cite `Source #N` that exists in current `search_results`.
- Drop unsupported summary lines; keep only non-claim metadata lines like `Coverage:`.
- Source display is stable, ordered, and human-readable (`Source #1`, `Source #2`, ...).

## 8) Component-Level Guidelines

- `ChatHistory`:
- timeline is immutable for the run; append-only behavior.
- `HITLModal`:
- no destructive auto-approval paths.
- clear approve/reject/edit actions.
- `SearchResultCard`:
- always include title, URL/domain, snippet, and source label.
- `QuickReplies`:
- disabled when run is not active or while HITL gate is open.

## 9) Accessibility and Responsiveness

- Minimum touch target: 32px height for action buttons.
- Preserve contrast across dark/light themes using existing token system.
- Keyboard flow:
- tab order reaches approve/reject/edit controls without traps.
- Mobile:
- avoid side-by-side control clusters that overflow; wrap buttons.

## 10) Delivery Checklist (Use Per PR)

- [ ] Prior pipeline steps remain visible inline.
- [ ] During HITL wait, previous interactions are visibly disabled.
- [ ] No summary line references a non-existent source.
- [ ] HITL actions map exactly to backend contract.
- [ ] Empty/partial payloads show graceful fallback text.
- [ ] `npm -C frontend run lint` passes.

## 11) Change Management

- Any new visual pattern must update this guide in the same PR.
- If a change conflicts with this guide, update the guide first, then implement.
- Keep the guide short and operational; avoid speculative design notes.
