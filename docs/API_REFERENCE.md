# Delivez Core API — full reference

Version 0.1.0 · 279 endpoints · generated from the live Swagger spec (`/docs-json`). Base URL: `https://partners.api.delivez.com` (local: `http://localhost:4000`).

One backend for the Partners app, the customer app (Local), the admin console, hub management and the rider app.

**Login:** `POST /v1/auth/otp/request` → `POST /v1/auth/otp/verify` with `app` (PARTNERS, LOCAL, ADMIN, RIDER or ONE) → use `accessToken` as `Authorization: Bearer …` (Authorize button above). Tokens last 15 min; renew with `POST /v1/auth/refresh`.
Each route says which app's token it accepts; a token from another app gets `403 WRONG_APP`.

**Errors:** `{ "error": { "code", "message", "details" } }`. `400 VALIDATION_FAILED` puts the message for each field in `details.fieldErrors`.

Interactive version: `/docs` on the API (password protected on servers). Import `openapi.json` (next to this file) into Postman: *Import → File*.

## Sections

- [admin](#admin) (73)
- [auth](#auth) (5)
- [i18n](#i18n) (3)
- [health](#health) (1)
- [geo](#geo) (4)
- [files](#files) (3)
- [partners](#partners) (3)
- [onboarding](#onboarding) (11)
- [store settings](#store-settings) (17)
- [admin-account-managers](#admin-account-managers) (16)
- [notifications](#notifications) (8)
- [orders](#orders) (16)
- [reports](#reports) (4)
- [local](#local) (38)
- [lab-bookings](#lab-bookings) (20)
- [pharmacy](#pharmacy) (9)
- [dev](#dev) (1)
- [catalog](#catalog) (22)
- [support](#support) (5)
- [PaymentsWebhook](#paymentswebhook) (1)
- [rider](#rider) (9)
- [admin · riders](#admin-riders) (10)

## admin

### `GET /v1/admin/dev/messages`

**List**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `phone` | query | string |  |  |
| `channel` | query | `SMS` \| `WHATSAPP` |  |  |
| `limit` | query | number |  |  |

### `GET /v1/admin/dashboard`

**Dashboard**

**Access:** Bearer token from the ADMIN app · any admin role.

### `GET /v1/admin/me`

**Me**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR, ACCOUNT_MANAGER.

### `GET /v1/admin/onboarding/pipeline`

**Pipeline**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `DRAFT` \| `SUBMITTED` \| `UNDER_REVIEW` \| `LIVE` \| `LIMITED` \| `PAUSED` \| `SUSPENDED` \| `REJECTED` \| `CLOSED` |  |  |
| `vertical` | query | `EAT` \| `GROCERY` \| `PHARMACY` \| `DIAGNOSTICS` \| `LOCAL_STORES` |  |  |
| `q` | query | string |  |  |

### `GET /v1/admin/stores/{storeId}`

**Store**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `GET /v1/admin/documents`

**Documents**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `PENDING` \| `VERIFIED` \| `REJECTED` \| `EXPIRING` |  |  |

### `GET /v1/admin/documents/by-store`

**Documents by store**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `filter` | query | `NEEDS_REVIEW` \| `MISSING` \| `COMPLETE` \| `ALL` |  |  |
| `vertical` | query | `EAT` \| `GROCERY` \| `PHARMACY` \| `DIAGNOSTICS` \| `LOCAL_STORES` |  |  |
| `q` | query | string |  |  |

### `POST /v1/admin/documents/{id}/verify`

**Verify**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `documentNumber` | string |  | max 40 chars |
| `expiresAt` | string (date-time) |  |  |

### `POST /v1/admin/documents/{id}/reject`

**Reject**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 300 chars |

### `POST /v1/admin/stores/{storeId}/start-review`

**Start review**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/admin/stores/{storeId}/approve-live`

**Approve live**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/approve-limited`

**Approve limited**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/request-changes`

**Request changes**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/reject`

**Reject store**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/suspend`

**Suspend**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/reinstate`

**Reinstate**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/pause`

**Pause**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/resume`

**Resume**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 500 chars |

### `POST /v1/admin/stores/{storeId}/notices`

**Notice**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `message` | string | yes | min 5 chars, max 500 chars |

### `POST /v1/admin/stores/{storeId}/members/{memberId}/access`

**Member access**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `memberId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `isActive` | boolean | yes |  |
| `reason` | string |  | max 300 chars |

### `GET /v1/admin/team`

**Team**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS.

### `POST /v1/admin/team`

**Add admin**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | yes |  |
| `fullName` | string | yes | min 2 chars, max 80 chars |
| `role` | `FOUNDER` \| `HEAD_OF_OPS` \| `REGIONAL_HEAD` \| `CITY_OPS` \| `COMPLIANCE` \| `FINANCE` \| `LEGAL` \| `SUPPORT` \| `SALES_AGENT` \| `AUDITOR` \| `ACCOUNT_MANAGER` | yes |  |
| `cityIds` | string (uuid)[] |  | at most 50 items, default `[]` |

### `PATCH /v1/admin/team/{id}`

**Update admin**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `role` | `FOUNDER` \| `HEAD_OF_OPS` \| `REGIONAL_HEAD` \| `CITY_OPS` \| `COMPLIANCE` \| `FINANCE` \| `LEGAL` \| `SUPPORT` \| `SALES_AGENT` \| `AUDITOR` \| `ACCOUNT_MANAGER` |  |  |
| `cityIds` | string (uuid)[] |  | at most 50 items |
| `isActive` | boolean |  |  |

### `GET /v1/admin/cities`

**Cities**

**Access:** Bearer token from the ADMIN app · any admin role.

### `POST /v1/admin/cities`

**Add city**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 60 chars |
| `state` | string | yes | min 2 chars, max 60 chars |
| `centerLat` | number | yes | ≥ 6, ≤ 37 |
| `centerLng` | number | yes | ≥ 68, ≤ 98 |

### `PATCH /v1/admin/cities/{id}`

**Update city**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `isActive` | boolean |  |  |
| `centerLat` | number |  | ≥ 6, ≤ 37 |
| `centerLng` | number |  | ≥ 68, ≤ 98 |

### `POST /v1/admin/cities/{id}/zones`

**Add zone**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 60 chars |

### `PATCH /v1/admin/zones/{id}`

**Update zone**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `isActive` | boolean |  |  |
| `name` | string |  | min 2 chars, max 60 chars |

### `GET /v1/admin/cities/{id}/pincodes`

**Pincodes**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/cities/{id}/pincodes`

**Upsert pincodes**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `codes` | string \| string[] | yes |  |
| `zoneId` | string (uuid), or null |  |  |
| `serviceable` | boolean |  | default `true` |

### `GET /v1/admin/legal`

**Legal**

**Access:** Bearer token from the ADMIN app · any admin role.

### `POST /v1/admin/legal`

**Publish legal**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, LEGAL.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | `PARTNER_TNC` \| `SLA_TERMS` \| `STATE_RIDER` \| `PENALTY_FRAMEWORK` \| `CUSTOMER_TNC` \| `PRIVACY_POLICY` \| `RX_DECLARATION` \| `WHATSAPP_OPT_IN` | yes |  |
| `version` | string | yes | min 1 chars, max 20 chars |
| `state` | string, or null |  | max 60 chars |
| `contentUrl` | string (uri) | yes | max 500 chars |
| `effectiveFrom` | string (date-time) | yes |  |

### `PATCH /v1/admin/legal/{id}`

**Set legal active**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, LEGAL.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `isActive` | boolean | yes |  |

### `GET /v1/admin/audit`

**Audit**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, COMPLIANCE, LEGAL, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `entity` | query | string |  |  |
| `entityId` | query | string |  |  |
| `actorType` | query | `USER` \| `ADMIN` \| `SYSTEM` \| `AI` |  |  |
| `action` | query | string |  |  |
| `before` | query | string |  |  |
| `limit` | query | number |  |  |

### `POST /v1/admin/orders/{id}/returns`

**Playing the rider at the door (until the rider app exists): items the customer handed back.**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `items` | object[] | yes | at least 1 items, at most 50 items |
| `items[].itemId` | string (uuid) | yes |  |
| `items[].qty` | integer | yes | ≥ 1, ≤ 50 |
| `items[].reason` | `DAMAGED` \| `WRONG_ITEM` \| `EXPIRED` \| `POOR_QUALITY` \| `MISSING` | yes |  |
| `note` | string |  | max 200 chars |

### `POST /v1/admin/orders/{id}/return-window/close`

**"Customer is happy" — the rider leaves.**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `GET /v1/admin/orders`

**List**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | query | string |  |  |
| `status` | query | string |  |  |
| `q` | query | string |  |  |
| `limit` | query | number |  |  |
| `before` | query | string |  |  |

### `GET /v1/admin/orders/{id}`

**Detail**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/orders/{id}/cancel`

**Cancel**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | `OPS_STORE_CANNOT_FULFIL` \| `OPS_NO_RIDER` \| `OPS_PLATFORM_ISSUE` \| `OPS_CUSTOMER_REQUEST` \| `OPS_DUPLICATE_ORDER` \| `OPS_FORCE_MAJEURE` | yes |  |
| `note` | string |  | max 300 chars |

### `POST /v1/admin/tasks/{id}/assign`

**Assign**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/tasks/{id}/status`

**Step**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | `EN_ROUTE_TO_PICKUP` \| `ARRIVED_AT_PICKUP` \| `PICKED_UP` \| `EN_ROUTE_TO_DROP` \| `ARRIVED_AT_DROP` \| `DELIVERED` \| `FAILED` | yes |  |
| `reason` | string |  | max 200 chars |
| `code` | `FAIL_CUSTOMER_UNAVAILABLE` \| `FAIL_CUSTOMER_REFUSED` \| `FAIL_WRONG_ADDRESS` \| `FAIL_RIDER_ISSUE` \| `FAIL_DAMAGED_IN_TRANSIT` \| `FAIL_FORCE_MAJEURE` |  |  |

### `GET /v1/admin/ops/board`

**Board**

**Access:** Bearer token from the ADMIN app · any admin role.

### `POST /v1/admin/ops/alerts/{id}/ack`

**Ack**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `action` | `VIEWED` \| `CALLED_STORE` \| `CALLED_RIDER` \| `PREP_UPDATED` \| `ESCALATED` \| `RIDER_SWAPPED` \| `APOLOGY_SENT` |  |  |

### `POST /v1/admin/ops/alerts/ack-all`

**Ack all**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

### `POST /v1/admin/ops/alerts/{id}/resolve`

**Resolve**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string |  | max 300 chars |

### `GET /v1/admin/ops/alerts/log`

**Log**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `from` | query | string |  |  |
| `level` | query | `LIKELY` \| `BREACHED` |  |  |
| `limit` | query | number |  |  |

### `POST /v1/admin/ops/orders/{id}/prep`

**Prep**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `minutes` | integer | yes | ≥ 1, ≤ 60 |
| `reason` | string |  | min 2 chars, max 200 chars, default `"Updated by Delivez ops"` |

### `POST /v1/admin/ops/orders/{id}/escalate`

**Escalate**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string |  | max 300 chars |

### `POST /v1/admin/ops/orders/{id}/apology`

**Apology**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/ops/tasks/{id}/release`

**Release**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `GET /v1/admin/ops/riders`

**Riders**

**Access:** Bearer token from the ADMIN app · any admin role.

### `POST /v1/admin/ops/riders/{id}/pause`

**Pause**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/ops/riders/{id}/resume`

**Resume**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/ops/riders/{id}/reassign`

**Reassign**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `mode` | `ALL` \| `ONE` |  | default `"ALL"` |

### `GET /v1/admin/coupons`

**List**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `LIVE` \| `SCHEDULED` \| `ENDED` \| `PAUSED` |  |  |

### `POST /v1/admin/coupons`

**Create**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, FINANCE.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | string | yes | min 3 chars, max 20 chars, pattern `^[A-Za-z0-9]+$` |
| `description` | string, or null |  | max 120 chars |
| `discountType` | `FLAT` \| `PERCENT` \| `FREE_DELIVERY` | yes |  |
| `discountValue` | integer | yes | ≥ 0, ≤ 10000000 |
| `maxDiscount` | integer, or null |  | ≥ 0, ≤ 10000000 |
| `minOrder` | integer |  | ≥ 0, ≤ 10000000, default `0` |
| `vertical` | `EAT` \| `GROCERY` \| `PHARMACY` \| `LOCAL_STORES` |  |  |
| `storeId` | string (uuid), or null |  |  |
| `cityId` | string (uuid), or null |  |  |
| `usageLimit` | integer, or null |  | ≥ 1, ≤ 1000000 |
| `perUserLimit` | integer |  | ≥ 1, ≤ 50, default `1` |
| `firstOrderOnly` | boolean |  | default `false` |
| `isPublic` | boolean |  | default `true` |
| `startsAt` | string (date-time) | yes |  |
| `endsAt` | string (date-time) | yes |  |
| `isActive` | boolean |  |  |

### `PATCH /v1/admin/coupons/{id}`

**Update**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, FINANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `code` | string |  | min 3 chars, max 20 chars, pattern `^[A-Za-z0-9]+$` |
| `description` | string, or null |  | max 120 chars |
| `discountType` | `FLAT` \| `PERCENT` \| `FREE_DELIVERY` |  |  |
| `discountValue` | integer |  | ≥ 0, ≤ 10000000 |
| `maxDiscount` | integer, or null |  | ≥ 0, ≤ 10000000 |
| `minOrder` | integer |  | ≥ 0, ≤ 10000000, default `0` |
| `vertical` | `EAT` \| `GROCERY` \| `PHARMACY` \| `LOCAL_STORES` |  |  |
| `storeId` | string (uuid), or null |  |  |
| `cityId` | string (uuid), or null |  |  |
| `usageLimit` | integer, or null |  | ≥ 1, ≤ 1000000 |
| `perUserLimit` | integer |  | ≥ 1, ≤ 50, default `1` |
| `firstOrderOnly` | boolean |  | default `false` |
| `isPublic` | boolean |  | default `true` |
| `startsAt` | string (date-time) |  |  |
| `endsAt` | string (date-time) |  |  |
| `isActive` | boolean |  |  |

### `GET /v1/admin/coupons/{id}/redemptions`

**Redemptions**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `GET /v1/admin/lab-bookings`

**List**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | query | string |  |  |
| `status` | query | string |  |  |
| `q` | query | string |  |  |
| `limit` | query | number |  |  |

### `GET /v1/admin/lab-bookings/{id}`

**Detail**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/lab-bookings/{id}/cancel`

**Cancel**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 300 chars |

### `GET /v1/admin/lab-bookings/{id}/reports/{reportId}/file`

**Health data: admins must state a purpose; the open is logged.**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, COMPLIANCE, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `reportId` | path | string | yes |  |
| `purpose` | query | string | yes |  |

### `GET /v1/admin/lab-bookings/{id}/report-access`

**Access log**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, COMPLIANCE, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `GET /v1/admin/support/tickets`

**List**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `ACTIVE` \| `ALL` \| `OPEN` \| `IN_PROGRESS` \| `WAITING_ON_USER` \| `RESOLVED` \| `CLOSED` |  |  |
| `q` | query | string |  |  |

### `GET /v1/admin/support/tickets/{id}`

**Get**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/support/tickets/{id}/messages`

**Reply**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `body` | string | yes | min 1 chars, max 2000 chars |
| `status` | `WAITING_ON_USER` \| `RESOLVED` \| `IN_PROGRESS` |  | default `"WAITING_ON_USER"` |

### `POST /v1/admin/support/tickets/{id}/status`

**Status**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `status` | `OPEN` \| `IN_PROGRESS` \| `WAITING_ON_USER` \| `RESOLVED` \| `CLOSED` | yes |  |

### `POST /v1/admin/support/tickets/{id}/assign`

**Assign**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, SUPPORT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `GET /v1/admin/reports/cities`

**Cities**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `weeks` | query | string |  |  |

### `GET /v1/admin/reports/cities.csv`

**Cities csv**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `weeks` | query | string |  |  |

### `GET /v1/admin/reports/store-health`

**Health**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE, FINANCE, LEGAL, SUPPORT, AUDITOR.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `days` | query | string |  |  |

### `GET /v1/admin/system/status`

**Status**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS.

### `POST /v1/admin/system/push-check`

**Asks Google for an access token with the Firebase key: proves key, server clock and network — sends no message.**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS.

## auth

### `POST /v1/auth/otp/request`

**Request otp**

**Access:** public, no login.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | yes |  |
| `purpose` | `LOGIN` \| `ONBOARDING` |  | default `"LOGIN"` |
| `channel` | `SMS` \| `WHATSAPP` |  | default `"SMS"` |

### `POST /v1/auth/otp/verify`

**Verify otp**

**Access:** public, no login.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `requestId` | string (uuid) | yes |  |
| `code` | string | yes | pattern `^\d{6}$` |
| `app` | `PARTNERS` \| `LOCAL` \| `ADMIN` \| `RIDER` \| `ONE` | yes |  |
| `device` | object |  |  |

### `POST /v1/auth/refresh`

**Refresh**

**Access:** public, no login.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `refreshToken` | string | yes | min 10 chars |

### `POST /v1/auth/logout`

**Logout**

**Access:** Bearer token from any app.

### `POST /v1/auth/logout-all`

**"Sign out everywhere": ends this user's sessions on every device of the same app (this one included).**

**Access:** Bearer token from any app.

## i18n

### `GET /v1/i18n/languages`

**Languages**

**Access:** public, no login.

### `GET /v1/i18n/{code}`

**Translation bundle. Cached by the browser; the version changes whenever the text does.**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `code` | path | string | yes |  |

### `PUT /v1/me/language`

**Saves the signed-in user's language so it follows them to every device and app.**

**Access:** Bearer token from any app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `language` | `EN` \| `HI` \| `KN` \| `TA` \| `TE` \| `ML` \| `MR` \| `BN` | yes |  |

## health

### `GET /v1/health`

**Check**

**Access:** public, no login.

## geo

### `GET /v1/geo/cities`

**Cities**

**Access:** public, no login.

### `GET /v1/geo/pincodes/{code}`

**Pincode**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `code` | path | string | yes |  |

### `GET /v1/geo/search`

**Search**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `q` | query | string | yes |  |

### `GET /v1/geo/reverse`

**Reverse**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `lat` | query | number | yes |  |
| `lng` | query | number | yes |  |

## files

### `PUT /v1/files/upload`

**Upload**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `token` | query | string | yes |  |

### `GET /v1/files/public/stores/{storeId}/products/{file}`

**Product images are public (customers see them); only keys under stores/{uuid}/products/ qualify.**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `file` | path | string | yes |  |

### `GET /v1/files/raw`

**Raw**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `token` | query | string | yes |  |

## partners

### `GET /v1/partners/me`

**Memberships, stores and legal versions the user still has to accept (plan §13.2).**

**Access:** Bearer token from the PARTNERS app.

### `GET /v1/partners/stores/{storeId}`

**Store**

**Access:** Bearer token from the PARTNERS app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `PUT /v1/partners/stores/{storeId}/open-state`

**Open / Busy / Closed toggle (plan §5.5).**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `openState` | `OPEN` \| `BUSY` \| `CLOSED` | yes |  |
| `reason` | string |  | max 200 chars |

## onboarding

### `POST /v1/partners/onboarding`

**Start a new store registration (also used by owners adding another outlet).**

**Access:** Bearer token from the PARTNERS app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeType` | `RESTAURANT` \| `CLOUD_KITCHEN` \| `SUPERMARKET` \| `KIRANA` \| `GROCERY` \| `PHARMACY_RETAIL` \| `PHARMACY_CHAIN` \| `PHARMACY_HOSPITAL` \| `DIAGNOSTIC_LAB` \| `DIAGNOSTIC_CHAIN` \| `HOSPITAL_LAB` \| `BAKERY` \| `MEAT_FISH` \| `FLOWER` \| `ELECTRONICS` \| `CLOTHING` \| `BEAUTY_WELLNESS` \| `HOUSEHOLD_LIFESTYLE` \| `BABY_CARE` \| `PET_CARE` \| `PRINTING` \| `STREET_VENDOR` \| `SOCIETY_VENDOR` \| `OTHER` | yes |  |
| `businessName` | string | yes | min 2 chars, max 80 chars |
| `channel` | `WEB` \| `MOBILE` |  | default `"WEB"` |
| `referralCode` | string |  | max 40 chars |

### `GET /v1/partners/stores/{storeId}/onboarding`

**View**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `PATCH /v1/partners/stores/{storeId}/onboarding/steps/{step}`

**Save step**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `step` | path | `ELIGIBILITY` \| `BASIC_DETAILS` \| `OUTLET` \| `DOCUMENTS` \| `PHARMACIST` \| `PATHOLOGIST` \| `CATALOG` \| `OPERATIONS` \| `BANK` \| `COMMERCIALS` \| `LEGAL` \| `TRAINING` \| `REVIEW` | yes |  |

**Body** — The body depends on :step, one of these (each titled with its step).

*ELIGIBILITY*

| Field | Type | Required | Rules |
|---|---|---|---|
| `pincode` | string | yes | pattern `^\d{6}$` |
| `hoursPerDay` | number | yes | ≥ 0, ≤ 24 |
| `homeDelivery` | boolean | yes |  |
| `hasDrugLicense` | boolean |  |  |
| `hasPharmacist` | boolean |  |  |
| `hasNablAccreditation` | boolean |  |  |
| `hasPathologist` | boolean |  |  |

*BASIC_DETAILS*

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeName` | string | yes | min 2 chars, max 80 chars |
| `ownerName` | string | yes | min 2 chars, max 80 chars |
| `legalName` | string |  | max 120 chars |
| `partnerType` | `INDIVIDUAL` \| `PROPRIETORSHIP` \| `PARTNERSHIP` \| `PVT_LTD` \| `LLP` \| `OTHER` |  |  |
| `email` | string (email) \| `` |  |  |
| `whatsappPhone` | string |  | max 15 chars |
| `gstin` | string \| `` |  |  |
| `cuisines` | string[] |  | at most 10 items |
| `description` | string |  | max 300 chars |

*OUTLET*

| Field | Type | Required | Rules |
|---|---|---|---|
| `addressLine1` | string | yes | min 5 chars, max 160 chars |
| `addressLine2` | string |  | max 160 chars |
| `landmark` | string |  | max 120 chars |
| `pincode` | string | yes | pattern `^\d{6}$` |
| `lat` | number | yes | ≥ 6, ≤ 38 |
| `lng` | number | yes | ≥ 68, ≤ 98 |
| `placeId` | string |  | max 200 chars |
| `timings` | object[] | yes | at least 1 items, at most 21 items |
| `timings[].dayOfWeek` | integer | yes | ≥ 0, ≤ 6 |
| `timings[].opensAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `timings[].closesAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `seatingType` | `DINE_IN` \| `TAKEAWAY` \| `CLOUD` |  |  |

*DOCUMENTS*

_(no fields)_

*PHARMACIST*

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 80 chars |
| `registrationNo` | string | yes | min 3 chars, max 40 chars |
| `stateCouncil` | string | yes | min 2 chars, max 80 chars |
| `shifts` | object[] | yes | at least 1 items, at most 21 items |
| `shifts[].dayOfWeek` | integer | yes | ≥ 0, ≤ 6 |
| `shifts[].startsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `shifts[].endsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `consent` | `true` | yes |  |

*PATHOLOGIST*

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 80 chars |
| `qualification` | string | yes | min 2 chars, max 80 chars |
| `registrationNo` | string | yes | min 3 chars, max 40 chars |
| `stateCouncil` | string | yes | min 2 chars, max 80 chars |
| `consent` | `true` | yes |  |

*CATALOG*

| Field | Type | Required | Rules |
|---|---|---|---|
| `items` | object[] |  | at most 200 items, default `[]` |
| `items[].name` | string |  | min 2 chars, max 120 chars |
| `items[].price` | integer |  | > 0, ≤ 10000000 |
| `items[].mrp` | integer |  | > 0, ≤ 10000000 |
| `items[].category` | string |  | max 60 chars |
| `items[].isVeg` | boolean |  |  |
| `items[].unit` | string |  | max 20 chars |
| `items[].stock` | integer |  | ≥ 0, ≤ 1000000 |
| `items[].prescriptionRequired` | boolean |  |  |
| `items[].drugSchedule` | `NONE` \| `OTC` \| `H` \| `H1` \| `X` |  |  |
| `items[].sampleType` | `BLOOD` \| `URINE` \| `STOOL` \| `SWAB` \| `SALIVA` \| `OTHER` |  |  |
| `items[].fastingHours` | integer |  | ≥ 0, ≤ 24 |
| `items[].reportHours` | integer |  | ≥ 1, ≤ 720 |
| `items[].homeCollection` | boolean |  |  |
| `items[].walkIn` | boolean |  |  |
| `items[].parameters` | integer |  | ≥ 1, ≤ 500 |

*OPERATIONS*

| Field | Type | Required | Rules |
|---|---|---|---|
| `defaultPrepMinutes` | integer | yes | ≥ 5, ≤ 90 |
| `peakPrepMinutes` | integer | yes | ≥ 5, ≤ 120 |
| `aiPrepEnabled` | boolean |  | default `true` |
| `supportsDelivery` | boolean | yes |  |
| `supportsPickup` | boolean | yes |  |
| `deliveryRadiusKm` | number | yes | ≥ 1, ≤ 15 |
| `acceptMultipleOrders` | boolean |  |  |
| `allowSubstitutions` | boolean |  |  |
| `maxOrdersPerHour` | integer, or null |  | ≥ 1, ≤ 500 |
| `autoPauseOverloaded` | boolean |  |  |
| `packagingFee` | integer |  | ≥ 0, ≤ 10000 |
| `collectionFee` | integer |  | ≥ 0, ≤ 100000 |
| `allowGenericSubstitution` | boolean |  |  |
| `contactIfRxUnclear` | boolean |  |  |
| `selfPackagingConfirmed` | boolean |  |  |

*BANK*

_(no fields)_

*COMMERCIALS*

| Field | Type | Required | Rules |
|---|---|---|---|
| `acknowledged` | `true` | yes |  |

*LEGAL*

| Field | Type | Required | Rules |
|---|---|---|---|
| `acceptedDocIds` | string (uuid)[] | yes | at least 1 items |

*TRAINING*

| Field | Type | Required | Rules |
|---|---|---|---|
| `videoWatched` | boolean | yes |  |
| `practiceOrderDone` | boolean | yes |  |
| `quizAnswers` | integer[] |  |  |

*REVIEW*

_(no fields)_

### `POST /v1/partners/stores/{storeId}/onboarding/steps/{step}/skip`

**Skip step**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `step` | path | `PHARMACIST` \| `LEGAL` \| `ELIGIBILITY` \| `BASIC_DETAILS` \| `OUTLET` \| `DOCUMENTS` \| `PATHOLOGIST` \| `CATALOG` \| `OPERATIONS` \| `BANK` \| `COMMERCIALS` \| `TRAINING` \| `REVIEW` | yes |  |

### `POST /v1/partners/stores/{storeId}/onboarding/submit`

**Submit**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `DELETE /v1/partners/stores/{storeId}/onboarding/products/{productId}`

**Remove product**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `productId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/uploads`

**Presign**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `contentType` | string | yes | max 100 chars |
| `size` | integer | yes | > 0 |

### `POST /v1/partners/stores/{storeId}/documents`

**Register document**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | `FSSAI` \| `GSTIN` \| `PAN` \| `DRUG_LICENSE_DL20` \| `DRUG_LICENSE_DL21` \| `PHARMACIST_REGISTRATION` \| `ADDRESS_PROOF` \| `BANK_PROOF` \| `NABL_CERTIFICATE` \| `CLINICAL_ESTABLISHMENT_REG` \| `PATHOLOGIST_REGISTRATION` \| `SHOP_ESTABLISHMENT` \| `TRADE_LICENSE` \| `LANDMARK_PHOTO` \| `OTHER` | yes |  |
| `fileKey` | string | yes | min 10 chars, max 300 chars |
| `documentNumber` | string |  | max 40 chars |
| `issuedAt` | string (date-time) |  |  |
| `expiresAt` | string (date-time) |  |  |
| `reading` | object |  |  |
| `reading.method` | `pdf-text` \| `ocr` |  |  |
| `reading.documentNumber` | string, or null |  | max 40 chars |
| `reading.issuedAt` | string, or null |  | pattern `^\d{4}-\d{2}-\d{2}$` |
| `reading.expiresAt` | string, or null |  | pattern `^\d{4}-\d{2}-\d{2}$` |
| `reading.confidence` | `HIGH` \| `LOW` \| `NONE` |  |  |
| `reading.engineConfidence` | number, or null |  | ≥ 0, ≤ 100 |

### `GET /v1/partners/stores/{storeId}/documents`

**List documents**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/ifsc/{code}`

**Ifsc lookup**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `code` | path | string | yes |  |

### `PUT /v1/partners/stores/{storeId}/bank-account`

**Save bank**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `accountHolderName` | string | yes | min 2 chars, max 120 chars |
| `accountNumber` | string \| `` |  |  |
| `confirmAccountNumber` | string |  |  |
| `ifsc` | string \| `` |  |  |
| `bankName` | string |  | max 80 chars |
| `upiId` | string \| `` |  |  |

## store settings

### `GET /v1/partners/stores/{storeId}/bank-account`

**Bank**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/settings`

**Get settings**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `PATCH /v1/partners/stores/{storeId}/settings`

**Update settings**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `description` | string, or null |  | max 300 chars |
| `cuisines` | string[] |  | at most 10 items |
| `whatsappPhone` | string, or null |  | max 15 chars |
| `email` | string (email), or null \| `` |  |  |
| `logoUrl` | string, or null |  | max 500 chars |
| `coverUrl` | string, or null |  | max 500 chars |
| `supportsDelivery` | boolean |  |  |
| `supportsPickup` | boolean |  |  |
| `deliveryRadiusKm` | number |  | ≥ 1, ≤ 15 |
| `expressEnabled` | boolean |  |  |
| `defaultPrepMinutes` | integer |  | ≥ 5, ≤ 90 |
| `peakPrepMinutes` | integer |  | ≥ 5, ≤ 120 |
| `acceptMultipleOrders` | boolean |  |  |
| `allowSubstitutions` | boolean |  |  |
| `maxOrdersPerHour` | integer, or null |  | ≥ 1, ≤ 500 |
| `autoPauseOverloaded` | boolean |  |  |
| `autoAcceptOrders` | boolean |  |  |
| `minOrderAmount` | integer |  | ≥ 0, ≤ 1000000 |
| `packagingFee` | integer |  | ≥ 0, ≤ 10000 |
| `collectionFee` | integer |  | ≥ 0, ≤ 100000 |
| `aiPrepEnabled` | boolean |  |  |
| `aiAlertsEnabled` | boolean |  |  |
| `aiAutoExtendEta` | boolean |  |  |
| `aiMenuAutoPause` | boolean |  |  |
| `aiAggressiveness` | integer |  | ≥ 0, ≤ 100 |
| `allowGenericSubstitution` | boolean |  |  |
| `contactIfRxUnclear` | boolean |  |  |

### `PUT /v1/partners/stores/{storeId}/timings`

**Timings**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `timings` | object[] | yes | at most 28 items |
| `timings[].dayOfWeek` | integer | yes | ≥ 0, ≤ 6 |
| `timings[].opensAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `timings[].closesAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |

### `POST /v1/partners/stores/{storeId}/holidays`

**Add holiday**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `date` | string | yes | pattern `^\d{4}-\d{2}-\d{2}$` |
| `reason` | string |  | max 120 chars |

### `DELETE /v1/partners/stores/{storeId}/holidays/{holidayId}`

**Remove holiday**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `holidayId` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/legal`

**Legal**

**Access:** Bearer token from the PARTNERS app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/legal/accept`

**Accept legal**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `acceptedDocIds` | string (uuid)[] | yes | at least 1 items |

### `GET /v1/partners/stores/{storeId}/staff`

**List staff**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/staff`

**Invite**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `phone` | string | yes |  |
| `name` | string |  | min 2 chars, max 80 chars |
| `role` | `MANAGER` \| `KITCHEN_LEAD` \| `COUNTER_STAFF` \| `PHARMACIST` \| `ACCOUNTANT` | yes |  |
| `storeIds` | string (uuid)[] |  | at most 50 items |

### `PATCH /v1/partners/stores/{storeId}/staff/{memberId}`

**Update member**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `memberId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `role` | `MANAGER` \| `KITCHEN_LEAD` \| `COUNTER_STAFF` \| `PHARMACIST` \| `ACCOUNTANT` |  |  |
| `storeIds` | string (uuid)[] |  | at most 50 items |
| `isActive` | boolean |  |  |

### `DELETE /v1/partners/stores/{storeId}/staff/{memberId}`

**Remove member**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `memberId` | path | string | yes |  |

### `PUT /v1/partners/stores/{storeId}/staff/me/pin`

**Any team member sets their own 4-digit PIN for shared tablets.**

**Access:** Bearer token from the PARTNERS app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `pin` | string | yes | pattern `^\d{4}$` |

### `GET /v1/partners/stores/{storeId}/pin-switch`

**Switchable**

**Access:** Bearer token from the PARTNERS app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/pin-switch`

**Pin switch**

**Access:** Bearer token from the PARTNERS app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `memberId` | string (uuid) | yes |  |
| `pin` | string | yes | pattern `^\d{4}$` |

### `GET /v1/partners/stores/{storeId}/reviews`

**List reviews**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `filter` | query | `ALL` \| `UNREPLIED` \| `LOW` |  |  |
| `before` | query | string |  |  |
| `limit` | query | number |  |  |

### `POST /v1/partners/stores/{storeId}/reviews/{reviewId}/reply`

**Reply review**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `reviewId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reply` | string | yes | min 2 chars, max 500 chars |

## admin-account-managers

### `GET /v1/admin/am/home`

**Home**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

### `GET /v1/admin/am/stores`

**Stores**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `sort` | query | `risk` \| `sla` \| `orders` \| `name` |  |  |

### `GET /v1/admin/am/stores/{storeId}`

**Store**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/admin/am/stores/{storeId}/log`

**Log**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | `CALL` \| `WHATSAPP` \| `NOTE` \| `VISIT` | yes |  |
| `note` | string |  | max 1000 chars |
| `clientId` | string (uuid) |  |  |
| `at` | string (date-time) |  |  |

### `PUT /v1/admin/am/stores/{storeId}/prep`

**Prep**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `minutes` | integer | yes |  |
| `reason` | string |  | max 200 chars |

### `POST /v1/admin/am/stores/{storeId}/apply`

**Apply**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | `PREP_UP` \| `PREP_DOWN` \| `ESCALATE_RIDERS` \| `VISIT` \| `CALL_COMPLAINTS` \| `CALL_REJECTIONS` | yes |  |

### `POST /v1/admin/am/stores/{storeId}/test-order`

**Test order**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `GET /v1/admin/am/tasks`

**Tasks**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `tab` | query | `today` \| `overdue` \| `upcoming` \| `done` |  |  |

### `POST /v1/admin/am/tasks`

**Add task**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeId` | string (uuid) | yes |  |
| `kind` | `CALL` \| `VISIT` \| `TEST_ORDER` \| `FOLLOW_UP` | yes |  |
| `title` | string | yes | min 2 chars, max 140 chars |
| `priority` | `HIGH` \| `MEDIUM` \| `LOW` |  | default `"MEDIUM"` |
| `dueAt` | string (date-time) | yes |  |

### `POST /v1/admin/am/tasks/{id}/done`

**Done**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string |  | max 500 chars |

### `GET /v1/admin/am/issues`

**Issues**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `open` \| `resolved` |  |  |
| `limit` | query | number |  |  |

### `POST /v1/admin/am/issues/{id}/escalate`

**Escalate**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string |  | max 500 chars |

### `POST /v1/admin/am/issues/{id}/resolve`

**Resolve**

**Access:** Bearer token from the ADMIN app · admin roles: ACCOUNT_MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `note` | string |  | max 500 chars |

### `GET /v1/admin/account-managers`

**Managers**

**Access:** Bearer token from the ADMIN app · any admin role.

### `PUT /v1/admin/stores/{storeId}/account-manager`

**Assign**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `accountManagerId` | string (uuid), or null | yes |  |

### `POST /v1/admin/am/dev/health-check`

**Dev only: run the hourly churn / order-drop check now.**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS.

## notifications

### `GET /v1/push/config`

**Public Firebase web config (these values are meant to be public) so browsers can register for push.**

**Access:** public, no login.

### `GET /v1/me/notifications`

**List**

**Access:** Bearer token from any app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `before` | query | string |  |  |
| `limit` | query | number |  |  |

### `GET /v1/me/notifications/unread-count`

**Unread**

**Access:** Bearer token from any app.

### `POST /v1/me/notifications/read-all`

**Read all**

**Access:** Bearer token from any app.

### `POST /v1/me/notifications/test`

**Test**

**Access:** Bearer token from any app.

### `POST /v1/me/notifications/{id}/read`

**Read**

**Access:** Bearer token from any app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/me/push-tokens`

**Register**

**Access:** Bearer token from any app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | min 20 chars, max 4096 chars |
| `platform` | `WEB` \| `ANDROID` \| `IOS` | yes |  |

### `DELETE /v1/me/push-tokens`

**Remove**

**Access:** Bearer token from any app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | min 20 chars, max 4096 chars |

## orders

### `GET /v1/partners/stores/{storeId}/orders`

**List**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `tab` | query | `RX` \| `NEW` \| `PREPARING` \| `READY` \| `DONE` \| `CANCELLED` \| `ALL` |  |  |
| `cursor` | query | string |  |  |
| `limit` | query | number |  |  |

### `POST /v1/partners/stores/{storeId}/orders`

**Phone / walk-in orders the store enters itself (channel PARTNER_MANUAL, starts accepted).**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `customer` | object | yes |  |
| `customer.phone` | string | yes |  |
| `customer.name` | string |  | min 2 chars, max 80 chars |
| `fulfilmentType` | `DELIVERY` \| `PICKUP` | yes |  |
| `address` | object |  |  |
| `address.line1` | string |  | min 3 chars, max 160 chars |
| `address.landmark` | string |  | max 120 chars |
| `address.pincode` | string |  | pattern `^\d{6}$` |
| `address.lat` | number |  | ≥ 6, ≤ 38 |
| `address.lng` | number |  | ≥ 68, ≤ 98 |
| `items` | object[] | yes | at least 1 items, at most 50 items |
| `items[].productId` | string (uuid) | yes |  |
| `items[].qty` | integer | yes | ≥ 1, ≤ 50 |
| `items[].variantId` | string (uuid) |  |  |
| `items[].addonIds` | string (uuid)[] |  | at most 20 items |
| `paymentMode` | `COD` \| `UPI` | yes |  |
| `prepMinutes` | integer |  | ≥ 5, ≤ 120 |
| `note` | string |  | max 300 chars |
| `rxSeenByStore` | boolean |  |  |

### `GET /v1/partners/stores/{storeId}/orders/{idOrNumber}`

**Detail**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `idOrNumber` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/accept`

**Accept**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `prepMinutes` | integer |  | ≥ 5, ≤ 120 |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/reject`

**Reject**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | `ITEMS_UNAVAILABLE` \| `TOO_BUSY` \| `STORE_CLOSING` \| `KITCHEN_ISSUE` \| `OTHER` | yes |  |
| `note` | string |  | max 200 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/preparing`

**Preparing**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/ready-soon`

**Ready soon**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `windowMinutes` | `5` \| `10` \| `15` | yes |  |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/ready`

**Ready**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/delay`

**Delay**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `minutes` | integer | yes | ≥ 5, ≤ 30 |
| `reason` | string | yes | min 3 chars, max 200 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/handover`

**Handover**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `otp` | string |  | pattern `^\d{4}$` |
| `qr` | string |  | max 200 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/pickup-complete`

**Pickup**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `otp` | string | yes | pattern `^\d{4}$` |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/items/{itemId}/unavailable`

**Unavailable**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `itemId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `switchOff` | boolean |  | default `false` |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/items/{itemId}/substitute`

**Grocery: offer a replacement for an item that ran out; the customer has 5 minutes to answer.**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `itemId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `productId` | string (uuid) | yes |  |
| `variantId` | string (uuid) |  |  |
| `qty` | integer | yes | ≥ 1, ≤ 50 |
| `note` | string |  | max 200 chars |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/returns/{returnId}/receive`

**Returned items are back at the shop: on the shelf again, or damaged.**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `returnId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `restock` | boolean | yes |  |

### `POST /v1/dev/stores/{storeId}/orders/{orderId}/substitutions/{subId}/respond`

**Plays the customer answering a substitute until the Local app exists.**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `subId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `accept` | boolean | yes |  |

### `POST /v1/dev/stores/{storeId}/orders/simulate`

**Simulate**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `count` | integer |  | ≥ 1, ≤ 5, default `1` |
| `fulfilment` | `DELIVERY` \| `PICKUP` \| `ANY` |  | default `"ANY"` |
| `payment` | `COD` \| `UPI` \| `ANY` |  | default `"ANY"` |
| `placedSecondsAgo` | integer |  | ≥ 0, ≤ 1200, default `0` |
| `rx` | `YES` \| `NO` |  | default `"NO"` |

## reports

### `GET /v1/partners/stores/{storeId}/reports/summary`

**Summary**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `days` | query | string |  |  |

### `GET /v1/partners/stores/{storeId}/reports/orders.csv`

**Csv**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `from` | query | string | yes |  |
| `to` | query | string | yes |  |

### `GET /v1/partners/stores/{storeId}/reports/gst.csv`

**Gst**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `month` | query | string | yes |  |

### `GET /v1/partners/stores/{storeId}/reports/invoice/{orderId}`

**Invoice**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |

## local

### `GET /v1/local/offers`

**List**

**Access:** public, no login.

### `GET /v1/local/overview`

**Get**

**Access:** public, no login.

### `GET /v1/local/serviceable/{pincode}`

**Serviceable**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `pincode` | path | string | yes |  |

### `GET /v1/local/stores`

**Nearby**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `lat` | query | number | yes |  |
| `lng` | query | number | yes |  |
| `vertical` | query | `EAT` \| `GROCERY` \| `PHARMACY` \| `DIAGNOSTICS` \| `LOCAL_STORES` |  |  |
| `q` | query | string |  |  |
| `all` | query | `1` \| `true` |  |  |

### `GET /v1/local/stores/{idOrSlug}/lab-slots`

**Lab slots**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `idOrSlug` | path | string | yes |  |
| `date` | query | string | yes |  |
| `type` | query | `HOME` \| `WALK_IN` | yes |  |

### `GET /v1/local/stores/{idOrSlug}`

**Menu**

**Access:** public, no login.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `idOrSlug` | path | string | yes |  |
| `lat` | query | number |  |  |
| `lng` | query | number |  |  |

### `GET /v1/local/me`

**Me**

**Access:** Bearer token from the LOCAL app.

### `PATCH /v1/local/me`

**Update**

**Access:** Bearer token from the LOCAL app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `fullName` | string |  | min 2 chars, max 80 chars |
| `email` | string (email), or null |  | max 120 chars |
| `whatsappOptIn` | boolean |  |  |
| `marketingOptIn` | boolean |  |  |

### `GET /v1/local/me/addresses`

**Addresses**

**Access:** Bearer token from the LOCAL app.

### `POST /v1/local/me/addresses`

**Add**

**Access:** Bearer token from the LOCAL app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `label` | `HOME` \| `WORK` \| `OTHER` |  | default `"HOME"` |
| `contactName` | string |  | max 80 chars |
| `contactPhone` | string |  | pattern `^\+?\d{10,13}$` |
| `line1` | string | yes | min 3 chars, max 160 chars |
| `line2` | string |  | max 160 chars |
| `landmark` | string |  | max 120 chars |
| `pincode` | string | yes | pattern `^\d{6}$` |
| `cityName` | string | yes | min 2 chars, max 80 chars |
| `state` | string | yes | min 2 chars, max 80 chars |
| `lat` | number | yes | ≥ 6, ≤ 38 |
| `lng` | number | yes | ≥ 68, ≤ 98 |
| `placeId` | string |  | max 300 chars |
| `isDefault` | boolean |  |  |

### `PUT /v1/local/me/addresses/{id}`

**Update2**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `label` | `HOME` \| `WORK` \| `OTHER` |  | default `"HOME"` |
| `contactName` | string |  | max 80 chars |
| `contactPhone` | string |  | pattern `^\+?\d{10,13}$` |
| `line1` | string | yes | min 3 chars, max 160 chars |
| `line2` | string |  | max 160 chars |
| `landmark` | string |  | max 120 chars |
| `pincode` | string | yes | pattern `^\d{6}$` |
| `cityName` | string | yes | min 2 chars, max 80 chars |
| `state` | string | yes | min 2 chars, max 80 chars |
| `lat` | number | yes | ≥ 6, ≤ 38 |
| `lng` | number | yes | ≥ 68, ≤ 98 |
| `placeId` | string |  | max 300 chars |
| `isDefault` | boolean |  |  |

### `DELETE /v1/local/me/addresses/{id}`

**Remove**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/cart/quote`

**Quote**

**Access:** Bearer token from the LOCAL app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeId` | string (uuid) | yes |  |
| `fulfilmentType` | `DELIVERY` |  | default `"DELIVERY"` |
| `addressId` | string (uuid) |  |  |
| `items` | object[] | yes | at least 1 items, at most 50 items |
| `items[].productId` | string (uuid) | yes |  |
| `items[].qty` | integer | yes | ≥ 1, ≤ 50 |
| `items[].variantId` | string (uuid) |  |  |
| `items[].addonIds` | string (uuid)[] |  | at most 20 items |
| `prescriptionFileKeys` | string[] |  | at most 5 items |
| `couponCode` | string |  | max 20 chars, pattern `^[A-Za-z0-9]*$` |

### `POST /v1/local/orders`

**Place**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeId` | string (uuid) | yes |  |
| `fulfilmentType` | `DELIVERY` |  | default `"DELIVERY"` |
| `addressId` | string (uuid) |  |  |
| `items` | object[] | yes | at least 1 items, at most 50 items |
| `items[].productId` | string (uuid) | yes |  |
| `items[].qty` | integer | yes | ≥ 1, ≤ 50 |
| `items[].variantId` | string (uuid) |  |  |
| `items[].addonIds` | string (uuid)[] |  | at most 20 items |
| `prescriptionFileKeys` | string[] |  | at most 5 items |
| `couponCode` | string |  | max 20 chars, pattern `^[A-Za-z0-9]*$` |
| `paymentMode` | `UPI` \| `CARD` \| `NETBANKING` | yes |  |
| `note` | string |  | max 300 chars |

### `GET /v1/local/orders`

**List**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `cursor` | query | string | yes |  |

### `GET /v1/local/orders/{id}`

**Detail**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/orders/{id}/payment`

**Payment**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/orders/{id}/payment/verify`

**Verify**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `razorpay_order_id` | string | yes | min 5 chars, max 64 chars |
| `razorpay_payment_id` | string | yes | min 5 chars, max 64 chars |
| `razorpay_signature` | string | yes | min 16 chars, max 256 chars |

### `POST /v1/local/orders/{id}/cancel`

**Cancel**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 200 chars |

### `POST /v1/local/pharmacies/{storeId}/rx-upload`

**Rx upload**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `contentType` | `application/pdf` \| `image/jpeg` \| `image/png` \| `image/webp` | yes |  |
| `size` | integer | yes | > 0, ≤ 10485760 |

### `POST /v1/local/orders/{id}/substitutions/{subId}`

**Substitution**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `subId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `accept` | boolean | yes |  |

### `POST /v1/local/orders/{id}/returns`

**Return items**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `items` | object[] | yes | at least 1 items, at most 50 items |
| `items[].itemId` | string (uuid) | yes |  |
| `items[].qty` | integer | yes | ≥ 1, ≤ 50 |
| `items[].reason` | `DAMAGED` \| `WRONG_ITEM` \| `EXPIRED` \| `POOR_QUALITY` \| `MISSING` | yes |  |
| `note` | string |  | max 300 chars |

### `POST /v1/local/orders/{id}/returns/keep`

**Keep all**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/orders/{id}/review`

**Review**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `rating` | integer | yes | ≥ 1, ≤ 5 |
| `comment` | string |  | max 500 chars |
| `tags` | `ON_TIME` \| `LATE` \| `GOOD_PACKING` \| `POOR_PACKING` \| `FRESH` \| `WRONG_ITEM` \| `FRIENDLY` \| `COLD_FOOD`[] |  | at most 8 items |

### `POST /v1/local/labs/{storeId}/rx-upload`

**Rx upload**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `contentType` | `application/pdf` \| `image/jpeg` \| `image/png` \| `image/webp` | yes |  |
| `size` | integer | yes | > 0, ≤ 10485760 |

### `POST /v1/local/lab-bookings`

**Book**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `storeId` | string (uuid) | yes |  |
| `collectionType` | `HOME` \| `WALK_IN` | yes |  |
| `slotStart` | string (date-time) | yes |  |
| `testIds` | string (uuid)[] | yes | at least 1 items, at most 30 items |
| `patient` | object | yes |  |
| `patient.name` | string | yes | min 2 chars, max 80 chars |
| `patient.age` | integer |  | ≥ 0, ≤ 120 |
| `patient.gender` | `F` \| `M` \| `O` |  |  |
| `addressId` | string (uuid) |  |  |
| `note` | string |  | max 300 chars |
| `prescriptionFileKeys` | string[] |  | at most 5 items |
| `paymentMode` | `COD` \| `UPI` \| `CARD` \| `NETBANKING` |  |  |

### `GET /v1/local/lab-bookings`

**List**

**Access:** Bearer token from the LOCAL app.

### `POST /v1/local/lab-bookings/payments/{paymentId}/verify`

**Verify lab payment**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `paymentId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `razorpay_order_id` | string | yes | min 5 chars, max 64 chars |
| `razorpay_payment_id` | string | yes | min 5 chars, max 64 chars |
| `razorpay_signature` | string | yes | min 16 chars, max 256 chars |

### `POST /v1/local/lab-bookings/payments/{paymentId}/abandon`

**Abandon lab payment**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `paymentId` | path | string | yes |  |

### `GET /v1/local/lab-bookings/{id}`

**Detail**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/lab-bookings/{id}/cancel`

**Cancel**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string |  | max 200 chars |

### `POST /v1/local/lab-bookings/{id}/reschedule`

**Reschedule**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `slotStart` | string (date-time) | yes |  |

### `GET /v1/local/lab-bookings/{id}/reports/{reportId}`

**Report**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `reportId` | path | string | yes |  |

### `GET /v1/local/support`

**List**

**Access:** Bearer token from the LOCAL app.

### `POST /v1/local/support`

**Create**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `category` | `ORDER_ISSUE` \| `MISSING_ITEM` \| `PAYMENT_REFUND` \| `MEDICINE` \| `LAB_BOOKING` \| `ACCOUNT` \| `OTHER` | yes |  |
| `subject` | string | yes | min 3 chars, max 120 chars |
| `message` | string | yes | min 5 chars, max 2000 chars |
| `orderId` | string (uuid) |  |  |

### `GET /v1/local/support/{id}`

**Get**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/local/support/{id}/reply`

**Reply**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `body` | string | yes | min 1 chars, max 2000 chars |

### `POST /v1/local/support/{id}/resolve`

**Resolve**

**Access:** Bearer token from the LOCAL app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

## lab-bookings

### `GET /v1/partners/stores/{storeId}/lab-slots`

**Slots**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `date` | query | string | yes |  |
| `type` | query | `HOME` \| `WALK_IN` | yes |  |

### `GET /v1/partners/stores/{storeId}/lab-pathologists`

**Pathologists**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/lab-bookings`

**List**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `tab` | query | `TO_CONFIRM` \| `UPCOMING` \| `IN_LAB` \| `REPORTS` \| `CANCELLED` \| `ALL` |  |  |
| `date` | query | string |  |  |

### `POST /v1/partners/stores/{storeId}/lab-bookings`

**Phone / walk-in bookings entered by the lab (start confirmed).**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `customer` | object | yes |  |
| `customer.phone` | string | yes |  |
| `customer.name` | string |  | min 2 chars, max 80 chars |
| `patient` | object | yes |  |
| `patient.name` | string | yes | min 2 chars, max 80 chars |
| `patient.age` | integer |  | ≥ 0, ≤ 120 |
| `patient.gender` | `F` \| `M` \| `O` |  |  |
| `collectionType` | `HOME` \| `WALK_IN` | yes |  |
| `slotStart` | string (date-time) | yes |  |
| `testIds` | string (uuid)[] | yes | at least 1 items, at most 30 items |
| `paymentMode` | `COD` \| `UPI` | yes |  |
| `address` | object |  |  |
| `address.line1` | string |  | min 3 chars, max 160 chars |
| `address.landmark` | string |  | max 120 chars |
| `address.pincode` | string |  | pattern `^\d{6}$` |
| `address.lat` | number |  | ≥ 6, ≤ 38 |
| `address.lng` | number |  | ≥ 68, ≤ 98 |
| `rxSeenByStore` | boolean |  |  |
| `note` | string |  | max 300 chars |

### `GET /v1/partners/stores/{storeId}/lab-bookings/{idOrNumber}`

**Detail**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `idOrNumber` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/rx-approve`

**Approve rx**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `doctorName` | string |  | max 120 chars |
| `doctorRegNo` | string |  | max 40 chars |
| `notes` | string |  | max 300 chars |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/rx-reject`

**Reject rx**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 300 chars |

### `GET /v1/partners/stores/{storeId}/lab-bookings/{id}/prescription`

**Prescription**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/confirm`

**Confirm**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/reject`

**Reject**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 300 chars |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/collector`

**Collector**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 80 chars |
| `phone` | string | yes |  |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/collect`

**Collect**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `otp` | string | yes | pattern `^\d{4}$` |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/processing`

**Processing**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/reschedule`

**Reschedule**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `slotStart` | string (date-time) | yes |  |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/report-uploads`

**Report upload**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `size` | integer | yes | > 0, ≤ 10485760 |

### `POST /v1/partners/stores/{storeId}/lab-bookings/{id}/reports`

**Release (or amend) the pathologist-signed report.**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `fileKey` | string | yes | max 300 chars |
| `pathologistId` | string (uuid) | yes |  |
| `summary` | string |  | max 500 chars |
| `attest` | `true` | yes |  |
| `amendReason` | string |  | min 5 chars, max 300 chars |

### `GET /v1/partners/stores/{storeId}/lab-bookings/{id}/reports/{reportId}/file`

**Report file**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |
| `reportId` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/lab-bookings/{id}/report-access`

**Access log**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/lab-rx-uploads`

**Customer-side upload target (used by the dev simulator now; the Local app later).**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, COUNTER_STAFF.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `contentType` | `application/pdf` \| `image/jpeg` \| `image/png` | yes |  |
| `size` | integer | yes | > 0, ≤ 10485760 |

### `POST /v1/dev/stores/{storeId}/lab-bookings/simulate`

**Simulate**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `count` | integer |  | ≥ 1, ≤ 5, default `1` |
| `collection` | `HOME` \| `WALK_IN` \| `ANY` |  | default `"ANY"` |
| `rx` | `YES` \| `NO` \| `ANY` |  | default `"ANY"` |
| `payment` | `COD` \| `UPI` \| `ANY` |  | default `"ANY"` |

## pharmacy

### `GET /v1/partners/stores/{storeId}/pharmacists`

**List**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/pharmacists`

**Add**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 3 chars, max 80 chars |
| `registrationNo` | string | yes | min 3 chars, max 40 chars |
| `stateCouncil` | string | yes | min 3 chars, max 80 chars |
| `shifts` | object[] | yes | at most 7 items |
| `shifts[].dayOfWeek` | integer | yes | ≥ 0, ≤ 6 |
| `shifts[].startsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `shifts[].endsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `consent` | `true` | yes |  |

### `PUT /v1/partners/stores/{storeId}/pharmacists/{id}/shifts`

**Shifts**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `shifts` | object[] | yes | at most 7 items |
| `shifts[].dayOfWeek` | integer | yes | ≥ 0, ≤ 6 |
| `shifts[].startsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |
| `shifts[].endsAt` | string | yes | pattern `^([01]\d\|2[0-3]):[0-5]\d$` |

### `POST /v1/partners/stores/{storeId}/pharmacists/{id}/duty`

**Duty**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `mode` | `ON` \| `OFF` \| `SHIFTS` | yes |  |

### `PUT /v1/partners/stores/{storeId}/pharmacists/{id}/login`

**Login**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `userId` | string (uuid), or null | yes |  |

### `DELETE /v1/partners/stores/{storeId}/pharmacists/{id}`

**Remove**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/orders/{orderId}/prescription`

**Files**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/rx-approve`

**Approve**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `pharmacistId` | string (uuid) |  |  |
| `doctorName` | string | yes | min 3 chars, max 120 chars |
| `doctorRegNo` | string | yes | min 3 chars, max 40 chars |
| `issuedOn` | string | yes | pattern `^\d{4}-\d{2}-\d{2}$` |
| `patientName` | string |  | max 80 chars |
| `notes` | string |  | max 300 chars |
| `attest` | `true` | yes |  |

### `POST /v1/partners/stores/{storeId}/orders/{orderId}/rx-reject`

**Reject**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `orderId` | path | string | yes |  |
| `Idempotency-Key` | header | string | yes | A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it., max 100 chars |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | `UNREADABLE` \| `INCOMPLETE` \| `TOO_OLD` \| `NOT_PRESCRIBED` \| `PATIENT_MISMATCH` \| `OTHER` | yes |  |
| `note` | string |  | max 200 chars |
| `pharmacistId` | string (uuid) |  |  |

## dev

### `POST /v1/dev/stores/{storeId}/digests/run`

**Run**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `kind` | `EXPIRY` \| `SUMMARY` | yes |  |

## catalog

### `GET /v1/partners/stores/{storeId}/categories`

**Categories**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/categories`

**Create category**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 1 chars, max 60 chars |
| `isActive` | boolean |  |  |

### `PUT /v1/partners/stores/{storeId}/categories/order`

**Reorder categories**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ids` | string (uuid)[] | yes | at least 1 items, at most 1000 items |

### `PATCH /v1/partners/stores/{storeId}/categories/{id}`

**Update category**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string |  | min 1 chars, max 60 chars |
| `isActive` | boolean |  |  |
| `sortOrder` | integer |  | ≥ 0, ≤ 10000 |

### `DELETE /v1/partners/stores/{storeId}/categories/{id}`

**Delete category**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `GET /v1/partners/stores/{storeId}/products`

**Products**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `categoryId` | query | string |  |  |
| `q` | query | string |  |  |
| `status` | query | `AVAILABLE` \| `HIDDEN` \| `PAUSED` \| `OUT_OF_STOCK` \| `LOW_STOCK` |  |  |

### `POST /v1/partners/stores/{storeId}/products`

**Create**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | min 2 chars, max 120 chars |
| `description` | string, or null |  | max 500 chars |
| `categoryId` | string (uuid), or null |  |  |
| `images` | string[] |  | at most 6 items |
| `sku` | string, or null |  | max 60 chars |
| `barcode` | string, or null |  | max 60 chars |
| `unit` | `piece` \| `plate` \| `kg` \| `g` \| `litre` \| `ml` \| `pack` \| `dozen` \| `strip` \| `bottle` \| `box` |  |  |
| `unitSize` | number, or null |  | > 0, ≤ 100000 |
| `price` | integer | yes | ≥ 0, ≤ 10000000 |
| `mrp` | integer, or null |  | ≥ 0, ≤ 10000000 |
| `taxRatePct` | number |  | ≥ 0, ≤ 28 |
| `hsnCode` | string, or null |  | max 12 chars |
| `isAvailable` | boolean |  |  |
| `isComplex` | boolean |  |  |
| `prepMinutes` | integer, or null |  | ≥ 1, ≤ 120 |
| `maxQtyPerOrder` | integer, or null |  | ≥ 1, ≤ 999 |
| `isVeg` | boolean, or null |  |  |
| `spiceLevel` | integer, or null |  | ≥ 0, ≤ 3 |
| `prescriptionRequired` | boolean |  |  |
| `drugSchedule` | `NONE` \| `OTC` \| `H` \| `H1` \| `X` |  |  |
| `saltComposition` | string, or null |  | max 200 chars |
| `manufacturer` | string, or null |  | max 120 chars |
| `substitutionAllowed` | boolean |  |  |
| `labSampleType` | `BLOOD` \| `URINE` \| `STOOL` \| `SWAB` \| `SALIVA` \| `OTHER` |  |  |
| `labFastingHours` | integer, or null |  | ≥ 0, ≤ 24 |
| `labReportHours` | integer, or null |  | ≥ 1, ≤ 720 |
| `labHomeCollection` | boolean, or null |  |  |
| `labWalkIn` | boolean, or null |  |  |
| `labParameters` | integer, or null |  | ≥ 1, ≤ 500 |
| `labPreparation` | string, or null |  | max 300 chars |
| `tags` | string[] |  | at most 10 items |
| `variants` | object[] |  | at most 12 items |
| `variants[].id` | string (uuid) |  |  |
| `variants[].name` | string |  | min 1 chars, max 40 chars |
| `variants[].priceDiff` | integer |  | ≥ -10000000, ≤ 10000000 |
| `variants[].isDefault` | boolean |  | default `false` |
| `addonGroups` | object[] |  | at most 8 items |
| `addonGroups[].name` | string |  | min 1 chars, max 60 chars |
| `addonGroups[].minSelect` | integer |  | ≥ 0, ≤ 20 |
| `addonGroups[].maxSelect` | integer |  | ≥ 1, ≤ 20 |
| `addonGroups[].addons` | object[] |  | at least 1 items, at most 30 items |
| `addonGroups[].addons[].name` | string |  | min 1 chars, max 60 chars |
| `addonGroups[].addons[].price` | integer |  | ≥ 0, ≤ 10000000 |
| `addonGroups[].addons[].isVeg` | boolean, or null |  |  |
| `stock` | object |  |  |
| `stock.trackStock` | boolean |  |  |
| `stock.stockQty` | integer |  | ≥ 0, ≤ 1000000 |
| `stock.lowStockThreshold` | integer |  | ≥ 0, ≤ 100000 |
| `stock.batchNo` | string, or null |  | max 40 chars |
| `stock.expiryDate` | string, or null |  | pattern `^\d{4}-\d{2}-\d{2}$` |

### `POST /v1/partners/stores/{storeId}/products/bulk`

**Bulk**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ids` | string (uuid)[] | yes | at least 1 items, at most 500 items |
| `action` | `MAKE_AVAILABLE` \| `MAKE_UNAVAILABLE` \| `DELETE` \| `MOVE` \| `PRICE_PERCENT` | yes |  |
| `categoryId` | string (uuid), or null |  |  |
| `percent` | number |  | ≥ -50, ≤ 100 |

### `PUT /v1/partners/stores/{storeId}/products/order`

**Reorder products**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ids` | string (uuid)[] | yes | at least 1 items, at most 1000 items |

### `GET /v1/partners/stores/{storeId}/products/import/template.csv`

**Template**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/products/import/preview`

**Import preview**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `csv` | string | yes | min 1 chars, max 1000000 chars |
| `updateExisting` | boolean |  | default `true` |

### `POST /v1/partners/stores/{storeId}/products/import`

**Import run**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `csv` | string | yes | min 1 chars, max 1000000 chars |
| `updateExisting` | boolean |  | default `true` |

### `POST /v1/partners/stores/{storeId}/products/uploads`

**Presign image**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `contentType` | string | yes |  |
| `size` | integer | yes | > 0 |

### `GET /v1/partners/stores/{storeId}/products/{id}`

**Product**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `PATCH /v1/partners/stores/{storeId}/products/{id}`

**Update**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string |  | min 2 chars, max 120 chars |
| `description` | string, or null |  | max 500 chars |
| `categoryId` | string (uuid), or null |  |  |
| `images` | string[] |  | at most 6 items |
| `sku` | string, or null |  | max 60 chars |
| `barcode` | string, or null |  | max 60 chars |
| `unit` | `piece` \| `plate` \| `kg` \| `g` \| `litre` \| `ml` \| `pack` \| `dozen` \| `strip` \| `bottle` \| `box` |  |  |
| `unitSize` | number, or null |  | > 0, ≤ 100000 |
| `price` | integer |  | ≥ 0, ≤ 10000000 |
| `mrp` | integer, or null |  | ≥ 0, ≤ 10000000 |
| `taxRatePct` | number |  | ≥ 0, ≤ 28 |
| `hsnCode` | string, or null |  | max 12 chars |
| `isAvailable` | boolean |  |  |
| `isComplex` | boolean |  |  |
| `prepMinutes` | integer, or null |  | ≥ 1, ≤ 120 |
| `maxQtyPerOrder` | integer, or null |  | ≥ 1, ≤ 999 |
| `isVeg` | boolean, or null |  |  |
| `spiceLevel` | integer, or null |  | ≥ 0, ≤ 3 |
| `prescriptionRequired` | boolean |  |  |
| `drugSchedule` | `NONE` \| `OTC` \| `H` \| `H1` \| `X` |  |  |
| `saltComposition` | string, or null |  | max 200 chars |
| `manufacturer` | string, or null |  | max 120 chars |
| `substitutionAllowed` | boolean |  |  |
| `labSampleType` | `BLOOD` \| `URINE` \| `STOOL` \| `SWAB` \| `SALIVA` \| `OTHER` |  |  |
| `labFastingHours` | integer, or null |  | ≥ 0, ≤ 24 |
| `labReportHours` | integer, or null |  | ≥ 1, ≤ 720 |
| `labHomeCollection` | boolean, or null |  |  |
| `labWalkIn` | boolean, or null |  |  |
| `labParameters` | integer, or null |  | ≥ 1, ≤ 500 |
| `labPreparation` | string, or null |  | max 300 chars |
| `tags` | string[] |  | at most 10 items |
| `variants` | object[] |  | at most 12 items |
| `variants[].id` | string (uuid) |  |  |
| `variants[].name` | string |  | min 1 chars, max 40 chars |
| `variants[].priceDiff` | integer |  | ≥ -10000000, ≤ 10000000 |
| `variants[].isDefault` | boolean |  | default `false` |
| `addonGroups` | object[] |  | at most 8 items |
| `addonGroups[].name` | string |  | min 1 chars, max 60 chars |
| `addonGroups[].minSelect` | integer |  | ≥ 0, ≤ 20 |
| `addonGroups[].maxSelect` | integer |  | ≥ 1, ≤ 20 |
| `addonGroups[].addons` | object[] |  | at least 1 items, at most 30 items |
| `addonGroups[].addons[].name` | string |  | min 1 chars, max 60 chars |
| `addonGroups[].addons[].price` | integer |  | ≥ 0, ≤ 10000000 |
| `addonGroups[].addons[].isVeg` | boolean, or null |  |  |
| `stock` | object |  |  |
| `stock.trackStock` | boolean |  |  |
| `stock.stockQty` | integer |  | ≥ 0, ≤ 1000000 |
| `stock.lowStockThreshold` | integer |  | ≥ 0, ≤ 100000 |
| `stock.batchNo` | string, or null |  | max 40 chars |
| `stock.expiryDate` | string, or null |  | pattern `^\d{4}-\d{2}-\d{2}$` |

### `DELETE /v1/partners/stores/{storeId}/products/{id}`

**Remove**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `PUT /v1/partners/stores/{storeId}/products/{id}/availability`

**Availability**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `isAvailable` | boolean | yes |  |

### `PUT /v1/partners/stores/{storeId}/products/{id}/pause`

**Pause**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `minutes` | integer, or null | yes | ≥ 5, ≤ 1440 |

### `GET /v1/partners/stores/{storeId}/inventory`

**Inventory list**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `filter` | query | `ALL` \| `LOW` \| `OUT` \| `EXPIRING` |  |  |
| `days` | query | string |  |  |

### `GET /v1/partners/stores/{storeId}/inventory/expiry.csv`

**Expiry csv**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `filter` | query | `ALL` \| `LOW` \| `OUT` \| `EXPIRING` |  |  |
| `days` | query | string |  |  |

### `POST /v1/partners/stores/{storeId}/products/{id}/stock`

**Stock**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `mode` | `SET` \| `ADJUST` | yes |  |
| `qty` | integer | yes | ≥ -1000000, ≤ 1000000 |
| `type` | `PURCHASE` \| `ADJUSTMENT` \| `EXPIRY_WRITEOFF` \| `RETURN` |  | default `"ADJUSTMENT"` |
| `note` | string |  | max 200 chars |

### `GET /v1/partners/stores/{storeId}/products/{id}/stock/movements`

**Movements**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, PHARMACIST.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

## support

### `GET /v1/partners/stores/{storeId}/support/tickets`

**List**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/support/tickets`

**Create**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `category` | `ORDER_ISSUE` \| `PAYOUT` \| `MENU` \| `ACCOUNT` \| `TECH` \| `OTHER` | yes |  |
| `subject` | string | yes | min 5 chars, max 120 chars |
| `message` | string | yes | min 10 chars, max 2000 chars |
| `orderNumber` | string |  | pattern `^DEL-\d+$` |

### `GET /v1/partners/stores/{storeId}/support/tickets/{id}`

**Get**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

### `POST /v1/partners/stores/{storeId}/support/tickets/{id}/messages`

**Reply**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `body` | string | yes | min 1 chars, max 2000 chars |

### `POST /v1/partners/stores/{storeId}/support/tickets/{id}/resolve`

**Resolve**

**Access:** Bearer token from the PARTNERS app · store roles: OWNER, MANAGER, KITCHEN_LEAD, COUNTER_STAFF, PHARMACIST, ACCOUNTANT.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `storeId` | path | string | yes |  |
| `id` | path | string | yes |  |

## PaymentsWebhook

### `POST /v1/payments/razorpay/webhook`

**Webhook**

**Access:** public, no login.

## rider

### `GET /v1/rider/me`

**next = REGISTER (fill / fix the application) · STATUS (with ops, or rejected) · HOME (approved) · RESTRICTED (suspended).**

**Access:** Bearer token from the RIDER app.

### `GET /v1/rider/registration/options`

**Dropdown choices, declarations and training modules for every step.**

**Access:** public, no login.

### `POST /v1/rider/registration`

**Start**

**Access:** Bearer token from the RIDER app.

### `GET /v1/rider/registration`

**Get**

**Access:** Bearer token from the RIDER app.

### `PUT /v1/rider/registration/steps/{step}`

**Saves one step: personal-info, legal-vehicle, work-tech, hyperlocal, training-role or safety-compliance.**

**Access:** Bearer token from the RIDER app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `step` | path | `personal-info` \| `legal-vehicle` \| `work-tech` \| `hyperlocal` \| `training-role` \| `safety-compliance` | yes |  |

**Body** — The body depends on :step, one of these (in the same order as the step list).

*personal-info*

| Field | Type | Required | Rules |
|---|---|---|---|
| `fullName` | string | yes |  |
| `dob` | string | yes | pattern `^\d{4}-\d{2}-\d{2}$` |
| `email` | string (email), or null |  | max 120 chars |
| `pincode` | string | yes | pattern `^[1-9]\d{5}$` |

*legal-vehicle*

| Field | Type | Required | Rules |
|---|---|---|---|
| `idType` | `AADHAAR` \| `PAN` \| `VOTER_ID` \| `PASSPORT` | yes |  |
| `idLast4` | string | yes | pattern `^[A-Z0-9]{4}$` |
| `vehicleType` | `BIKE` \| `SCOOTER` \| `EV` \| `BICYCLE` \| `CAR` \| `VAN` \| `MINI_TRUCK` | yes |  |
| `vehicleOwnership` | `OWNED` \| `LEASED` \| `RENTED` \| `COMPANY` | yes |  |
| `vehicleCondition` | `GOOD` \| `FAIR` \| `NEEDS_REPAIR` | yes |  |
| `vehicleRegistration` | string, or null |  |  |
| `licenceType` | `MCWG` \| `LMV` \| `LMV_TRANSPORT` \| `HMV` |  |  |
| `licenceNumber` | string, or null |  |  |
| `licenceExpiry` | string, or null |  | pattern `^\d{4}-\d{2}-\d{2}$` |
| `licenceDeclaration` | boolean |  |  |

*work-tech*

| Field | Type | Required | Rules |
|---|---|---|---|
| `workType` | `FULL_TIME` \| `PART_TIME` \| `WEEKEND` | yes |  |
| `smartphone` | `ANDROID_11_PLUS` \| `ANDROID_OLDER` \| `IPHONE` | yes |  |
| `dataPlan` | `UNLIMITED` \| `MONTHLY` \| `LIMITED` \| `NONE` | yes |  |

*hyperlocal*

| Field | Type | Required | Rules |
|---|---|---|---|
| `jobTypes` | `FOOD` \| `GROCERY` \| `PHARMACY` \| `PARCEL` \| `STREET`[] | yes | at least 1 items |

*training-role*

| Field | Type | Required | Rules |
|---|---|---|---|
| `completedModules` | `DELIVERY_SOP` \| `PICKUP_SOP` \| `NAVIGATION_APP` \| `CUSTOMER_CONDUCT` \| `ROAD_SAFETY`[] | yes |  |
| `trainingNeeds` | `NONE` \| `APP` \| `CUSTOMER` \| `CASH`[] | yes | at least 1 items |

*safety-compliance*

| Field | Type | Required | Rules |
|---|---|---|---|
| `safetyDeclarations` | object | yes |  |
| `statutoryDeclarations` | object | yes |  |

### `POST /v1/rider/registration/documents/presign`

**1) Ask for an upload link, 2) PUT the file to uploadUrl, 3) POST registration/documents with the fileKey.**

**Access:** Bearer token from the RIDER app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | `PHOTO` \| `DRIVING_LICENCE` \| `VEHICLE_RC` \| `VEHICLE_INSURANCE` \| `BANK_PROOF` | yes |  |
| `contentType` | `image/jpeg` \| `image/png` \| `image/webp` \| `application/pdf` | yes |  |
| `size` | integer | yes | > 0, ≤ 10485760 |

### `POST /v1/rider/registration/documents`

**Attach**

**Access:** Bearer token from the RIDER app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | `PHOTO` \| `DRIVING_LICENCE` \| `VEHICLE_RC` \| `VEHICLE_INSURANCE` \| `BANK_PROOF` | yes |  |
| `fileKey` | string | yes | min 10 chars, max 200 chars |

### `DELETE /v1/rider/registration/documents/{type}`

**Remove**

**Access:** Bearer token from the RIDER app.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `type` | path | `BANK_PROOF` \| `PHOTO` \| `DRIVING_LICENCE` \| `VEHICLE_RC` \| `VEHICLE_INSURANCE` | yes |  |

### `POST /v1/rider/registration/submit`

**Submit**

**Access:** Bearer token from the RIDER app.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `consent` | `true` | yes |  |

## admin · riders

### `GET /v1/admin/riders/applications`

**List**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `status` | query | `DRAFT` \| `SUBMITTED` \| `UNDER_REVIEW` \| `CHANGES_REQUESTED` \| `APPROVED` \| `REJECTED` |  |  |
| `search` | query | string |  |  |
| `page` | query | number |  |  |
| `pageSize` | query | number |  |  |

### `GET /v1/admin/riders/applications/{id}`

**Get**

**Access:** Bearer token from the ADMIN app · any admin role.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/riders/applications/{id}/start-review`

**Start review**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

### `POST /v1/admin/riders/applications/{id}/documents/{docId}/verify`

**Verify doc**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `docId` | path | string | yes |  |

### `POST /v1/admin/riders/applications/{id}/documents/{docId}/reject`

**Reject doc**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |
| `docId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 500 chars |

### `POST /v1/admin/riders/applications/{id}/approve`

**Approve**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `cityId` | string (uuid) |  |  |

### `POST /v1/admin/riders/applications/{id}/request-changes`

**Request changes**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 500 chars |

### `POST /v1/admin/riders/applications/{id}/reject`

**Reject**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `id` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 500 chars |

### `POST /v1/admin/riders/{riderId}/suspend`

**Suspend**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `riderId` | path | string | yes |  |

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `reason` | string | yes | min 5 chars, max 500 chars |

### `POST /v1/admin/riders/{riderId}/reinstate`

**Reinstate**

**Access:** Bearer token from the ADMIN app · admin roles: FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS, COMPLIANCE.

| Parameter | In | Type | Required | Notes |
|---|---|---|---|---|
| `riderId` | path | string | yes |  |
