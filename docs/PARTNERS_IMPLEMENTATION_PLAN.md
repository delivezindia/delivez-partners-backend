# Delivez Partners — Step-by-Step Implementation Plan

Source of truth: *Delivez Partners & Local — Implementation Plan v1.0* (sections referenced as §x.y) and `delivez_schema.prisma` (Appendix A).
Scope: **Delivez Partners** (backend + web + mobile) plus the thin slice of **Admin** and **Core** that Partners cannot work without.
Out of scope here: the Local customer app, Rider app, penalties/settlements automation, AI layer — they get stubs or come later (Step 15).

---

## 0. Decisions to lock before writing code

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| D1 | Backend framework | **NestJS 11 + TypeScript** (as in §3.2) | Guards/DI/OpenAPI fit the role + state-machine design. Your existing `ez_logistic_backend` is Express/JS — don't extend it; keep Core separate. |
| D2 | Database | **New Postgres 16 + PostGIS DB** for Delivez Core | `ez_logistic_backend` (Delivez One) has its own DB. Share identity/dispatch later via API (§2.3), not by merging DBs now. |
| D3 | Repo | **pnpm + Turborepo monorepo** in this folder | One `@delivez/types` + generated API client used by web and mobile. |
| D4 | Build order | **Backend → Partners web (tablet-first) → Partners mobile (Expo)** | Web is fastest to iterate; mobile reuses the API client, types and i18n. |
| D5 | External services in dev | Fake providers behind interfaces (OTP printed to console, penny-drop auto-pass, S3 = MinIO, OCR = no-op) | Nothing blocks on vendor accounts; swap in MSG91 / Razorpay X / AWS later by config. |
| D6 | No customers yet | A **dev order simulator** endpoint + store-created orders (§5.6.5) | Lets the Orders screen be built and tested before Delivez Local exists. |

### Schema fixes needed before the first migration
The Appendix A schema validates, but a few things will bite during onboarding:

1. **`Store` required fields vs. resumable onboarding.** The store row is created at OTP verify (status `DRAFT`, §5.1 / Fig. 5), but `addressLine1`, `pincode`, `cityId`, `lat`, `lng`, `geohash`, `phone` are required and unknown until the OUTLET step. → Make them nullable (enforce at `submit`), or create the store only after OUTLET. **Recommend: nullable + validated on submit.**
2. **`Store.slug`** is required/unique — generate `name-<6 char id>` on BASIC_DETAILS; allow a temporary slug in DRAFT.
3. **`PartnerAccount.legalName`/`displayName`** required at creation → default to the store name from BASIC_DETAILS, editable later.
4. **`PartnerMember.pinHash`** is only in raw SQL (Appendix B 004) → add it to the Prisma model instead so the client sees it.
5. **`Pharmacist.userId`** has no relation → add `user User? @relation(...)` (needed for the PHARMACIST role later).
6. **Idempotency keys** (§13.1) have no table → add `idempotency_keys (key, user_id, route, response_hash, created_at)` or store in Redis with 24 h TTL (**Redis recommended**).
7. **Outbox + feature_flags** → add as Prisma models (not only raw SQL) so the relay worker uses the typed client.
8. Pin **Prisma 6** (`previewFeatures = ["postgresqlExtensions"]` still required).

---

## Target repository layout

```
delivez_parteners/
├── apps/
│   ├── core-api/          NestJS (all modules, one deployable)
│   ├── core-worker/       same code, BullMQ processors + cron (can start as a flag in core-api)
│   ├── partners-web/      React 18 + Vite + TS + Tailwind (tablet-first)
│   ├── partners-mobile/   Expo SDK 52 + expo-router
│   └── admin-web/         React — only the screens Partners needs (Step 7)
├── packages/
│   ├── db/                prisma/schema.prisma, migrations, seed
│   ├── types/             zod DTOs, enums, event payloads, onboarding flow defs
│   ├── api-client/        generated from core-api OpenAPI
│   ├── ui/                design tokens (§16.1) + primitives
│   ├── i18n/              EN first, HI/KN next (8 languages later)
│   └── config/            eslint, tsconfig, tailwind preset
├── infra/docker-compose.yml   postgres+postgis, redis, minio, mailpit
└── docs/
```

### Backend module layout (NestJS, inside `apps/core-api/src/modules`)
`identity` · `geo` · `partners` · `onboarding` · `catalog` · `orders` · `dispatch` (stub) · `messaging` · `files` · `admin` · `audit` — each owns its tables and talks to others through the event bus (§3.4).

---

## The steps

Each step lists **Backend**, **Frontend**, and **Done when**. Rough durations assume 1–2 developers; adjust freely.

