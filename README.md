# Home Aid Intake Portal

An accessible legal-aid **pre-application** and **staff continuation** portal. An
applicant fills a short, keyboard- and screen-reader-friendly multi-step form
that survives connection drops; intake staff continue the case through a
disclosure-limited view. State converges across sessions by **application id +
optimistic version**.

Built with **Next.js App Router**, **TypeScript (strict)**, **Prisma**, and
**SQLite**. No full UI component library is used — the accessible controls are
hand-built.

## Source material

[`materials/application-cases.json`](materials/application-cases.json) fixes the
application IDs, states, exemption reasons, accommodation values, disclosure
views, and offline-conflict examples. The Prisma seed and the domain constants
are derived directly from it.

---

## Quick start

```bash
npm install                # dependencies are already vendored in node_modules
npm run setup              # prisma generate + db push + seed (creates prisma/dev.db)
npm run dev                # http://localhost:3000
```

Native verification (all three pass):

```bash
npm test                   # Vitest: 62 domain + integration tests
npm run build              # prisma generate + next build (TS strict, no errors ignored)
npm run dev                # dev server
npm run test:e2e           # Playwright: 26 accessibility, convergence + resilience tests
```

`npm run test:e2e` is hermetic: it resets and seeds a separate `prisma/e2e.db`,
runs a production build, starts `next start -p 3100`, and drives Chromium. An HTML
report is written to `playwright-report/` (`npm run test:e2e:report` to open it).

### Key routes

| Surface | URL |
| --- | --- |
| Applicant landing (start / resume) | `/` |
| Applicant multi-step form | `/apply/APP-201` |
| Staff intake queue | `/staff` |
| Staff continuation (disclosure-limited) | `/staff/APP-201` |

Seeded fixtures: `APP-201` (NO_FIXED_INCOME, SUBMITTED) and `APP-202`
(NEEDS_CORRECTION, with an open `economicProof` correction).

---

## Architecture

```
src/
  domain/        Pure, framework-free business rules (unit-tested in isolation)
    constants.ts       enums mirroring application-cases.json + staff views
    stateMachine.ts    transitions, terminal states, editability
    materialRules.ts   required-material rules incl. NO_FIXED_INCOME waiver
    validation.ts      Zod field schemas + whole-application submission checks
    merge.ts           field-level three-way conflict resolution
    disclosure.ts      least-privilege projection for staff views
  server/        Persistence + orchestration (integration-tested against SQLite)
    db.ts              PrismaClient singleton
    applicationService.ts  transactional create/patch/submit/staff actions
    fieldSerialization.ts  scalar/array (de)serialization for TEXT columns
    ids.ts, errors.ts, http.ts
  app/
    api/...        Route handlers (thin: parse -> service -> JSON envelope)
    apply/[id]/    Applicant wizard (client) + server loader
    staff/         Queue + disclosure-limited detail + staff actions
    layout.tsx, globals.css, page.tsx
  components/StatusBadge.tsx
  lib/           Client types + offline draft cache (localStorage)
prisma/          schema.prisma + seed.ts
tests/           unit/ + integration/ (Vitest) and e2e/ (Playwright)
```

**Why no enum columns:** SQLite has no native enum type, so enum-like values are
stored as `TEXT` and constrained by the domain layer (`src/domain/constants.ts`
unions + Zod). This keeps the source of truth in one typed place.

---

## State machine

States come from `application-cases.json`:
`DRAFT → SUBMITTED → NEEDS_CORRECTION → RESUBMITTED → ACCEPTED → DECLINED`.

```
DRAFT ──submit──────────▶ SUBMITTED
SUBMITTED ──accept──────▶ ACCEPTED        (terminal)
SUBMITTED ──decline─────▶ DECLINED        (terminal)
SUBMITTED ──requestCorrection──▶ NEEDS_CORRECTION
NEEDS_CORRECTION ──resubmit────▶ RESUBMITTED
RESUBMITTED ──accept────▶ ACCEPTED        (terminal)
RESUBMITTED ──decline───▶ DECLINED        (terminal)
RESUBMITTED ──requestCorrection──▶ NEEDS_CORRECTION
NEEDS_CORRECTION ──amendCorrection──▶ NEEDS_CORRECTION   (self-loop)
```

