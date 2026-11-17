# Rider app API: registration, login, logout

For the **Delivez Agent** app (delivery partners) and for **hub management / admin console** screens that review riders.
Base URL: `https://<api-host>/v1`. All bodies are JSON. Errors look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## 1. Login (OTP) — same endpoints as the other apps, with `app: "RIDER"`

| Step | Call | Notes |
|---|---|---|
| Send code | `POST /auth/otp/request` `{ "phone": "9876543210" }` | → `{ requestId, expiresIn, resendIn }`. 6-digit code, valid 5 min, resend after 30 s, max 5 codes per hour per phone. |
| Verify | `POST /auth/otp/verify` `{ "requestId", "code": "123456", "app": "RIDER", "device": { "model": "...", "os": "android 14" } }` | → `{ accessToken, refreshToken, expiresIn: 900, user }`. 5 wrong tries end the code. |
| Which screen? | `GET /rider/me` (Bearer) | → `next`: `REGISTER` · `STATUS` · `HOME` · `RESTRICTED` (see below) |
| Keep logged in | `POST /auth/refresh` `{ "refreshToken" }` | Returns a **new** pair; the old refresh token stops working. Access tokens last 15 min. |
| Log out | `POST /auth/logout` (Bearer) | Ends this device only. → 204 |
| Sign out everywhere | `POST /auth/logout-all` (Bearer) | Ends every rider session of this person. → `{ signedOut: n }` |

`GET /rider/me` → `next` tells the app where to go:

| next | When | App screen |
|---|---|---|
| `REGISTER` | no application yet, a draft, or ops asked for changes (`application.reviewNote` says what) | `/onboarding/...` |
| `STATUS` | sent and waiting, or rejected | `/onboarding/status` |
| `HOME` | approved | home |
| `RESTRICTED` | suspended by ops (`rider.restrictedReason`) | `/restricted` |

A token from another app (customer, partner, admin) gets `403 WRONG_APP`. After logout / suspension the old token gets `401 SESSION_REVOKED`.

## 2. Registration (rider token)

| Call | What it does |
|---|---|
| `GET /rider/registration/options` | Dropdown values, declarations, training modules (no login needed). Build the screens from this. |
| `POST /rider/registration` | Starts (or returns) the application. Safe to call twice. |
| `GET /rider/registration` | The application: `status`, `steps`, `documents`, `missing`, `canSubmit`, `reviewNote`. |
| `PUT /rider/registration/steps/:step` | Saves one step (below). `400 VALIDATION_FAILED` → `details.fieldErrors.<field>` holds the message to show. |
| `POST /rider/registration/documents/presign` `{ type, contentType, size }` | → `{ uploadUrl, fileKey, headers }`. Then `PUT uploadUrl` with the file bytes and the same `content-type`. JPG / PNG / WEBP / PDF, ≤ 10 MB. |
| `POST /rider/registration/documents` `{ type, fileKey }` | Attaches the uploaded file. Same type again = replaces it. |
| `DELETE /rider/registration/documents/:type` | Removes one. |
| `POST /rider/registration/submit` `{ "consent": true }` | Sends it to ops. `422 APPLICATION_INCOMPLETE` lists `details.steps` / `details.documents` still missing. |

Steps can be saved in any order and edited until submit; after submit everything is locked (`409 APPLICATION_LOCKED`) until ops ask for changes.

| :step | Body |
|---|---|
| `personal-info` | `fullName`, `dob` (YYYY-MM-DD, 18+), `pincode` (service area), `email` (optional) |
| `legal-vehicle` | `idType` (AADHAAR / PAN / VOTER_ID / PASSPORT), `idLast4` (only the last 4 are kept), `vehicleType`, `vehicleOwnership`, `vehicleCondition`; for motor vehicles also `vehicleRegistration` (e.g. KA 51 AB 1234), `licenceType` (must cover the vehicle: bike → MCWG), `licenceNumber`, `licenceExpiry` (future), `licenceDeclaration: true` |
| `work-tech` | `workType`, `smartphone`, `dataPlan` |
| `hyperlocal` | `jobTypes: [...]` (at least one) |
| `training-role` | `completedModules` (all 5), `trainingNeeds` (`NONE` alone, or others) |
| `safety-compliance` | `safetyDeclarations: { KEY: true × 5 }`, `statutoryDeclarations: { KEY: true × 4 }` |

Documents: `PHOTO` and `BANK_PROOF` always; motor vehicles also `DRIVING_LICENCE`, `VEHICLE_RC`, `VEHICLE_INSURANCE`. A bicycle / e-bike needs no licence, RC or insurance.

## 3. Review by ops (admin token: `app: "ADMIN"` login)

Any admin can read. Changing needs FOUNDER, HEAD_OF_OPS, REGIONAL_HEAD, CITY_OPS or COMPLIANCE. City-scoped admins only see riders of their cities (from the rider's pincode).

| Call | What it does |
|---|---|
| `GET /admin/riders/applications?status=&search=&page=&pageSize=` | Queue with `counts` per status. `search` = name, phone or rider code. Drafts are hidden unless `status=DRAFT`. |
| `GET /admin/riders/applications/:id` | Everything the rider filled, documents with 15-min view links, what is missing. |
| `POST .../:id/start-review` | SUBMITTED → UNDER_REVIEW |
| `POST .../:id/documents/:docId/verify` | Marks a file as checked. |
| `POST .../:id/documents/:docId/reject` `{ reason }` | The rider sees the reason and uploads again. |
| `POST .../:id/request-changes` `{ reason }` | Back to the rider (`next = REGISTER`). |
| `POST .../:id/approve` `{ cityId? }` | Needs every required file verified. Rider becomes ACTIVE in the city (from the pincode, or `cityId`). |
| `POST .../:id/reject` `{ reason }` | Final no. |
| `POST /admin/riders/:riderId/suspend` `{ reason }` | Logs the rider out on every device; app shows "Account restricted". Refused while the rider is on a delivery. |
| `POST /admin/riders/:riderId/reinstate` | Lifts the suspension. |

Every status change is written to the audit log.

## 4. Server settings for the hub frontend

* Add the hub site to `CORS_ORIGINS` (e.g. `https://hub.delivez.com`), comma-separated with the others.
* Hub users need an admin account in this system (`admin_users`) to log in with `app: "ADMIN"`.
* Real SMS: `SMS_PROVIDER=MSG91`; codes are shown in the response only in development / `OTP_SHOW_IN_RESPONSE=true`.