### Step 1 — Monorepo & local infrastructure (2–3 days)
- **Setup:** pnpm workspace, Turborepo, shared tsconfig/eslint/prettier, Husky + lint-staged.
- `infra/docker-compose.yml`: `postgis/postgis:16`, `redis:7`, `minio`, `mailpit`.
- `.env.example` per app; `README` with `pnpm dev` that starts everything.
- **Done when:** `docker compose up` + `pnpm dev` boots an empty NestJS app and an empty Vite app.

### Step 2 — Database (2–3 days)
- **Backend:** copy Appendix A into `packages/db`, apply the schema fixes above, first migration.
- Raw SQL migrations: PostGIS `stores.location` generated column + GiST index, `zones.geom`, outbox (Appendix B).
- Seed (Appendix C): Bengaluru, 3 zones, pincodes, Karnataka drug rule, all legal docs v2026.10, FOUNDER + COMPLIANCE admins, 2 demo stores.
- **Done when:** `pnpm db:reset` produces a seeded DB; `prisma validate` runs in CI.

### Step 3 — Core API skeleton (3–4 days)
- **Backend:** ConfigModule (zod-validated env), PrismaService, Redis, BullMQ, Socket.IO gateway with Redis adapter, Swagger/OpenAPI at `/docs`.
- Global error filter in the §13.1 shape `{ error: { code, message, details, correlationId } }`; correlation-id middleware; request logging (pino).
- Audit: Prisma extension writing `audit_logs` (before/after) for every write.
- Event bus: `EventBus.publish()` writes to **outbox in the same transaction**; relay worker pushes to Redis pub/sub; envelope as §11.2.
- Idempotency interceptor (`Idempotency-Key` header, Redis 24 h).
- `packages/api-client` generated from OpenAPI (`openapi-typescript` + `openapi-fetch`, or orval).
- **Done when:** a sample endpoint emits an event that reaches a WebSocket client; error responses match the contract.

### Step 4 — Identity & auth (4–5 days)
- **Backend:** `POST /v1/auth/otp/request`, `/otp/verify`, `/auth/refresh`, `/auth/logout` (§4.1). OTP hashed, 5/hour rate limit, 5-min expiry; dev provider logs code.
- JWT RS256 15 min access + rotating refresh stored hashed in `sessions`; `app` claim (`PARTNERS`, `ADMIN`).
- Guards: `@App('PARTNERS')`, `@Roles(...)`, `@StoreScope()` (checks `partner_members.store_ids`), admin `@AdminRoles()` + city scope.
- `GET /v1/partners/me` → memberships, stores, pending legal versions.
- Device tokens endpoint (for push later).
- **Frontend (partners-web):** app shell, routing, TanStack Query, Zustand auth store, token refresh interceptor. Screens **P01 Splash/language, P02 Login OTP, P03 Account chooser**.
- **Done when:** a phone logs in on web, refresh works, a customer/admin token is rejected on partner routes.

### Step 5 — Onboarding engine, backend (1.5 weeks)
- **Flow definitions** in `packages/types/onboarding/` — `RESTAURANT_V1`, `STORE_V1`, `VENDOR_V1` (and `PHARMACY_V1` skeleton): ordered steps, zod schema per step, `canSkip`, readiness weight (§5.1.1). Shared by web, mobile and later WhatsApp.
- `POST /partners/onboarding` (start: vertical, storeType, channel, referral) → creates user membership OWNER, partner account, DRAFT store, session.
- `GET /partners/onboarding/:id`, `PATCH /partners/onboarding/:id/steps/:step` (validate → merge `stepData` → write denormalised store columns → `onboarding_events` → return next step + progress), `POST .../submit`.
- OUTLET step: reverse geocode (Google Geocoding, fake in dev) → pincode → city/zone, `addressConfidence`, geohash.
- **Readiness score** service (§5.1.3) recomputed after each step and document review; stores breakdown.
- **Files module:** `POST /files/presign` (PUT to MinIO/S3, ≤10 MB, jpg/png/pdf), `POST /partners/documents` registers it; OCR job stub (BullMQ).
- **Bank:** `POST /partners/bank-accounts` (AES-256-GCM encrypt, return last4 only), `/verify` → penny-drop provider (fake = VERIFIED, name match 0.92).
- **Legal:** `GET` required versions for store (incl. state rider), `POST /partners/consents` with IP/channel/UA.
- Events: `onboarding.submitted`, `document.verified/rejected`.
- **Done when:** a store can be onboarded end-to-end with only API calls (Postman/HTTP file in `docs/`), readiness = 82 for the §5.1 example.