- **Editable states:** `DRAFT` and `NEEDS_CORRECTION` — only here can applicant
  fields be patched (or materials replaced). Any other state rejects with
  `NOT_EDITABLE`.
- **Actors:** `submit`/`resubmit` are applicant actions; `requestCorrection`,
  `amendCorrection`, `accept`, `decline` are staff actions. Illegal transitions
  throw `INVALID_TRANSITION` — the route layer maps this to **HTTP 409** (a
  client conflict, not a 500). Backward moves are structurally impossible: you
  cannot un-accept, un-decline, or push a `SUBMITTED`/`NEEDS_CORRECTION`
  application back to `DRAFT`.
- **`amendCorrection`** is a `NEEDS_CORRECTION` self-loop so a staff member can
  refine/append a correction reason code *while the applicant is concurrently
  supplementing materials in the same state* — without an illegal backward
  transition and without stacking duplicate corrections (flagged fields are
  unioned).
- Every transition is recorded in `ApplicationEvent` (from → to, actor, note).
- The single `/submit` endpoint chooses `submit` vs `resubmit` from the current
  state, so first submission and post-correction resubmission share one path.

---

## Required-material rules (the core accessibility rule)

Implemented in [`src/domain/materialRules.ts`](src/domain/materialRules.ts) and
enforced server-side in `validateForSubmission`:

| Exemption reason | Economic-hardship proof | Identity proof |
| --- | --- | --- |
| `NO_FIXED_INCOME` | **Not required** (waived: `EXEMPT_NO_FIXED_INCOME`) | Required |
| `NOTIFIED_CRIMINAL_DEFENSE` | Not required (`EXEMPT_CRIMINAL_DEFENSE`) | Required |
| `NONE` | Required | Required |

When an applicant selects `NO_FIXED_INCOME`, the economic-proof control is
removed from the form and a **text** status region explains the waiver — the
applicant is never forced to upload economic-hardship proof, and submission is
not blocked on it. All other required materials (identity) still apply.

---

## Draft conflict resolution (three-way merge → convergence)

Each editable field row carries `updatedAtVersion` — the application version at
which it last changed. The client caches, per field, the value **plus** the
`baseVersion` **and `baseValue`** (the common ancestor) it started editing from
(`src/lib/draftStore.ts`). On save, the server merges field-by-field with a true
**three-way merge** (`src/domain/merge.ts`), falling back to version-based
two-way resolution when no `baseValue` is supplied:

| base vs server vs client | result |
| --- | --- |
| client == server | **no-op** (already converged) |
| client == base (client didn't really change it) | **no-op**, keep server value |
| server == base (server untouched since base) | **applied**, take client value |
| both changed the same field differently | **conflict** → keep **server** value, return client value for re-edit |

Empty values are coalesced: `null`, `[]`, and a blank string all mean "unset",
so an unsaved offline field never reads as a spurious change.

- **Protected accommodations:** a merge can *never clear* a reasonable
  accommodation the server currently holds — any edit that would empty a
  non-empty accommodation field is returned as a `PROTECTED_ACCOMMODATION`
  conflict. This holds across correction, offline recovery, duplicate submit,
  and attachment replacement.
- **Concurrent applicant + staff on the same old draft:** while an application is
  in `NEEDS_CORRECTION`, the applicant can supplement materials (a field patch)
  at the same time a staff member writes a correction reason code. The correction
  path **never writes field values**, so the applicant's supplement (and the
  accommodation need) is preserved; and because the staff request carries its own
  `baseVersion`, the server returns `concurrentFields` — the applicant fields
  changed meanwhile — to the **staff** session so it reconciles its view rather
  than silently overwriting its mental model. Each session sees the conflict that
  is relevant to it.

The offline-conflict examples from `application-cases.json` map to:

| Example | Handling |
| --- | --- |
| *same base version with different field edits* | both apply — no conflict (fields are independent) |
| *server accepted while client remains draft* | three-way merge; unchanged fields no-op, co-edited fields conflict to server value |
| *duplicate submit with same idempotency key* | replayed, not re-transitioned (see below) |

