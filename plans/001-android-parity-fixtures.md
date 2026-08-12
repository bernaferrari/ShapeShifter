# Plan 001: Establish Android semantic parity fixtures

> **Executor instructions**: Follow this plan step by step. Run every verification
> command before moving on. Do not change production behavior in this plan. If a
> STOP condition occurs, stop and report instead of improvising. When complete,
> update Plan 001 in `plans/README.md`.
>
> **Drift check**: `git diff --stat 3268b817..HEAD -- lib/shapeshifter/__tests__ components/editor/__tests__ package.json`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3268b817`, 2026-08-12

## Why this matters

The existing 654-test suite passes while accepting concatenated Boolean geometry
and stepped color animation. The Android compiler tests mostly assert XML
substrings. Before changing the document or renderer, create fixtures that define
the supported Android contract and expose semantic drift rather than preserving it.

## Current state

- `lib/shapeshifter/__tests__/androidCompiler.test.ts:60-109` covers one hierarchy,
  one incompatible morph, and a hidden target using substring assertions.
- `lib/shapeshifter/__tests__/importers.test.ts:497-626` tests basic VectorDrawable
  import but does not exercise an Android bundle round trip.
- `lib/shapeshifter/__tests__/playheadResolve.test.ts:230-249` explicitly expects
  colors to switch at the midpoint.
- `lib/shapeshifter/__tests__/pathUtils.test.ts:485-493` accepts a Boolean concat fallback.
- `vitest.config.ts:10-13` runs Node-based Vitest tests only.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `pnpm test -- lib/shapeshifter/__tests__/androidParity.test.ts` | all new tests pass after later plans; expected failures must be `.fails` initially |
| Full tests | `pnpm test` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:

- `lib/shapeshifter/__tests__/fixtures/android/` (create)
- `lib/shapeshifter/__tests__/androidParity.test.ts` (create)
- Existing Android importer/compiler test files only when consolidating duplicated fixture text

**Out of scope**:

- Production modules
- Browser UI tests
- Figma-specific behavior
- PDF, Lottie, CSS, and animated SVG assertions

## Steps

### Step 1: Add canonical Android XML fixtures

Create small checked-in fixtures representing:

1. Nested groups with non-default pivot, scale, rotation, and translation.
2. A clip path followed by multiple children in the same group.
3. Open and closed paths using line, cubic, quadratic, and arc commands.
4. Fill/stroke alpha, width, cap, join, miter, fill type, and all trim properties.
5. Solid Android colors including `#AARRGGBB` and transparent values.
6. API-24 linear/radial gradients with per-stop alpha.
7. A valid path morph with identical command signatures.
8. An invalid morph with incompatible command signatures.
9. Transform, fill/stroke color, alpha, stroke width, trim, and path-data animators.
10. Multiple sequential blocks for the same property, including a final value of zero.

Keep each fixture minimal and include a short comment naming the behavior under test.

**Verify**: `find lib/shapeshifter/__tests__/fixtures/android -type f | sort` lists every fixture.

### Step 2: Add semantic comparison helpers

In `androidParity.test.ts`, parse generated XML with `DOMParser` and compare
normalized element trees and attributes. Do not compare formatting or entire raw
strings. Normalize harmless numeric formatting while preserving hierarchy, child
order, target names, resource references, property names, timing, values, and
interpolators.

**Verify**: focused test command exits 0 for helper self-tests.

### Step 3: Characterize known failures explicitly

Add `it.fails` tests for current defects so the suite remains green while making
the gaps executable:

- clip scope and nested group transform preview/export parity;
- zero-valued numeric animation endpoints;
- smooth color interpolation at an interior time;
- path blocks using their own endpoint geometry;
- save/reopen preservation of morph endpoints and custom easing;
- import preservation of viewport and root vector properties;
- Android color conversion rather than raw CSS color emission;
- exported XML refusing unsupported or incompatible tracks.

Every later plan must convert its corresponding `it.fails` case to a normal test.

**Verify**: focused and full suites pass; output reports the expected-failure cases.

## Test plan

- Use the object-factory style in `androidCompiler.test.ts:6-58`.
- Test semantic XML trees, not whitespace.
- Include exact boundary times: before start, start, interior, end, and after end.
- Include at least one fixture using a 48×24 viewport and 24×12dp intrinsic size.

## Done criteria

- [ ] All ten fixture classes exist.
- [ ] Known failures are executable `it.fails` tests, not comments or skipped tests.
- [ ] No production file changed.
- [ ] `pnpm test`, `pnpm typecheck`, and `pnpm lint` exit 0.
- [ ] Plan status updated.

## STOP conditions

- Stop if fixture parsing requires adding a runtime dependency; report the proposed dependency first.
- Stop if an expected failure already passes; make it a normal regression test rather than weakening it.
- Stop if testing requires changing production output in this plan.

## Maintenance notes

Treat these fixtures as the Android language contract. Future import, model,
preview, or compiler changes must update them only when the supported Android
contract deliberately changes.