### Step 6 — Onboarding wizard, web (1.5 weeks)
- **Frontend:** screens **P04–P13**: stepper driven by the flow definition (not hard-coded), forms with react-hook-form + shared zod schemas, resume from `currentStep`.
- Components: `MapAddressPicker` (Google Places autocomplete + draggable pin + confidence chip), `DocumentUpload` (drag-drop, preview, status chip), `ReadinessMeter` (ring + "fix" links), commercials screen (0 % commission — read-only), click-wrap legal screen, training/practice screen (STORE_V1), Go-live screen with status.
- **Done when:** acceptance criterion from §17 Phase 1 — a restaurant reaches SUBMITTED in < 15 min with ≥5 items (menu step can link to Step 9's catalog, or accept "add later").

### Step 7 — Minimal Admin for approvals (1 week)
Partners can't go LIVE without it.
- **Backend:** `GET /admin/onboarding/pipeline`, `GET /admin/documents?status=PENDING`, `POST /admin/documents/:id/verify|reject`, `POST /admin/stores/:id/approve {LIVE|LIMITED}`, `/reject`, `/request-changes`; writes `admin_actions`; store status state machine (§10.2); verification reminders (day 3/7/9 jobs).
- **Frontend (admin-web):** login, pipeline list, document queue with side-by-side image + OCR fields, store approval page.
- Partner side: document status chips update via `user:{id}` / `store:{id}` WebSocket + in-app notification.
- **Done when:** reject with reason reaches the partner; re-upload keeps the old row; approve → store LIVE and `probationOrdersLeft=100`.

### Step 8 — Store operations, staff & dashboard shell (1 week)
- **Backend:** `GET/PUT /partners/stores/:id` (profile + ops settings §5.5), timings & holidays CRUD, `PUT .../open-state` (OPEN/BUSY/CLOSED), scheduler job: auto-close outside timings / reopen if previous state was OPEN.
- Staff: invite by phone + role + store scope (inactive member + SMS deep link → activates on first OTP), role change, remove; 4-digit **PIN switch** endpoint issuing a short session.
- Blocking "Review updated terms" check in `/partners/me` when a legal version changes.
- **Frontend:** **P14 Dashboard** (open/busy toggle, prep-time control, readiness/probation chip, placeholder KPIs), **P24 Staff**, **P25 Settings** (profile, timings & holidays, delivery & pickup, operations, documents, bank, legal, notifications, language), outlet selector in top bar, PIN switch screen.
- **Done when:** a manager can't change bank; counter staff can't open settings (403 + hidden UI).

### Step 9 — Catalog & inventory (1.5 weeks)
- **Backend:** categories, products (+variants, add-on groups/add-ons), images via presign, soft delete, sort; inventory + movements; availability rule = `isAvailable && !pausedUntil>now && (!trackStock || stock-reserved>0)`; low-stock event.
- **CSV/Excel import:** upload → parse → per-row validation preview → "import valid rows" (§5.4.1). Template download.
- **Frontend:** **P18 Menu & pricing** (category panel, item cards with inline availability switch, edit drawer, bulk edit, drag sort), **P19 Inventory** (stock table, reserved, low-stock filter, batch/expiry, quick stepper, movement history), import wizard.
- **Done when:** a grocery store imports 50 products with stock, with an error preview (§17 Phase 1).

### Step 9b — Diagnostics vertical: certified labs & lab tests (added Oct 2026) ✅ registration + catalog + bookings
- **Who:** NABL-accredited pathology labs only — store types `DIAGNOSTIC_LAB`, `DIAGNOSTIC_CHAIN`, `HOSPITAL_LAB` (vertical `DIAGNOSTICS`, flow `LAB_V1`, 11 steps).
- **Required documents:** NABL certificate, clinical establishment registration (KPME in Karnataka), pathologist registration, address proof. Eligibility gate blocks labs without NABL or a pathologist.
- **Pathologist** (`pathologists` table): name, qualification, medical council registration, consent to review and sign every report. Required for LIVE; labs cannot soft-launch.
- **Tests & packages** reuse the catalog (`products` + `lab*` fields): sample type, fasting hours, report time, home collection / walk-in per test, tests included, preparation, and a per-test **doctor's prescription required** flag. CSV template for labs. No stock tracking.
- **Sample collection** (operations): home collection (radius + collection fee) and/or walk-in.
- **Bookings ✅ done (Oct 2026):** `apps/core-api/src/modules/lab-bookings/` — separate from food/pharmacy orders. Flow `BOOKED → [RX_REVIEW] → CONFIRMED → COLLECTOR_ASSIGNED (home) → SAMPLE_COLLECTED (4-digit patient code, 5 tries) → PROCESSING → REPORT_READY`, plus `CANCELLED`/`REJECTED` with refund stub. Pure rules in `lab-booking-state.ts` (unit tested). Hourly IST slots, capacity `maxOrdersPerHour` (default 4). Prescription tests go to RX_REVIEW (owner/manager approves, logs doctor name + reg. no.). Reports: PDF + pathologist + attestation; amendments create a new version with a reason; files only via 5-minute signed links, every open logged (`lab_report_access`); admins must state a purpose.
  - **Partner API** `/v1/partners/stores/:storeId/`: `lab-slots`, `lab-pathologists`, `lab-bookings` (`?tab=TO_CONFIRM|UPCOMING|IN_LAB|REPORTS|CANCELLED|ALL`, create), `lab-bookings/:id/rx-approve|rx-reject|prescription|confirm|reject|collector|collect|processing|reschedule|report-uploads|reports|reports/:reportId/file|report-access`. Dev: `POST /v1/dev/stores/:id/lab-bookings/simulate`. Admin: `/v1/admin/lab-bookings` (list, detail, cancel, report file with purpose, access log).
  - **Web:** Bookings tab for labs (replaces Orders), dashboard tile, live updates on `lab.*` events, desk bookings (walk-in/home), report upload + amend, access log. Tests: `e2e-labbook` 40, `ui-labbook` 21.
  - **Later:** patient-side app screens, real payments/refunds, collector app, address search for desk home bookings (uses the lab's pin today).
- **To confirm with legal/medical advisors:** exact state registration per city (KPME vs Clinical Establishments Act), which tests must require a prescription by policy, report retention period.

### Step 10 — Orders engine, backend (2 weeks) — the core ✅ done (Oct 2026)
> **Built:** `apps/core-api/src/modules/orders/`. Pure transition table `order-state.ts` (unit tests: `pnpm --filter @delivez/core-api test`, 1,920 action×state×actor×fulfilment cases) · `OrderStateService` is the only writer of `orders.status` (row lock → rule → side effects → `order_status_events` → outbox) · `OrderJobsScheduler` (5 s tick: 3-min accept timeout → REJECTED + refund stub; ACCEPTED → PREPARING after 60 s) · stock RESERVE on placement (atomic, no overselling), SALE on handover/pickup, RELEASE on reject/cancel/item removed.
> **Partner API** (`/v1/partners/stores/:storeId/orders`, Idempotency-Key required on actions): `GET ?tab=NEW|PREPARING|READY|DONE|CANCELLED|ALL`, `GET /:idOrNumber` (with timeline), `POST /` (store-created, starts ACCEPTED), `POST /:id/accept|reject|preparing|ready-soon|ready|delay|handover|pickup-complete`, `POST /:id/items/:itemId/unavailable`. The store never receives OTPs.
> **Dev/Admin:** `POST /v1/dev/stores/:id/orders/simulate` (non-prod; `placedSecondsAgo` to test the timeout) · `GET /v1/admin/orders`, `GET /v1/admin/orders/:id` (codes shown in dev), `POST /v1/admin/orders/:id/cancel`, `POST /v1/admin/tasks/:id/assign` (shared test rider), `POST /v1/admin/tasks/:id/status` (play the rider: arrived → waiting if not ready, picked up, en route, delivered, failed).
> **Deferred:** real payments/refunds (stub rows only), maxOrdersPerHour throttling, SLA/penalties. (Pharmacy Rx orders: done — see Step 11b.)
- **State machine** (§10.1): transition table `{from, to, actorRoles, guard, sideEffects}`; only `OrderStateService` writes `orders.status`; every transition writes `order_status_events` + outbox event; invalid transition → 409.
- Endpoints (§13.2): `accept {prepMinutes}`, `reject {reason}`, `preparing`, `ready-soon {window}`, `ready`, `delay {minutes, reason}`, `handover {otp|qr}`, `pickup-complete {pickupOtp}`, `items/:id/unavailable`; `GET /partners/stores/:id/orders?status&cursor`; `GET .../orders/:no`.
- Jobs: 3-min acceptance timeout → REJECTED (+ refund hook stub); auto-PREPARING after 60 s; auto-accept if store setting on.
- Inventory: reserve on PLACED, SALE on PICKED_UP/COMPLETED, release on cancel/reject.
- OTPs (handover / delivery / pickup) generated on PLACED; QR = order id + HMAC(handover OTP).
- **Dispatch stub:** create `delivery_tasks` on accept; admin `POST /admin/tasks/:id/assign` + `update-status` to simulate rider arrived / waiting / picked up so the store screens can be built (§8, manual mode).
- **Dev order simulator:** `POST /dev/stores/:id/orders/simulate` (non-prod only) creating PLACED orders with random items.
- Store-created orders `POST /partners/stores/:id/orders` (channel PARTNER_MANUAL, starts ACCEPTED).
- Realtime: emit to `store:{id}` and `order:{id}` rooms.
- **Done when:** unit tests cover every allowed/disallowed transition; retrying any action with the same Idempotency-Key is a no-op.

### Step 11 — Orders screen, web (1.5 weeks) ✅ done (Oct 2026)
> **Built:** `screens/store/Orders.tsx` (P15 board), `OrderDetail.tsx` (P16 at `/stores/:id/orders/:orderNo`), `NewOrder.tsx`, `lib/orders.ts`. Tabs New / Preparing / Ready / Picked up / Cancelled / All with live counts · NEW cards pulse with a 3-min countdown; a two-tone alarm loops until the order is seen (needs one tap on "Turn on sound" — browser rule) and rings + toasts on any store page · Accept (prep-time chips) / Reject (reasons) · Start preparing, prep stepper, ETA timer, Ready soon 3–5 / 5–10 / 10–15, Delay · **ORDER READY** with 3 checks (bill + prescription copy for Rx) · rider panel + waiting timer · handover code / pickup code (+ cash to collect) · detail: every timestamp, bill, mark item unavailable (optionally switch off on menu), timeline, 58 mm KOT print · store-created orders with catalog picker (variants, qty) · socket events patch the cache, 15 s polling fallback · offline: actions are kept in IndexedDB and replayed with the same Idempotency-Key ("pending sync" chip) · shortcuts A / R. Test: `ui-orders` 39 checks (incl. 800×1280 tablet + phone).
> **Later:** Maps address search for store-created delivery orders (uses the store pin).
> **QR handover ✅ (Oct 2026):** "Scan QR" on READY delivery cards opens the camera (`components/QrScanner.tsx`, jsQR loaded on demand, back camera); no camera → "Scan from a photo"; a USB/Bluetooth scanner gun can type the `DZ1.<orderId>.<hmac>` payload into the code box + Enter. Only Delivez payloads are accepted; the server checks the HMAC (`handoverQr`), 5 wrong tries lock it like the OTP. Admin → Orders shows the QR (dev only) until the rider app exists. Test: `ui-rx` (fake camera, photo, foreign QR, scanner gun).

### Step 11b — Pharmacy prescription queue & pharmacist duty (P17) ✅ done (Oct 2026)
- **Flow:** a customer order with Schedule H/H1 items needs an uploaded prescription (`stores/{id}/rx/…`) and a pharmacist on duty, and starts **AWAITING_RX_REVIEW** (event `order.rx_submitted` → urgent push "Prescription to check" to owner/manager/pharmacist, no medicine names). The pharmacist opens the prescription (5-min signed links, every open in `audit_logs`), may drop items not on it (refunded), then **approves** (doctor name + reg. no. + date ≤ 6 months, attestation) → PLACED with a fresh 3-minute accept clock (`order.rx_approved` rings like a new order), or **rejects** with a reason the customer sees → REJECTED + refund. Not reviewed in 15 min → CANCELLED by the system, prescription EXPIRED, refund. Counter sales of Rx medicines need "a pharmacist checked the paper prescription" and a pharmacist on duty.
- **Who reviews:** a login linked to a pharmacist registration reviews as that pharmacist (must be on duty); owners/managers without one name the on-duty pharmacist who checked it; an unlinked PHARMACIST login is refused until the owner links it.
- **Duty:** weekly shifts (night shifts past midnight allowed) + "Start duty now / End duty / Back to shifts" (manual switch lasts until IST midnight; pharmacists switch only themselves). No pharmacist on duty → no new Rx orders. Pure rules in `modules/pharmacy/duty.ts` (unit tested).
- **API** `/v1/partners/stores/:id/`: `pharmacists` (GET, POST), `pharmacists/:pid/shifts|duty|login`, `DELETE pharmacists/:pid` (owner, never the last one), `orders?tab=RX`, `orders/:orderId/prescription|rx-approve|rx-reject`. Dev: `orders/simulate {rx:'YES'}` writes a sample prescription PDF.
- **Web:** Prescriptions tab for pharmacies (duty panel, live queue with review countdown, review window with inline prescription, reviewed today, pharmacists & shifts manager), banner on Orders, prescription section on order detail, Rx checkbox on store-created orders. All 8 languages. Tests: `e2e-rx` 42, `ui-rx` 26, `duty.spec` 6.
- **Later:** customer-side upload in the Local app, per-item mapping (`prescription_items`) and refills.
- **Frontend:** **P15 Orders** (tabs New / Preparing / Ready-Picked / All / Cancelled), `OrderCard` with state colours from §16.1, pulsing NEW card with 3-min countdown + looping sound until acknowledged, prep stepper, Accept/Reject modal with reasons, Ready Soon (3–5/5–10/10–15), Delay, **ORDER READY** sticky button with 3-check confirmation, rider arrived panel + `WaitingTimer`, handover OTP entry, **P16 Order detail** with timeline.
- Socket subscription that patches TanStack Query cache; 15 s polling fallback; offline action queue in IndexedDB replayed with idempotency keys ("pending sync" chip); keyboard shortcuts (A accept, R ready); KOT print (58 mm) via browser.
- Store-created order form (customer phone, Maps address, catalog picker).
- **Done when:** simulated order goes placed → accepted → ready → handover → picked up with every timestamp visible; works on a 10-inch Android tablet in Chrome.

### Step 11c — Shop tools & ops reports ✅ done (Oct 2026)
- **Expiry alerts:** Inventory → Expiring tab with 30 / 60 / 90-day windows, "Expired" badges and days left, CSV (`GET inventory/expiry.csv?days=`). Daily 09:00 IST push "Stock expiry check" to owner / manager / pharmacist for pharmacies, grocery and local stores (only when something is expired or due in 30 days). `modules/digests/`.
- **End-of-day summary:** push to the owner 15 min after the last closing time today (22:30 without hours; nothing on closed days or days with no orders): orders · sales · missed. One per store per day (KV lock + sent check). Dev: `POST /v1/dev/stores/:id/digests/run {kind: EXPIRY|SUMMARY}`.
- **GST:** `GET reports/invoice/:orderId` → tax invoice (account GSTIN or verified GSTIN document) or bill of supply; prices are GST-inclusive, tax worked back per line, CGST/SGST split, packaging taxed at the highest item rate, delivery shown as Delivez's; FSSAI / drug licence numbers printed. "Print bill" (80 mm) on order detail. `GET reports/gst.csv?month=YYYY-MM` (owner / manager / accountant): one row per bill and rate + summary by rate. Pure maths in `orders/gst.ts` (unit tested). **Ask the CA to confirm** the inclusive-price and packaging assumptions before shops file with it.
- **Grocery substitutes:** `POST orders/:id/items/:itemId/substitute` (grocery / local stores with substitutes on). Replacement stock is held; the customer has 5 minutes (`order_substitutions`); accept → swap on the bill (prepaid: never costs more, difference refunded); decline / no answer → item dropped and refunded, or the order cancelled if it was the only item. "Order ready" waits for the answer. Customer side: Local app; dev: `POST /v1/dev/stores/:id/orders/:orderId/substitutions/:subId/respond`.
- **Help & support (P26):** shops raise requests (`/v1/partners/stores/:id/support/tickets`, optional order number); owners/managers see all outlet requests, other staff their own; admins answer in **Admin → Support** (city-scoped, assign, wait-on-shop / resolve / close). Push both ways; shops see "Delivez support", not the admin's name.
- **Admin Reports:** cities by week (orders, completed, sales, missed %, avg prep, stores with orders; CSV) and **store health** (missed ≥ 10 %, rejected ≥ 15 %, late ≥ 25 % with ≥ 5 orders, or live with no orders) with call links.
- Migration `20261024090000_support_substitutions`. Tests: `e2e-batch3` 58, `ui-batch3` 22, unit (gst, digests, admin-reports).

### Step 11d — Doorstep return window ✅ done (Oct 2026)
- Grocery / local store **deliveries**: on DELIVERED the order gets a **5-minute return window** (`returnWindowEndsAt`); the rider waits while the customer checks the items. Pure rules in `orders/returns-rules.ts` (unit tested).
- Rider (played by ops in **Admin → Orders** until the rider app exists): live timer · **Customer is happy** (`POST /v1/admin/orders/:id/return-window/close`) · **Take back items** (`POST /v1/admin/orders/:id/returns` — qty + reason: damaged / wrong / expired / poor quality / missing). Refund at once: online for prepaid, cash handed back by the rider for COD. The bill (and sales / GST reports, printed bill) drops by the refund; the window closes. Not answered in 5 min → closed as EXPIRED by the order jobs tick.
- Shop: card shows "Customer checking items · 4:12", then "N item(s) coming back with the rider" (push + toast); order detail → **Received — back on shelf** (stock +qty, movement RETURN) or **Received — damaged** (no restock) via `POST /v1/partners/stores/:id/orders/:orderId/returns/:returnId/receive`. Missing items: refunded, nothing comes back.
- Not for restaurants, pharmacies, labs or pickup orders. Migration `20261026090000_order_returns`. Tests: `e2e-returns` 18, `ui-returns` 10, `returns-rules.spec`.
- **Later:** rider app screen with the same timer; customer-side request in the Local app.

### Step L — Customer app (Delivez Local), `apps/local-web` ⏳ L1 + L2 done (Oct 2026)
Mobile-first web app (installable PWA) on port 5175, same design tokens and 8 languages (`lc.*` keys). Customers log in with the same phone + OTP (`app: 'LOCAL'`; a `customers` row is created on first login). Backend: `modules/local/`.
- **L1 ✅ Browse:** pick a location (GPS, map pin, or a saved address; guests can browse with a pin) → shops near you (`GET /v1/local/stores?lat&lng&vertical&q`, public: LIVE / LIMITED only, delivery inside the shop's radius — LIMITED max 2 km — or pickup up to 10 km; open first, then delivering, then nearest; search matches shop names, cuisines and products) → shop page (`GET /v1/local/stores/:idOrSlug?lat&lng`: categories, products, sizes / add-ons, veg mark, MRP discount, "only N left" without exposing stock, Rx / lab details). Profile + saved addresses: `GET|PATCH /v1/local/me`, `GET|POST /v1/local/me/addresses`, `PUT|DELETE /v1/local/me/addresses/:id` (soft delete; first address becomes default; "someone else receives it" contact).
- **L2 ✅ Cart & cash orders:** basket on the device (one shop at a time — a second shop asks to start over), options sheet for sizes / add-ons. `POST /v1/local/cart/quote` re-prices on the server and lists blockers (closed, out of range, below minimum, Rx, lab, changed items). `POST /v1/local/orders` (idempotent; COD / pay at the shop) goes through `OrdersService.create` with channel `LOCAL_WEB` — same stock holds, events, shop alerts and auto-accept as every other order. Order screen: progress steps, the door / counter code, rider call button, cancel until the shop accepts (`POST /v1/local/orders/:id/cancel`), refreshes every 8 s while active. `GET /v1/local/orders`, `GET /v1/local/orders/:idOrNumber`.
- Tests: `e2e-local1` 25, `e2e-local2` 18, `ui-local` 23 (phone-size browser: GPS → browse → cart → login → address → order → live status → Hindi).
- **Next:** L3 live updates over the socket + customer push, re-order · L4 prescription upload, substitute answers, doorstep returns, lab slot booking · L5 Razorpay (online payment), ratings & reviews, help. Domain: `local.delivez.com` in `deploy/frontend/nginx.conf` (change when hosting).

### Step 12 — Notifications (4–5 days) ✅ in-app + push live; SMS/WhatsApp working locally (Oct 2026)
> **SMS / WhatsApp:** `modules/messaging/` — `MessagingService` writes every message to `message_logs` and hands it to the provider chosen by `SMS_PROVIDER` / `WHATSAPP_PROVIDER` (only `DEV` exists: the local "dev phone", shown in Admin → **Messages (dev)**, `GET /v1/admin/dev/messages`, non-production only). Login OTPs go through it (`MessagingOtpSender`). Off-app copies go to the **owner** only: order still waiting at 60 s (SMS) · order missed (SMS) · store status changed (SMS + WhatsApp) · document rejected (WhatsApp) · admin notice (WhatsApp) · staff invite to the invitee (SMS + WhatsApp, with login link). SMS strips emoji (DLT/GSM). Test: `e2e-messaging` 13. **Still needed for real delivery:** MSG91 account + DLT entity/sender/templates, then an `Msg91Provider` implementing `MessageProvider`; WhatsApp BSP + approved templates.
> **Push is live:** `fcm-push-sender.ts` (FCM HTTP v1, self-signed service-account JWT, token cached) is bound as `PushSender`; dead tokens (UNREGISTERED) are deactivated automatically. Verified end to end (`push-e2e`: browser registers → server sends via Firebase → service worker shows it; new-order alert is sticky). **Rotate the service-account key before production** — the current one was shared in a chat.
> **Order alerts for shop owners:** `ORDER_PLACED` push (urgent, sticky) to every order role · `ORDER_REMINDER` after 60 s if still unaccepted → OWNER / MANAGER / PHARMACIST, same tag so it re-rings instead of stacking, once per order (`NotificationsService.remindUnaccepted`, 10 s tick) · "Turn on alerts" banner (`components/AlertsBanner.tsx`) for order/booking roles on LIVE stores, snooze 7 days, explains how to unblock. Test: `push-owner` 9 checks (real FCM).
> **Built:** `apps/core-api/src/modules/notifications/` — `NotificationsService` subscribes to every outbox event and maps it to recipients (partner members by store + role; admins by role + city scope), writes one `notifications` row (IN_APP) per person, pushes to each active `device_tokens` row and emits `notification.created` to `user:{id}`. Deduped by event id (outbox is at-least-once); low-stock limited to one per product per 12 h; store-created orders don't alert. Copy in `templates.ts` (EN / HI / KN, fallback EN) with no customer phones, addresses or health data.
> **Events → alerts:** order placed (urgent, all order roles) · order missed (timeout → owner/manager) · order cancelled by customer/admin · rider arrived · low stock · lab booking created / cancelled (no test names) · document verified / rejected · store status changed · admin notice (all staff) · staff invited · bank verified / failed · admin console: new application (APPROVE_STORES, city-scoped), document re-upload on a running store (VERIFY_DOCUMENTS).
> **API:** `GET /v1/push/config` (public web config) · `GET /v1/me/notifications?before&limit` · `GET /v1/me/notifications/unread-count` · `POST /v1/me/notifications/:id/read` · `POST /v1/me/notifications/read-all` · `POST /v1/me/notifications/test` · `POST|DELETE /v1/me/push-tokens`.
> **Web:** bell + dropdown in the partner header and admin header, P27 page `/stores/:id/notifications` (paging, per-device alerts on/off, "Send a test"), service worker `public/push-sw.js` (draws alerts, new orders stay until tapped, click opens the right page), Firebase JS SDK loaded only when enabling; logout unlinks the device. Tests: `e2e-notify` 18, `ui-notify` 11.
> **To switch on real push:** (1) service-account JSON at `secrets/firebase-service-account.json` (git-ignored); (2) root `.env`: `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_VAPID_KEY`; (3) add the FCM HTTP v1 sender implementing `PushSender` (`push-sender.ts`) and bind it in `notifications.module.ts` — today `LogPushSender` prints pushes to the API log. SMS/WhatsApp still pending (MSG91 + DLT).
- **Backend:** messaging module with template registry, channels PUSH (FCM), SMS (MSG91), IN_APP; consumer mapping events → templates (§14 Partner column); `notifications` rows; `GET /notifications`, mark read.
- **Frontend:** **P27 Notifications** + bell, browser push (service worker) for new orders and document status.
- **Done when:** order.placed rings on a backgrounded browser tab and on the phone (after Step 13).

### Step 13 — Partners mobile app, Expo (2–3 weeks)
- Expo SDK 52 + expo-router, shared `api-client`, `types`, `i18n`, tokens; MMKV-persisted query cache.
- Screens in priority order: login/PIN → account chooser → dashboard toggles → **orders (FlashList, haptics, high-priority notification channel + foreground service for new-order ringing)** → order detail → onboarding wizard with camera capture → catalog quick edit + availability toggles + barcode scan → settings/staff → notifications.
- EAS build (Android first), OTA updates.
- **Done when:** owner can run the store day-to-day from an Android phone; cold start < 2.5 s on a mid-range device.

### Step 14 — Hardening & pilot (1–2 weeks)
- Tests: unit (state machine, readiness, pricing), e2e with Testcontainers (onboarding per flow, order lifecycle, idempotency), Playwright for the Orders journey, access-control matrix per role.
- CI: lint, typecheck, test, `prisma migrate diff`, Docker build; staging deploy (AWS ap-south-1 or a single VM to start), Sentry, uptime checks.
- Swap fake providers for real ones: MSG91, Google Maps, S3, Razorpay X penny-drop.
- Pilot: onboard 10 stores in one zone (§17 Phase 1 deliverable).

### Step 15 — Partner features that depend on later platform phases
Build when the corresponding Core phase lands:

| Screen | Needs |
|--------|-------|
| ~~P17 Prescriptions queue, pharmacist shifts~~ ✅ Step 11b · customer prescription upload, refills | Local app (Phase 2/3) |
| WhatsApp onboarding bot, WhatsApp catalog toggle | WhatsApp Cloud API (Phase 3) |
| P20 Payouts (ledger, settlements, statements) | Finance module (Phase 4) |
| P21 Penalties + explanation page + dispute, SLA health widget | SLA/penalty engine (Phase 4) |
| P22 Reviews, P23 Analytics | Real customer orders (Local, Phase 2) + `store_daily_stats` rollup |
| P26 Support tickets | Support module (small; can be pulled earlier) |
| Real rider data on order cards | Rider app (Phase 5) — UI already built in Step 11 |
| AI prep badge, risk alerts, AI settings | Phase 6 |

---

## Suggested timeline (1 backend + 1 frontend dev, overlapping)

```
Week  1   ██ Steps 1–3 (infra, DB, skeleton)
Week  2   ██ Step 4 auth            | web shell + P01–P03
Week 3–4  ██ Step 5 onboarding API  | Step 6 wizard UI
Week  5   ██ Step 7 admin approvals | Step 8 settings/staff UI
Week 6–7  ██ Step 9 catalog API+UI  | Step 10 orders engine
Week 8–9  ██ Step 11 orders UI      | Step 12 notifications
Week 10–12 █ Step 13 mobile         | Step 14 hardening + pilot
```

## Working rules
- Every step ends with a demo on the seeded Bengaluru data.
- Contract first: change DTOs in `packages/types`, regenerate the API client, then build UI.
- No status written outside its state-machine service; no money as floats (paise `Int`); no PII in logs.
- Definition of done: API documented in OpenAPI, tests, audit coverage, migration reviewed.