**Optimistic concurrency & idempotency.** Final submission requires the client's
`baseVersion` to equal the server version, else `VERSION_CONFLICT` (409). Submits
carry an `Idempotency-Key`; a repeat of the same key **replays** the original
outcome (`replayed: true`) instead of performing a second transition — even if
the retry arrives at a stale version after a browser timeout, and it never
disturbs accommodations. Everything is keyed on the server-issued application id
and the monotonic `version`, so client cache and server reconverge on the same
`(id, version, state)`.

### Attachment metadata replacement

`POST /api/applications/:id/materials` replaces the metadata bound to a material
field (`identityProof` / `economicProof`). It writes **metadata only, never
bytes**: it creates a new `MaterialMetadata` row, repoints the field (bumping the
field version so a concurrent stale edit three-way-conflicts), and detaches the
previously referenced metadata. It never touches accommodation fields, so a
reasonable-accommodation need survives a document swap. Editable only in
`DRAFT` / `NEEDS_CORRECTION`.

---

## Field-level disclosure (staff least privilege)

Staff views come from `application-cases.json` and are enforced in
[`src/domain/disclosure.ts`](src/domain/disclosure.ts). The projection copies
**only** whitelisted keys — over-privileged fields are never placed in the
payload, not merely hidden in the UI.

| View | Disclosed keys |
| --- | --- |
| `INTAKE_REVIEW` | `id`, `state`, `exemptionReason`, `materialMetadata`, `accommodations` |
| `CORRECTION_REVIEW` | `id`, `state`, `correctionFields`, `submittedFieldMetadata` |

Applicant PII (`fullName`, `contactPhone`, `contactEmail`) is **never** included
in either staff view or the staff queue list. `materialMetadata` is metadata only
(kind, filename, mime, size, uploadedAt) — never file bytes. The staff detail
page picks `CORRECTION_REVIEW` for `NEEDS_CORRECTION`/`RESUBMITTED` and
`INTAKE_REVIEW` otherwise; a switcher lets staff move between views explicitly.

---

## Accessibility

- **Programmatic names:** every input has an associated `<label htmlFor>`; radio
  and checkbox groups sit in `<fieldset>`/`<legend>`; the stepper and view
  switcher are labeled `<nav>` landmarks; a skip link targets `#main`.
- **Associated errors:** invalid controls set `aria-invalid="true"` and
  `aria-describedby` pointing at a visible `.field-error` message with
  `role="alert"`. Each error also carries a machine-readable `code`.
- **Error focus:** on a blocked submit, focus moves to the error summary
  (`role="alert"`, `tabIndex=-1`); each summary item is a button that switches to
  the field's step and focuses the control.
- **Screen-reader announcements:** a polite `aria-live` region announces saves,
  conflicts, restores, offline state, and submission outcomes.
- **Non-color status:** the status badge combines an icon (CSS `::before`), a
  text label, a shape/border, and a `data-state` attribute — never color alone.
  Waivers and conflicts are explained in text.
- **Focus visibility:** a thick high-contrast focus outline on all interactive
  elements.
- **Offline recovery:** a reload restores cached edits, announces the restore,
  returns the applicant to their last step, and moves focus into the step region.

---

## API reference

All errors use the envelope `{ "error": { "code", "message", "details" } }`.

### Applicant

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/applications` | — | Creates a `DRAFT`; returns the application view (201). |
| `GET` | `/api/applications/:id` | — | Full applicant-facing view. |
| `PATCH` | `/api/applications/:id/draft` | `{ baseVersion, edits:[{key,value,baseVersion,baseValue?}] }` | Field-level three-way merge (`baseValue` = common ancestor; omit for version fallback). Returns `{ application, applied[], conflicts[] }`; each item carries `basis` and `conflictReason`. `NOT_EDITABLE` if state disallows edits. |
| `POST` | `/api/applications/:id/submit` | `{ baseVersion }` + `Idempotency-Key` header | Submit or resubmit. `VALIDATION_FAILED` (422), `VERSION_CONFLICT` (409), or `{ application, replayed }`. Same key replays. |
| `POST` | `/api/applications/:id/materials` | `{ fieldKey, kind, filename, mimeType, sizeBytes, checksum?, materialId? }` | Replace attachment **metadata** (never bytes). Returns `{ application, material, replacedMaterialId }` (201). Preserves accommodations. `NOT_EDITABLE` outside `DRAFT`/`NEEDS_CORRECTION`. |

### Staff

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/staff/applications` | — | Queue: `id`, `state`, `accommodations`, `updatedAt` (no PII). |
| `GET` | `/api/staff/applications/:id?view=INTAKE_REVIEW\|CORRECTION_REVIEW` | — | Disclosure-limited projection (whitelisted keys only). |
| `POST` | `/api/staff/applications/:id/request-correction` | `{ fields[], reasonCode, note?, baseVersion? }` | From `SUBMITTED`/`RESUBMITTED` → `NEEDS_CORRECTION`; from `NEEDS_CORRECTION` amends in place (self-loop, unions fields). Returns `{ application, concurrentFields, amended }` — `concurrentFields` are applicant edits after `baseVersion`. Illegal from terminal → `INVALID_TRANSITION` (409). |
| `POST` | `/api/staff/applications/:id/decision` | `{ action: "accept"\|"decline", note? }` | Terminal transition. Illegal from terminal → `INVALID_TRANSITION` (409). |

