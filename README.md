# Home Aid Intake Portal

Blank 0-1 baseline for an accessible legal-aid pre-application and staff continuation flow. No scheduling or generic case-management implementation is provided.

## Source material

`materials/application-cases.json` fixes application IDs, states, exemption reasons, accommodation values, disclosure views, and offline-conflict examples.

## Required delivery contract

- Next.js App Router, TypeScript strict, Prisma, and SQLite; no full UI component library.
- Deliver accessible applicant and staff surfaces, server validation, persistence, tests, and seed data.
- Native verification: `npm test`, `npm run build`, and `npm run dev`.
- Forms require programmatic names, associated errors, keyboard focus recovery, and non-color-only status communication.
- Document state transitions, field-level disclosure, draft conflict resolution, and endpoint/UI acceptance steps.

Docker is not required.

