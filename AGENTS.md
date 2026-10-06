# AGENTS.md

# Engineering Rules

This file defines the mandatory engineering workflow for AI coding agents
and developers working in this repository.

## 1. Required Workflow

For non-trivial changes:

1. Read the relevant GitHub User Story and Acceptance Criteria.
2. Read applicable architecture docs and ADRs.
3. Inspect existing code, tests, and dependencies.
4. Create or update `plans/<story-id>-plan.md`.
5. Decompose meaningful implementation work into GitHub Sub-Issues.
6. Implement the smallest logical increment.
7. Run applicable tests.
8. Verify every Acceptance Criterion.
9. Create or update the Pull Request.
10. Do not declare DONE until the Definition of Done is satisfied.

Do not begin implementation before understanding the requirement and
existing implementation.

## 2. GitHub Model

- Milestone = Release / MVP
- Issue = User Story
- Sub-Issue = Engineering Task
- Pull Request = Implementation
- GitHub Actions = Automated verification

GitHub is the source of truth for execution status.
Do not maintain duplicate task status in repository files.

## 3. Requirements

- Do not invent business requirements.
- Acceptance Criteria define required functional behavior.
- Record assumptions explicitly.
- Do not silently expand scope.
- If ambiguity materially affects business behavior, security,
  authorization, architecture, or cost, stop and request a decision.

## 4. Planning

For non-trivial work create:

`plans/<story-id>-plan.md`

The plan should contain only what is useful for implementation:

- objective
- proposed approach
- affected components
- dependencies
- implementation tasks
- Acceptance Criteria mapping
- test strategy
- risks/assumptions

Do not duplicate the User Story inside the plan.

Update the plan when implementation materially changes.

## 5. Engineering

Prefer:

- existing components over new components
- deterministic logic over LLM reasoning
- small changes over large refactoring
- configuration over hard-coded values
- reversible decisions over irreversible ones
- existing dependencies over unnecessary new dependencies

Do not perform unrelated refactoring.

If significant unrelated technical debt is discovered, create a separate
issue.

## 6. AI / LLM Usage

Use LLM reasoning where semantic interpretation provides meaningful value.

Prefer deterministic code for:

- authorization
- calculations
- exact matching
- validation
- filtering
- schema enforcement
- explicit business rules

Never rely solely on LLM output for security or authorization decisions.

## 7. Testing

Every Acceptance Criterion must map to:

- an automated test, or
- documented verification evidence.

Run the smallest relevant test set during implementation and the required
test suite before completion.

Do not weaken or remove valid tests merely to make implementation pass.

## 8. Security

Never commit or expose:

- passwords
- API keys
- access/refresh tokens
- private keys
- certificates
- connection strings
- production secrets

Never bypass organization-managed security controls.

Only use approved MCP servers, plugins, models, external services, and
credentials.

## 9. Architecture

Follow:

- `docs/architecture/`
- `docs/architecture/decisions/`

Create an ADR when a change materially affects:

- architecture
- security boundaries
- authentication/authorization
- persistence
- major dependencies
- vendor/platform selection
- difficult-to-reverse technical decisions

Do not create ADRs for routine implementation choices.

## 10. Definition of Done

A User Story is DONE only when all applicable conditions are satisfied:

- [ ] All Acceptance Criteria pass
- [ ] Implementation is complete
- [ ] Required tests pass
- [ ] Existing regression tests pass
- [ ] Security requirements are satisfied
- [ ] CI passes
- [ ] Documentation is updated where required
- [ ] ADR updated if architecture changed
- [ ] Verification evidence exists
- [ ] Required PR reviews/checks pass
- [ ] No unresolved blocking defects remain

Never report DONE simply because code was generated or compiles.

## 11. Completion

When finishing work, report:

- Story
- Tasks completed
- Acceptance Criteria: PASS / FAIL
- Tests: PASS / FAIL
- Assumptions
- Remaining issues
- Status: READY FOR REVIEW / BLOCKED

Only report DONE when the Definition of Done is satisfied.

## 12. Detailed Documentation

Load additional documentation only when relevant:

- `docs/engineering/DEFINITION-OF-DONE.md`
- `docs/engineering/TESTING.md`
- `docs/engineering/SECURITY.md`
- `docs/architecture/`
- `docs/architecture/decisions/`
- `plans/<story-id>-plan.md`

Do not load unrelated documentation into context unnecessarily.

# Repository-Specific Directives & Architecture

# Agent instructions

Coding agents working in this repo should read:

1. [`CLAUDE.md`](CLAUDE.md) — stack, conventions, testing, security
2. [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) — **where to put doc edits** (README vs SETUP vs `docs/`)

Do not expand `README.md` with API tables, hook details, or bench SLAs — use the tier-2/3 files listed in the documentation policy.