---

## Acceptance steps

### Endpoint acceptance (curl)

```bash
# 1) Create a draft
APP=$(curl -s -XPOST localhost:3000/api/applications | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# 2) Fill required fields for NO_FIXED_INCOME (economic proof intentionally omitted)
curl -s -XPATCH localhost:3000/api/applications/$APP/draft \
  -H 'content-type: application/json' \
  -d '{"baseVersion":0,"edits":[
       {"key":"fullName","value":"Robin Fields","baseVersion":0},
       {"key":"contactEmail","value":"robin@example.org","baseVersion":0},
       {"key":"exemptionReason","value":"NO_FIXED_INCOME","baseVersion":0},
       {"key":"identityProof","value":"ID-META-1","baseVersion":0}]}'

# 3) Submit (idempotent). Repeat with the SAME key -> replayed:true, same version.
curl -s -XPOST localhost:3000/api/applications/$APP/submit \
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"baseVersion":1}'

# 4) Staff intake view — note no fullName/email in the payload
curl -s "localhost:3000/api/staff/applications/$APP?view=INTAKE_REVIEW"
```

### UI acceptance (the two-session scenarios)

Open the app in **two browser sessions** and verify:

1. **Offline draft recovery** — In session A, edit fields on `/apply/<id>`,
   advance a step, then reload without saving. The *Draft restored* banner shows,
   the polite live region announces the restore, focus lands in the step region,
   and your values + step are preserved.
2. **Field-level merge** — Sessions A and B both load the same draft. A edits
   *Full name* and saves; B edits *Phone* and saves. Both changes converge; no
   conflict.
3. **Field-level conflict** — A and B both edit *Full name* from the same base. A
   saves first. B's save reports a conflict, keeps the server value, and explains
   it in text; the accommodation-clearing case is protected explicitly.
4. **Duplicate final submit** — Submit, then submit again (same attempt). The
   second is replayed — the status does not double-transition.
5. **Correction → resubmit** — On `/staff/<id>` request a correction for
   `economicProof`; the applicant sees the correction banner, fixes the field,
   and resubmits to `RESUBMITTED`.
6. **Staff minimal disclosure** — On `/staff/<id>` confirm only the active view's
   fields are shown and no applicant PII appears.

Each of these is covered by an automated Playwright test in
[`tests/e2e/`](tests/e2e) (offline-recovery, convergence, staff-disclosure,
accessibility), which is the source of browser-based accessibility and
convergence evidence.

---

## Testing

- **Unit** (`tests/unit`): state machine (incl. `amendCorrection` self-loop and
  illegal backward transitions), material rules, validation, field-level
  two-way + three-way merge, `fieldsChangedSince`, disclosure projection — pure
  functions, no DB.
- **Integration** (`tests/integration`): the application service against a real
  SQLite `test.db` (created fresh per run) — full lifecycle, idempotency, version
  conflicts, protected accommodations, staff disclosure, concurrent staff
  correction + applicant supplement, and attachment metadata replacement.
- **E2E** (`tests/e2e`): Chromium against a production build — accessibility
  (names, associated errors, keyboard, focus, non-color status, live regions),
  offline recovery, two-session convergence, duplicate submit, correction
  round-trip, concurrent staff amend, staff least-privilege, and resilience
  (submit-success-then-timeout retry, illegal backward transitions, attachment
  metadata replacement).

Docker is not required.
