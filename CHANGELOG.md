# Changelog

All notable changes to worldshop-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-07-27

### Removed — The ecommerce API

The final teardown. With the client fully post-pivot, nothing called this code,
and the marketplace is now the whole of the server.

#### Routes gone
`/cart`, `/checkout`, `/orders`, `/payments` (incl. the Flutterwave webhook and
its raw-body capture), `/shipping`, `/wishlist`, `/downloads`, `/addresses`,
`/products` (public browse), `/products/:id/reviews` (order-anchored reviews),
`/vendor/*` (the isVendor-gated surface), `/store/:slug` (legacy). Admin loses
orders, inventory, product CRUD, digital assets, vendors, withdrawals,
commission and dashboard-stats; what remains is reports, review moderation,
categories + attributes, uploads and users.

#### Code gone
~25 services, ~20 controllers, 12 route files, 13 validators, 8 type files,
`vendor.middleware`, the demo seed, and five one-shot migration scripts that
had done their jobs (`backfill-stores`, `convert-vendor-balances`,
`fix-*-index`, `seed-marketplace-config`). `wallet.provider` is trimmed to the
two things the marketplace uses: the FX helper and `chargeWalletUsd`.
`email.service` and both ledger services went with their only consumers.
Listing standards drop the PHYSICAL/DIGITAL split — every listing now requires
at least one photo.

#### Schema gone
17 models (`Cart`, `CartItem`, `Order`, `OrderItem`, `OrderStatusHistory`,
`Payment`, `DeliveryPartner`, `ShippingMethod`, `DigitalAsset`,
`DownloadRecord`, `Wishlist`, `WishlistItem`, `Address`, `VendorBalance`,
`VendorWithdrawalAccount`, `VendorWithdrawalRequest`, `LedgerEntry`) and six
enums. `UserProfile` loses the legacy vendor fields (`isVendor`,
`vendorStatus`, `storeName`, `storeSlug`, `storeDescription`, `vendorSince`) —
`Store` has been the source of truth since the backfill. `Product` and
`ProductVariant` lose their inventory/checkout fields (stock, SKUs, salePrice,
approvalStatus, PHYSICAL/DIGITAL type, order/cart relations).

#### Database
- Dropped both partial unique indexes (`UserProfile_storeSlug_key`,
  `Cart_userId_key`) and 17 legacy collections — each verified **empty before
  dropping**, except one stray guest cart (transient by design, cleared with
  prior approval). `Address` (9 docs) was dropped after explicit
  approval, verified present in both backups first
- **`prisma db push` now runs plainly** — the first time in this repo's
  history. The prepare/finish sandwich existed solely for those two partial
  indexes, and `db-push-helper.ts` is deleted with the `db:push:*`,
  `fix:*-index`, `seed`, `seed:config`, `backfill:stores`, `convert:balances`
  and `migrate:*` scripts

#### Auth
`JwtPayload` no longer carries `isVendor`/`vendorStatus`; `requireStore` is the
only vendor gate. The legacy test suites (vendor, checkout, ledger, payment,
phase7, store) are deleted — including the three long-standing failures, which
died with the code they tested.

## [0.30.0] - 2026-07-26

### Added — Public listing and store endpoints

The buyer side had no way to view a single listing or a store's catalogue,
which meant the contact loop could not be closed.

- `GET /api/v1/listings/:idOrSlug` — a single public listing. Accepts either
  form so links can be readable. Includes the seller's contact channels and
  trust signals (`responseRate`, `avgResponseMins`, rating, verification), since
  those decide whether a buyer makes contact. Increments `viewCount`
  fire-and-forget — a counter update should never delay the page
- `GET /api/v1/stores/:slug/listings` — a store's public catalogue, resolved
  through the same visibility rule as the store page so an unpaid store's
  catalogue is not reachable by guessing the URL

Both enforce the two gates: listing PUBLISHED and store ACTIVE/GRACE. A listing
failing either is reported as missing rather than hidden-but-acknowledged.

### Fixed
- `PATCH /stores/me` contact fields (`phone`, `whatsapp`, `email`, `website`)
  were `optional` but not `nullable`, so a vendor could never CLEAR a phone
  number once set — omitting keeps, and `""` fails format validation. They now
  accept `null` to unset

### Added
- `GET /api/v1/stores/me/reviews` — the owner's view of their own reviews,
  behind `requireStore` rather than the public store route. That route enforces
  visibility, so a vendor whose subscription lapsed could not read or answer
  reviews on their own store — arguably when they need to most. Supports
  `?unrepliedOnly=true`, matching `vendorReply` as null **or unset**

### Fixed
- **A vendor could not report a fake review on their own store.** A review's
  target resolves to the store it is *about*, so the self-report guard blocked
  the person most likely to notice one — which is the entire reason the
  `FAKE_REVIEW` reason exists. The guard now applies to STORE and LISTING
  targets only, and its message names the actual target type
- `GET /api/v1/listings` accepted no `condition` filter, so the browse UI's
  condition dropdown would have been silently ignored. `condition` is a
  first-class column rather than a category attribute, so it filters uniformly
  across every category instead of being redefined on each leaf.

## [0.29.0] - 2026-07-26

### Added — Vendor dashboard endpoint

`GET /api/v1/stores/me/dashboard` — one call for the vendor landing page.

The old dashboard answered "how much did I sell", which is no longer a
question. This answers the two that replaced it: **is my store visible and
until when**, and **is the subscription doing anything for me**.

Returns `store` (status, publicly visible, verification), `subscription`
(status, plan, period end, days remaining, store credit, last charge),
`listings` (counts by status + plan limit), `inbox` (unread, open threads),
`engagement` (inquiries this period, views, response rate, avg reply time),
`reputation` (rating, review count, unreplied reviews), and a prioritised
`alerts` array.

Notes:
- `engagement.since` is returned so the UI can label the window honestly. While a subscription is ACTIVE the frame is the current billing period — literally what the vendor's last $5 bought — otherwise the last 30 days
- Alerts are ordered by what to deal with first: a dark store outranks an unread message
- Listing counts use individual `count()` calls rather than `groupBy`, which throws on documents predating the `status` field
- Unreplied reviews match `vendorReply` as null **or** unset, or the count would read zero forever

The client (`worldshop-client`) is still the pre-pivot UI and has not been
touched — its dashboard calls the dead `/vendor/analytics` and
`/vendor/balance`, and its Orders/Withdrawals pages target removed features.

## [0.28.0] - 2026-07-26

### Changed — Legacy catalogue cleared
Vendors will re-add products from scratch, so the pre-pivot catalogue was
removed: 213 products, 69 variants, 2 stray carts. The 73 backfilled stores,
their subscriptions, the seeded taxonomy and all 511 profiles are untouched.
Legacy vendor fields were stripped from `UserProfile` (`stores` phase) now that
`Store` is the source of truth.

### Fixed
- `publishListing` now enforces leaf-only categories. `assertLeafCategory` ran on create and update but not publish, so a listing could go live on a browse heading — reachable when a flat category later gained children, or when an admin added children to a category that already had listings. Attributes live on the leaf, so such a listing is unfilterable
- The teardown `catalog` phase deleted products, variants, categories AND attributes in one step. Split: `listings` (products + variants, `--drop-listings`) and `catalog` (the taxonomy itself, `--drop-taxonomy`), so clearing old listings cannot destroy 97 seeded categories and 230 attributes
- **`export` was not backing up the pivot models.** Its collection list was hardcoded and predated `Store`, `Subscription`, `SubscriptionCharge`, `StoreCreditEntry`, `Conversation`, `Message` and `Report` — so a "full backup" silently omitted 73 stores, 73 subscriptions and 10 credit entries, and the backup-verification guard on destructive phases was passing against an incomplete dump. It now reads the database's own collection list and reports drift against the known set in both directions

### Known issue
Pre-pivot documents predate later schema fields, so an absent enum value breaks
aggregation: `groupBy(['status'])` on such rows throws
`Attempted to serialize non-enum-compatible value 'null'`. Prisma applies
defaults on plain reads, so only `groupBy`/`aggregate` are affected. No longer
reachable for `Product` (all cleared), but the same shape will recur on any
collection that gains an enum field with existing rows — write defaults in a
backfill when that happens.

## [0.27.0] - 2026-07-26

### Added — Report Queue & Moderation (marketplace pivot, phase 5)

With money off-platform there is nothing to refund, claw back or arbitrate, so
de-listing is the platform's only enforcement lever — this queue is the whole of
trust and safety.

#### Two deliberate constraints
- **Reporting requires an account.** Anonymous reports cannot be deduplicated or held to account, and a queue of unattributable claims is noise. (The schema still allows a null `reporterId`; the API does not expose it.)
- **Nothing is auto-hidden on a report count.** Automatic takedown at N reports is a brigading tool — a competitor with five accounts could clear a rival off the marketplace. Counts are surfaced and ranked for a human instead.

#### Behaviour
- One open report per person per target, so a single determined reporter cannot inflate the count the queue is ranked by
- `GET /admin/reports/queue` returns **one row per reported thing**, ranked by distinct reporters, with the reasons collected. A flat list of report rows buries the signal — twelve reports about one scam listing look identical to twelve unrelated complaints
- Acting on or dismissing a report **closes every open report on the same target**. Resolving one and leaving eleven duplicates means the next admin redoes the investigation
- Suspending or banning a store also hides its listings: store status alone removes it from browse, but individual listings stay reachable by direct link
- A reported review is flagged immediately and stays **visible** — the dispute is public while it is open — and un-flags if the report is dismissed
- Removing a review pulls it out of both rating rollups
- Actions are type-checked against the target: `BAN_STORE` on a listing report is a 400
- A target deleted after being reported shows as `(deleted)` rather than breaking the queue
- Reporters can see their own history, without the internal `actionNote`

#### API
- `POST /api/v1/reports`, `GET /api/v1/reports/mine`
- `GET /api/v1/admin/reports/queue` | `/stats` | `/` | `/:id`
- `PATCH /api/v1/admin/reports/:id/claim`
- `POST /api/v1/admin/reports/:id/dismiss` | `/action`

### Fixed
- `GET /api/v1/admin/reports/commission` was being shadowed by the new `/reports/:id` route and would have 500'd on an invalid ObjectId. Declared ahead of the param route, and report ids are now validated as 24-char hex with a 400 rather than reaching Prisma

## [0.26.0] - 2026-07-26

### Added — Reviews, Re-anchored to Chat (marketplace pivot, phase 4)

`isVerified` used to mean "this user has a DELIVERED order for this product".
There are no orders any more, so the anchor moved to the chat thread — without
one this is an open fake-review surface, and that is the most common way
classifieds platforms lose buyer trust.

Two tiers:
- **to review at all** — you must have messaged the store about that listing
- **verified badge** — only if the vendor actually replied

Requiring a *reply* to review at all would hand vendors a suppression switch:
ignore anyone who sounds unhappy and they could never review you. Gating on the
buyer's own action cannot be gamed from the vendor's side, and the badge still
separates a real two-way exchange from a drive-by.

#### Schema
- `Review.storeId` — denormalised so the store rating rolls up without joining through every listing, and so a vendor cannot bury a bad review by deleting the listing it was left on
- `Review.conversationId`, and `isVerified` re-anchored
- `Review.vendorReply` / `vendorRepliedAt` — a public right of reply, which matters more here than in an ecommerce shop because vendors have no refund or resolution lever
- `ReviewStatus` (PUBLISHED / FLAGGED / REMOVED) — flagged stays visible while an admin looks at it; removed drops out of both rollups

#### Behaviour
- Ratings roll up to the listing **and** the store on every create, edit, delete and moderation action
- Editing a review's text clears the vendor's reply — leaving it attached would misrepresent what they were answering
- Verified reviews sort first, and `?verifiedOnly=true` filters to them
- Store review pages return `responseRate` and `avgResponseMins` alongside the rating: with nothing transacted on-platform, attentiveness matters as much as score
- Vendors cannot review their own store

#### API
- `GET|POST /api/v1/listings/:id/reviews`
- `GET /api/v1/listings/:id/reviews/eligibility` — so the UI can explain the rule before someone writes a review rather than rejecting it afterwards
- `GET /api/v1/listings/:id/reviews/mine`
- `PATCH|DELETE /api/v1/reviews/:id`
- `POST|DELETE /api/v1/reviews/:id/reply`
- `GET /api/v1/stores/:slug/reviews` — store reputation page
- `PATCH /api/v1/admin/reviews/:id/status`

The legacy order-anchored `review.service.ts` and `/api/v1/products/:productId/reviews`
routes are left in place untouched, and go when the ecommerce models do.

## [0.25.0] - 2026-07-26

### Added — Buyer–Vendor Chat (marketplace pivot, phase 3)

The primary contact channel. Three things are built on it: inquiry counts (the
renewal argument), store response rate (the trust signal shown to buyers), and
a replied-to thread (the review anchor, since there are no purchases to verify
against).

#### Schema
- `Conversation` — one thread per buyer per listing (`@@unique([listingId, buyerId])`), with `lastMessageAt`, per-side unread counts, `vendorFirstReplyAt`, and `ConversationStatus` (OPEN/ARCHIVED/BLOCKED). `listingId` is `SetNull` so deleting a listing does not destroy the vendor's response record
- `Message` — `senderRole` (BUYER/VENDOR), body, attachments, `readAt`, and `hasContactInfo`
- `Store.responseRate`, `Store.avgResponseMins`, `Store.inquiryCount`
- `Product.inquiryCount`

#### Behaviour
- Buyers open threads from a listing; vendors reply. A vendor cannot open a thread — that would be a broadcast channel to every registered user with no legitimate use
- Only publicly visible listings can be messaged: an unpaid store's listings aren't browsable, so there was nothing to find
- Inquiries count **once per thread**, not per message — it's the number vendors judge the subscription by
- `responseRate` counts unanswered threads against the vendor, which is the honest reading of "will this seller reply to me". Recomputed from scratch on each first reply rather than kept as a running average
- Only the counterpart's messages get `readAt`; stamping your own would make "seen" meaningless
- Replying into an archived thread re-opens it
- Contact-detail detection (Nigerian phone formats, spaced emails, WhatsApp/Telegram handles) records `hasContactInfo`. Policy is configurable via `CHAT_CONTACT_POLICY` = `flag` (default) / `redact` / `block` — default measures without intervening

#### API
- `POST /api/v1/conversations` — start or continue a thread
- `GET /api/v1/conversations?side=buying|selling` — separate inboxes, since a user can be both
- `GET /api/v1/conversations/unread` — single badge count
- `GET /api/v1/conversations/:id`, `POST …/:id/messages`, `POST …/:id/read`, `POST …/:id/archive`
- Non-participants get 404, not 403 — whether a thread exists is not their business

### Fixed
- `markRead` matched `readAt: null`, which never matches an unread message: Prisma's MongoDB connector guards equality with `$ne: [field, "$$REMOVE"]`, so a field that was never written is not null. Nothing was ever marked read. This is the third instance of the same trap in this codebase (after `Product.storeId` in the backfill and `Category.parentId` in the admin tree) — treat `field: null` filters on optional Mongo fields as suspect and pair them with `{ isSet: false }`

## [0.24.0] - 2026-07-26

### Added — Admin Category & Attribute Management

The taxonomy is now managed through the API instead of only being seeded from
code. Every guard here protects the two-level invariant that
`listing.service.ts` depends on.

#### Depth and structure
- A parent must itself be top-level — a third level is rejected outright
- A category with children cannot become a subcategory
- A category with listings filed against it cannot be given children (that would invalidate every one of those listings, since listings may only sit on leaves)
- `GET /api/v1/admin/categories/tree` — the taxonomy as a tree with per-leaf product and attribute counts

#### Attribute CRUD (leaf categories only)
- `GET|POST /api/v1/admin/categories/:id/attributes`
- `PATCH /api/v1/admin/categories/:id/attributes/:attributeId`
- `DELETE /api/v1/admin/categories/:id/attributes/:attributeId?force=true`
- `PUT /api/v1/admin/categories/:id/attributes/order` — bulk reorder for drag-and-drop
- Duplicate names rejected case-insensitively; `SELECT` requires at least one option; non-`SELECT` attributes are forced unfilterable, because free text has no shared vocabulary to filter on
- Updating an attribute reports how many existing listings the change invalidates. Tightening standards is allowed — the admin just sees the blast radius
- Deleting an in-use attribute needs `force=true`, and clears the orphaned key from affected listings so vendors are not blocked from editing them later

### Fixed
- Renaming a category no longer silently regenerates its slug — category slugs appear in browse URLs and vendor bookmarks, and fixing a typo should not break links. Opt in with `regenerateSlug: true`
- Deactivating a parent category now deactivates its children instead of detaching them (`parentId: null`), which quietly promoted subcategories to top-level headings and made every listing under them unpublishable
- `deleteCategory(moveProductsTo)` validates that the target is an active leaf
- `adminCategoryTree` matches unset `parentId` as well as explicit null — in MongoDB those are different values, so top-level categories created through the admin API were missing from the tree. `createCategory` now always writes `parentId` explicitly

## [0.23.0] - 2026-07-26

### Added — Vendor Listings (marketplace pivot, phase 2)

Vendors can now build a detailed catalogue that stays private until the store's
$5 subscription clears. See `LISTINGS-DESIGN.md`.

#### Schema
- `Product.attributes` (Json) — values for admin-defined `CategoryAttribute`s: controlled vocabulary, validated, filterable
- `Product.customFields` (Json) — up to 30 vendor-invented spec rows, display-only
- `Product.status` (`ListingStatus`: DRAFT/PUBLISHED/HIDDEN/REMOVED), `publishedAt`, `condition`, `priceType` (`FIXED`/`RANGE`/`ON_REQUEST`), `maxPrice`, `isNegotiable`, `state`, `city`, `viewCount`
- `ProductVariant.images` + `isAvailable` — per-variant photos, availability instead of stock
- `CategoryAttribute.isFilterable`
- `Report` — buyer reports on listings/stores/reviews for admin takedown

#### Listing management
- `requireStore` middleware — replaces `requireVendor` for the marketplace path; owning a store is what makes someone a vendor. Deliberately does not require a paid subscription, so vendors can author before they pay
- `listing.service.ts` — create/update/publish/unpublish/delete scoped to the caller's store; two gates (listing `PUBLISHED` + store `ACTIVE`/`GRACE`) decide public visibility, enforced in one place
- Publishing enforces the category's listing standards: required attributes, allowed `SELECT` values, numeric `NUMBER` values, at least one image. All problems returned at once
- Attribute keys not defined by the category are rejected rather than dropped
- Listings attach to leaf categories only — posting to a top-level category is refused
- `listing-standards.service.ts` — PRODUCT-level attributes now validate against the structured map, not just the `brand`/`material` columns (a gap its own comments flagged)

#### Taxonomy
- `npm run seed:taxonomy` — 14 top-level categories, 81 leaves, 221 attributes, written for the Nigerian market (property Title Document, vehicle Registration status, Tecno/Infinix/itel, wig Length/Texture/Cap Type, local generator brands). Additive and idempotent; `--deactivate-unlisted` hides categories outside the taxonomy without deleting them

#### Billing
- Monthly plans now bill on the **same date each month** rather than every 30 days (`SubscriptionPlan.intervalMonths`, default 1). 30-day cycles drift — 12.17 charges a year instead of 12 — and a vendor who paid on the 3rd expects to pay on the 3rd
- The day is clamped to the target month's length, so a store activated on 31 January renews on 28 February instead of skipping to 3 March

#### API
- `GET|POST /api/v1/stores/me/listings`, `GET|PATCH|DELETE …/:id`, `POST …/:id/publish`, `POST …/:id/unpublish`
- `GET /api/v1/stores/me/listings/form-spec?categoryId=` — dynamic-form contract for a category
- `GET /api/v1/listings` — public browse with `?attr.<Name>=<Value>` faceting on the structured layer

## [0.22.0] - 2026-07-26

### Added — Paid Stores & Subscriptions (marketplace pivot, phase 1)

The shop is moving from on-platform selling to a paid listings marketplace:
vendors pay $5/month to keep a store visible, buyers contact them directly.
This release adds the store and billing layer. Existing ecommerce models are
untouched so far — see `MARKETPLACE-SCHEMA-DIFF.md` for the full plan.

#### Schema
- `Store` — first-class store entity (owner, slug, contact channels, location, verification tier, rating/listing rollups). Replaces the vendor fields on `UserProfile`; `slug` is required, so it needs no partial index
- `SubscriptionPlan`, `Subscription`, `SubscriptionCharge` — plans in USD minor units, one subscription per store, one charge row per billing period
- `StoreStatus` (DRAFT/ACTIVE/GRACE/EXPIRED/SUSPENDED/BANNED), `VerificationTier`, `SubscriptionStatus`
- `Product.storeId` — optional during migration, backfilled from `vendorId`

#### Billing
- `chargeWalletUsd` in `wallet.provider.ts` — charges a vendor's USD wallet outright for subscriptions (hold + immediate capture, 5-minute TTL so a crash between the two returns the funds). No FX: plans are priced natively in USD, unlike NGN-priced orders
- `subscription.service.ts` — state machine (PENDING_PAYMENT → ACTIVE → GRACE → LAPSED), idempotent per billing period via a deterministic `chargeRef`, and `runRenewalSweep()` wired to an hourly interval in `server.ts`
- Charging while the paid period is still running is a no-op — a repeated activation request cannot buy a second month. Prepaying requires an explicit `allowPrepay`

#### API
- `POST /api/v1/stores` — create a store (auth only; this is how a user becomes a vendor). Starts DRAFT, invisible to buyers
- `GET|PATCH /api/v1/stores/me`, `GET /api/v1/stores/me/subscription`
- `POST /api/v1/stores/me/subscription/charge` — activate or retry; 402 on insufficient balance
- `POST /api/v1/stores/me/subscription/cancel` — stops auto-renewal, keeps paid time
- `GET /api/v1/stores`, `GET /api/v1/stores/plans`, `GET /api/v1/stores/:slug` — public; unpaid, lapsed and suspended stores 404 rather than leaking their existence

#### Store credit
- `Store.creditMinor` + `StoreCreditEntry` — prepaid, non-withdrawable subscription value with an immutable audit trail; the balance can always be re-derived from the entries
- `chargeSubscription` spends credit before the wallet, and records the split on the charge (`creditMinor` / `walletMinor`). A period can be part-credit, part-wallet
- A declined wallet charge reverses any credit already spent on that period, so credit is never consumed by a period the vendor did not receive
- `npm run convert:balances` — converts pre-pivot `VendorBalance` rows to credit at the live USD/NGN rate (`--rate=` to fix it), idempotent per vendor, leaves `VendorBalance` intact so it stays reversible
- `npm run reset:credit` — zeroes every store's credit by writing `REVERSAL` entries, so the grant and its removal both stay in the audit trail

#### Audit note
The legacy vendor balances (₦523,170) were traced to their orders and payments before being honoured. All but ₦4,800 were backed by Flutterwave **test-mode** transactions — verified sandbox responses, no real funds. The single genuine charge in platform history is $3.49, waived by the buyer (the platform owner). Credit granted from those balances was reversed in full, and `VendorBalance` / `VendorWithdrawalAccount` were removed. See `MARKETPLACE-SCHEMA-DIFF.md` for the full trace.

#### Scripts
- `npm run seed:plans` — seeds the $5/30d `standard` plan (`--with-free-tier` adds a $0 plan that runs the same state machine)
- `npm run backfill:stores` — creates `Store` rows from the 73 legacy vendor profiles and repoints their listings; dry-run by default
- `npm run teardown` — staged removal of the ecommerce data (see script header)

## [0.21.0] - 2026-07-17

### Added — Fulfilment Lifecycle & Delivery Tracking (Test 7)

#### Schema
- `OrderStatus` — new stages: `PACKAGED`, `OUT_FOR_DELIVERY`, `DELIVERY_FAILED`
- `Order.trackingNumber` — structured waybill field (previously buried in free-text notes)

#### Vendor fulfilment
- `VENDOR_TRANSITIONS` widened — vendors now drive the full path: PAID → PROCESSING → PACKAGED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED, with DELIVERY_FAILED from SHIPPED/OUT_FOR_DELIVERY and re-attempt (DELIVERY_FAILED → OUT_FOR_DELIVERY). Vendors could previously never mark orders SHIPPED at all.
- Marking SHIPPED requires a `trackingNumber` (Zod superRefine + service sets `shippedAt`); stage-appropriate default status-history notes
- `PATCH /api/v1/vendor/orders/:id/delivery-date` — extend the expected delivery date on a delayed order (future-date validated, recorded in status history, customer emailed with the new date)

#### Admin
- `VALID_TRANSITIONS` extended for the new stages; failed deliveries resolve to re-attempt, refund (wallet-credited via 0.18.0), or cancellation
- Admin SHIPPED transition now stores the tracking number in the structured field instead of appending to notes

#### Responses
- Order responses include `trackingNumber` and a computed `trackingUrl` built from the delivery partner's `trackingUrlTemplate` (cached lookup)

## [0.20.0] - 2026-07-17

### Added — Delivery Partners & Shipping Methods (Test 6)

#### Schema
- New `DeliveryPartner` model — name, logo, `trackingUrlTemplate` (`{tracking}` placeholder), isActive, sortOrder
- New `ShippingMethod` model — partner relation, name, `price` (NGN per vendor shipment), `freeAbove` (waives the fee at a subtotal threshold), `minDays`/`maxDays` delivery window
- `Order` — delivery snapshot fields: `shippingMethodId`, `shippingMethodName`, `deliveryPartnerName`, `expectedDeliveryDate`
- `prisma/seed.ts` — seeds GIG Logistics (Standard ₦2,500 free over ₦50k 3–5d, Express ₦6,000 1–2d) and DHL Express (₦12,000 1–2d)

#### Services & Routes
- `src/services/shipping.service.ts` — `listActiveShippingMethods`, `resolveShippingMethod` (requested method or first active as default; legacy flat rate when none configured), `computeGroupShipping` (freeAbove-aware, per vendor shipment), `computeExpectedDeliveryDate`
- `GET /api/v1/shipping/methods` — public; methods with partner names, prices, delivery windows
- `checkout.service.ts` — preview accepts `shippingMethodId` and returns the priced `shippingMethod` summary; confirm accepts `shippingMethodId`, prices each vendor group with it, and stamps the delivery snapshot + expected date on every physical order
- `order.service.ts` — order responses now include `shippingMethodName`, `deliveryPartnerName`, `expectedDeliveryDate`

## [0.19.0] - 2026-07-17

### Added — Listing Standards & Category Attributes (Tests 2 & 8)

#### Schema
- `Product` — new `material String?`, `weightGrams Int?`, `dimensions Json?` (`{length, width, height, unit}`)
- New `CategoryAttribute` model — per-category listing rules: `name`, `type` (SELECT/TEXT/NUMBER), `options[]`, `isRequired`, `appliesTo` (PRODUCT/VARIANT), `sortOrder`; unique per (categoryId, name)
- `prisma/seed.ts` — seeds attributes for the 4 categories (Fashion requires Size+Color per variant; others optional)

#### Services
- `src/services/listing-standards.service.ts` — `computeCompliance` (pure rule check returning every problem), `assertListingStandards` (400 gate), `annotateCompliance` (batch annotation, one attribute query per page), `getCategoryAttributes`
- `product.management.service.ts` — vendor create/update now assert listing standards; updates validate the MERGED product state so editing a pre-standards listing brings it up to code; vendor list/get responses annotated with `compliance: {compliant, problems}`

#### Validators
- `vendorCreateProductSchema` — `categoryId` now required; PHYSICAL products require ≥1 image (superRefine); added `brand`, `material`, `weightGrams`, `dimensions`
- `adminCreateProductSchema` — added `material`, `weightGrams`, `dimensions`

#### Routes
- `GET /api/v1/categories/id/:id/attributes` — public; drives the vendor form

## [0.18.0] - 2026-07-17

### Changed — Wallet-Only Checkout (Test 1)

- Checkout now pays exclusively from the buyer's central WorldStreet dollar wallet (hold at pay → capture at verify). `POST /checkout/pay` defaults to `WALLET`; MOCK remains available outside production for local testing.
- `payment-orchestrator.service.ts` — unknown providers are rejected with 400 (previously silently fell back to MOCK); non-wallet providers rejected via `ALLOWED_PROVIDERS`; pending pre-cutover payments migrate to the requested allowed provider on retry
- `payment.service.ts` (registry) — removed the silent mock fallback (`getPaymentProvider` now throws for unregistered providers) and the CRYPTO→mock registration; FLUTTERWAVE stays registered so historical payments can verify
- `payment.controller.ts` — `/payments/webhook/mock` returns 404 in production
- `envConfig.ts` — added `IS_PROD` helper

### Added

- `GET /api/v1/payments/wallet/balance?amountNgn=` — buyer's available USD wallet balance plus the converted order total and a `sufficient` flag (`getWalletUsdBalance` in wallet.provider)
- `refundWalletCapture` in wallet.provider — refunds a captured wallet payment by platform credit, proportional to the order's NGN total at the hold's snapshotted FX rate, idempotent by reference
- `admin.order.service.ts` — transitioning a wallet-paid order to REFUNDED now returns the money to the buyer's wallet BEFORE marking the order refunded; the "MANUAL ACTION REQUIRED" warning now applies only to non-wallet (pre-cutover) payments

## [0.17.0] - 2026-04-10

### Added — Phase 7: Vendor Reviews & Admin Vendor Management

#### Vendor Reviews
- `src/services/vendor.review.service.ts` — `getVendorReviews(vendorId, query)`: returns paginated reviews across all vendor's products with product name enrichment, rating filter, sort options
- `src/controllers/vendor.review.controller.ts` — `GET /api/v1/vendor/reviews` handler
- `vendor.routes.ts` — Added `/reviews` route (read-only, behind requireVendor)

#### Admin Vendor Management
- `src/services/admin.vendor.service.ts` — `listVendors(query)`, `getVendorDetail(id)`, `updateVendorStatus(id, status)`, `getVendorProducts(userId, query)`, `updateCommissionRate(rate)`, `getCommissionRate()`
- `src/controllers/admin.vendor.controller.ts` — Handlers for all admin vendor endpoints
- `src/validators/admin.vendor.validator.ts` — Zod schemas: `adminVendorListSchema`, `adminVendorStatusSchema`, `adminVendorProductsSchema`, `adminCommissionRateSchema`

#### Admin Routes
- `GET /api/v1/admin/vendors` — Paginated vendor list with status, product count, total earnings
- `GET /api/v1/admin/vendors/:id` — Full vendor detail with stats and recent orders
- `PATCH /api/v1/admin/vendors/:id/status` — Set vendor status (ACTIVE/SUSPENDED/BANNED), fully reversible
- `GET /api/v1/admin/vendors/:id/products` — Vendor's products for admin review
- `GET /api/v1/admin/reports/commission` — Per-vendor commission breakdown + platform totals
- `GET /api/v1/admin/settings/commission` — Current commission rate
- `PATCH /api/v1/admin/settings/commission` — Update commission rate (affects future orders only)

#### Tests
- `src/__tests__/phase7/phase7.test.ts` — 18 integration tests covering vendor reviews (paginated, filtered, empty), admin vendor list (search, status filter), admin vendor detail (stats, 404), vendor status management (suspend, ban, reactivate, same-status rejection), admin vendor products, commission report with settlement, commission settings (update, validation, default)

## [0.16.0] - 2026-04-10

### Added — Phase 6: Platform Ledger & Vendor Earnings

#### Schema (already existed)
- `LedgerEntry` model — orderId, vendorId, type (SALE/COMMISSION/WITHDRAWAL), amount, currency, balanceBefore, balanceAfter
- `VendorBalance` model — vendorId (unique), availableBalance, totalEarned, totalCommission
- `PlatformConfig` model — key-value pairs for platform settings

#### Seed
- `prisma/seed.ts` — Seeds `PlatformConfig` with `commissionRate = "0.10"` via upsert

#### Ledger Write Service (CQRS write side)
- `src/services/ledger.write.service.ts` — `settleOrder(orderId)`: reads order.total + vendorId from DB (caller can't pass wrong amounts), creates SALE + COMMISSION entries atomically in a transaction, upserts VendorBalance. Idempotent via `wasAlreadySettled` flag. Reads commission rate from PlatformConfig (not hardcoded). Rejects non-PAID and platform-owned orders.

#### Ledger Read Service (CQRS read side)
- `src/services/ledger.read.service.ts` — `getVendorBalance(vendorId)`, `getVendorLedger(vendorId, query)` with pagination/filtering by type/date/sort, `getVendorAnalytics(input)` with summary + earningsOverTime buckets, `getCommissionReport(input)` with platform totals + per-vendor breakdown sorted by totalSales desc

#### Ledger Types
- `src/types/ledger.types.ts` — Updated to align with plan's Order-Aware Design C: `SettleOrderResult`, `VendorBalanceSummary`, `VendorAnalyticsInput/Result`, `EarningsBucket`, `CommissionReportInput/Result`, `VendorCommissionBreakdown`, `LedgerEntryResponse`

#### Payment Webhook Integration
- `src/services/payment.service.ts` — After marking orders PAID in webhook confirm handler, calls `settleOrder()` for each vendor order (non-blocking, idempotent, with error logging)

#### Vendor Analytics Controller
- `src/controllers/vendor.analytics.controller.ts` — `getSummary`, `getEarnings`, `getBalance` handlers

#### Routes
- `src/routes/vendor.routes.ts` — Added: `GET /analytics/summary`, `GET /analytics/earnings`, `GET /balance` (all behind `requireAuth + requireVendor`)

#### Tests (11 new, 70 total)
- `src/__tests__/ledger/ledger.test.ts` — 11 tests: settleOrder (creates entries + updates balance, idempotent duplicate handling, reads commission rate from config, rejects non-PAID orders, rejects platform-owned orders, accumulates balance across multiple orders), getVendorBalance (zero balance for new vendor), getVendorLedger (paginated entries, filter by type), getVendorAnalytics (summary with earnings), getCommissionReport (multi-vendor platform report)

## [0.15.0] - 2026-04-10

### Added — Phase 5: Vendor Order Fulfillment

#### Vendor Order Service
- `src/services/vendor.order.service.ts` — `getVendorOrders(vendorId, query)` with pagination, status filtering, search by order number; `getVendorOrder(orderId, vendorId)` with 403 ownership check; `updateVendorOrderStatus(orderId, vendorId, input)` with restricted transitions: PAID → PROCESSING → DELIVERED only. Uses `VENDOR_TRANSITIONS` map. Sets `deliveredAt` timestamp on DELIVERED. Creates `OrderStatusHistory` entries.

#### Vendor Order Validator
- `src/validators/vendor.order.validator.ts` — `vendorOrdersQuerySchema` (page, limit, status, search, sortBy), `updateVendorOrderStatusSchema` (status limited to PROCESSING | DELIVERED, optional note)

#### Vendor Order Controller
- `src/controllers/vendor.order.controller.ts` — `getOrders`, `getOrder`, `updateStatus` handlers using `req.user.id` as vendorId

#### Routes
- `src/routes/vendor.routes.ts` — Added: `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status` (all behind `requireAuth + requireVendor`)

#### Tests (12 new, 59 total)
- `src/__tests__/vendor/vendor-orders.test.ts` — 12 tests: vendor order listing (scoped, filtered, paginated), order detail (ownership, 403 for other vendor, 404), status transitions (PAID→PROCESSING, PROCESSING→DELIVERED, rejected invalid transitions, cross-vendor rejection, terminal state rejection, full lifecycle)

## [0.14.0] - 2026-04-10

### Added — Phase 4: Multi-Vendor Cart & Order Splitting + Mock Payment

#### Schema Changes
- `prisma/schema.prisma` — Order model: added `vendorId String?` (indexed), `checkoutSessionId String?` (indexed), `shippingAddress Json?` (now optional). Payment model: added `checkoutSessionId String? @unique`, renamed `reference` → `transactionRef`, removed `paystackId`/`channel`, added `providerData Json?`, changed provider default to `"mock"`, removed orderId/order relation

#### Payment Service (complete rewrite)
- `src/services/payment.service.ts` — 594 lines. Mock payment implementation: `sendReceiptForOrder()`, `handleDigitalDelivery()`, `generateTransactionRef()` (WS-PAY-xxx), `mockPaymentService` implementing `PaymentServiceInterface` with `initializePayment()` (returns mock redirect URL), `verifyPayment()` (returns status + linked orders), `handleWebhook()` (confirm: atomic PAID on payment+orders+receipts; decline: atomic FAILED+stock restore). Provider-agnostic exports.

#### Checkout Session Service (new)
- `src/services/checkout.service.ts` — 489 lines. `calculateShipping()` (₦2,500 flat, free ≥₦50,000), `isDigitalOnlyCart()`, `validateCart()`, `computeSnapshotToken()` (SHA-256 hash of cart state), `groupItemsByVendor()` (batch vendor profile lookup, per-group shipping), `previewCheckoutSession()` → vendor-grouped preview with issues, `confirmCheckoutSession()` → atomic N-order creation with stock decrement, 409 on token mismatch

#### Payment Types (rewrite)
- `src/types/payment.types.ts` — Removed all Paystack types. Added: `PaymentProviderType`, `PaymentAction`, `PaymentResponse`, `InitPaymentParams`, `InitPaymentResult`, `VerifyPaymentResult`, `WebhookResult`, `PaymentServiceInterface`

#### Order Types (updated)
- `src/types/order.types.ts` — `OrderWithItems` gained `vendorId?`, `checkoutSessionId?`, optional `shippingAddress`. Added: `CheckoutIssue`, `VendorGroup`, `CheckoutSessionPreview`, `ConfirmCheckoutSessionInput`, `CheckoutSessionResult`

#### Controllers & Routes
- `src/controllers/checkout.controller.ts` — `previewCheckoutSession`, `confirmCheckoutSession` (409 handling), `initializePayment`
- `src/controllers/payment.controller.ts` — rewritten to 48 lines: `verify` (GET), `webhook` (POST, no auth)
- `src/routes/checkout.routes.ts` — POST /validate, POST /session/preview, POST /session, POST /pay (all require auth)
- `src/routes/payment.routes.ts` — GET /verify/:ref (auth), POST /webhook (no auth)
- `src/validators/payment.validator.ts` — `webhookBodySchema` replaces `initializePaymentSchema`

#### Cart Enrichment
- `src/services/cart.service.ts` — `formatCartResponse()` now includes `vendorId` and `vendor { storeName, storeSlug }` on each cart item product via batch vendor profile lookup
- `src/types/cart.types.ts` — `CartItemWithProduct.product` gained `vendorId?` and `vendor?`

#### Other Changes
- `src/services/order.service.ts` — `formatOrderResponse` now includes `vendorId`, `checkoutSessionId`
- `src/services/admin.order.service.ts` — removed all `payment: true` includes, added `vendorId`/`checkoutSessionId` to response format
- `src/configs/envConfig.ts` — removed PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY

### Removed
- `src/configs/paystackConfig.ts` — deleted (Paystack completely removed)

#### Tests (13 new, 47 total)
- `src/__tests__/checkout/checkout.test.ts` — 13 tests: checkout preview with vendor grouping, stock issue detection, empty cart, confirm with order splitting + stock decrement + cart clearing, 409 on cart change, digital-only without shipping, initialize payment redirect, confirm webhook marks PAID, decline webhook cancels orders, idempotent duplicate webhook, verify payment status, shipping calculation (flat rate + free threshold)

## [0.13.0] - 2026-04-09

### Added — Phase 3: Public Store Pages

#### Store Service
- `src/services/store.service.ts` — `getStoreBySlug(slug, query)` returns vendor store info + paginated products; validates vendor is active; reuses `listProducts` with vendorId filter for consistent sorting/pagination; returns null for non-existent or suspended/banned vendors

#### Store Controller & Routes
- `src/controllers/store.controller.ts` — `getStore` handler parses query, calls store service, signs product images, enriches with vendor info, returns 404 for missing stores
- `src/routes/store.routes.ts` — `GET /api/v1/store/:slug` public store endpoint
- `src/app.ts` — mounted store routes at `/api/v1/store`

#### Vendor Enrichment on Product Queries
- `src/services/product.service.ts` — `enrichWithVendorInfo()` batch-fetches vendor profiles (storeName, storeSlug) for products with vendorId; avoids N+1 queries
- `src/controllers/product.controller.ts` — all public product endpoints now include vendor info: listing, featured, search, single product (slug/id), related products

#### Tests (8 new, 34 total)
- `src/__tests__/store/store.test.ts` — 8 tests covering: active vendor store lookup, non-existent slug, suspended/banned vendor gates, product visibility (only active+approved), pagination, vendor enrichment

## [0.12.0] - 2026-04-08

### Added — Phase 2: Vendor Product Management

#### Vendor Product Service
- `src/services/vendor.product.service.ts` — full CRUD: `vendorCreateProduct` (auto-SKU, unique slug), `vendorListProducts` (paginated), `vendorGetProduct` (ownership check), `vendorUpdateProduct`, `vendorDeleteProduct` (cascade), `vendorToggleProduct`

#### Vendor Product Validator
- `src/validators/vendor.product.validator.ts` — Zod schemas for create/update product with variants; `vendorProductQuerySchema` for list filtering

#### Vendor Product Controller & Routes
- `src/controllers/vendor.product.controller.ts` — 6 handlers: list, get, create, update, delete, toggle
- `src/routes/vendor.routes.ts` — extended with product CRUD routes under `/api/v1/vendor/products`

#### Public Product Listing Vendor Gates
- `src/services/product.service.ts` — all public queries now filter vendor products by `approvalStatus: 'APPROVED'`; platform products (vendorId = null) pass through unfiltered
- `prisma/schema.prisma` — added `vendorId` (nullable, indexed) and `approvalStatus` (default: APPROVED) to Product model

#### Tests (11 new, 26 total)
- `src/__tests__/vendor/products.test.ts` — 11 tests: create digital product, unique slug, variants, list, get by ID, update, toggle, delete, ownership guard, missing product guard

## [0.11.0] - 2026-04-07

### Added — Phase 1: Vendor Identity & Onboarding

#### Prisma Schema
- `prisma/schema.prisma` — added `VendorStatus` enum (ACTIVE, SUSPENDED, BANNED); added vendor fields to `UserProfile`: `isVendor`, `vendorStatus`, `storeName` (unique), `storeSlug` (unique), `storeDescription`, `vendorSince`

#### Vendor Service
- `src/services/vendor.service.ts` — `registerVendor` (slug generation, reserved slug check, duplicate detection), `getVendorProfile`, `updateVendorProfile`

#### Vendor Validator
- `src/validators/vendor.validator.ts` — Zod schemas for registration and profile update

#### Vendor Controller & Routes
- `src/controllers/vendor.controller.ts` — register, getProfile, updateProfile handlers
- `src/routes/vendor.routes.ts` — mounted at `/api/v1/vendor`

#### Auth Middleware Expansion
- `src/middlewares/auth.middleware.ts` — `requireAuth` now selects vendor fields; added `requireVendor` and `requireActiveVendor` middleware

#### Tests (15 new)
- `src/__tests__/vendor/registration.test.ts` — 8 tests: registration, duplicate slug, reserved slugs, already-vendor guard, profile retrieval
- `src/__tests__/vendor/middleware.test.ts` — 7 tests: requireVendor/requireActiveVendor/requireAdmin middleware gates

## [0.10.0] - 2026-02-13

### Changed — Admin Dashboard Stats Pagination

#### Dashboard Stats Service
- `src/services/admin.product.service.ts` — `getDashboardStats()` now accepts `(page, limit)` parameters for recent orders pagination; uses `skip`/`take` for paginated queries; added `prisma.order.count()` for total; returns `recentOrdersPagination` object (`page, limit, total, totalPages, hasPrevPage, hasNextPage`)

#### Dashboard Stats Controller
- `src/controllers/admin.product.controller.ts` — `getDashboardStats` handler now parses `req.query.page` and `req.query.limit` query parameters (clamped: min 1, max 50); passes parsed values to service function

### Endpoints Changed
- `GET /api/v1/admin/dashboard/stats` — now accepts `?page=1&limit=15` query params; response includes `recentOrdersPagination` alongside `recentOrders`

## [0.9.0] - 2026-02-12

### Added — R2 Signed URLs & Digital Products System

#### R2 Signed URL Infrastructure
- `src/utils/signUrl.ts` — utility functions for generating presigned R2 URLs (`signR2Key`, `signProductImages`, `signProductListImages`, `signOrderImages`, `signCartImages`, `signWishlistImages`)
- All image responses now return time-limited signed URLs instead of raw R2 keys
- Signed URLs have configurable expiry (default 7 days for product images)
- Applied across all controllers: products, cart, wishlist, orders, admin products

#### Upload Service Update
- `src/services/upload.service.ts` — `uploadImage` now returns `{ key, signedUrl }` instead of `{ url, key }`
- All upload consumers updated to use new return shape

#### Zod Validation Fix
- `src/validators/admin.product.validator.ts` — `updateProductSchema` images array now accepts relative URLs (R2 keys like `/products/...`) in addition to full `https://` URLs
- Fixed product update failures when images stored as R2 keys

#### Digital Product System — Prisma Models
- `DigitalAsset` model — `id, productId, fileName, r2Key, mimeType, fileSize, sortOrder, createdAt`
- `DownloadRecord` model — `id, assetId, orderId, orderItemId, userId, downloadCount, maxDownloads (default 2), expiresAt (7 days), firstDownloadAt, lastDownloadAt, createdAt`
- Added `type` field to `Product` model (`PHYSICAL` | `DIGITAL`, default `PHYSICAL`)
- Added `digitalAssets DigitalAsset[]` relation to `Product` model
- `@@index` on `[productId]` for DigitalAsset, `[userId]`, `[orderId]`, `[assetId]` for DownloadRecord

#### Digital Asset Service
- `src/services/digitalAsset.service.ts` — `uploadDigitalFiles` (upload to R2 `digital-assets/` prefix), `getProductDigitalAssets`, `attachAssetsToProduct`, `deleteDigitalAsset` (with R2 cleanup)

#### Download Service
- `src/services/download.service.ts` — `createDownloadRecords` (creates records for all digital assets in an order), `getUserDownloads` (paginated, with signed URLs), `getOrderDownloads`, `generateDownloadUrl` (enforces 2-download limit and 7-day expiry, returns presigned URL)

#### Download Controller & Routes
- `src/controllers/download.controller.ts` — `getMyDownloads`, `getOrderDownloads`, `generateDownloadUrl`
- `src/routes/download.routes.ts` — mounted at `/api/v1/downloads` (all routes require auth)
  - `GET /downloads` — list user's downloads
  - `GET /downloads/order/:orderId` — downloads for specific order
  - `POST /downloads/:id/generate` — generate time-limited download URL

#### Digital Delivery on Payment
- `src/services/payment.service.ts` — after successful payment, automatically creates download records for digital products and sends branded delivery email
- `src/services/email.service.ts` — added `sendDigitalDeliveryEmail()` with branded gold HTML template, download links, and usage limit notice (2 downloads, 7-day expiry)

### Endpoints Added
- `GET /api/v1/downloads` — list user's downloads with signed URLs (auth)
- `GET /api/v1/downloads/order/:orderId` — downloads for specific order (auth)
- `POST /api/v1/downloads/:id/generate` — generate download URL (auth, enforces limits)
- `POST /api/v1/admin/products/:id/digital-assets` — upload digital files (admin)
- `GET /api/v1/admin/products/:id/digital-assets` — list digital assets (admin)
- `POST /api/v1/admin/digital-assets/attach` — attach temp assets to product (admin)
- `DELETE /api/v1/admin/digital-assets/:id` — delete digital asset (admin)

### Technical Notes
- R2 keys stored in DB, signed on response — URLs auto-expire, no stale public URLs
- Digital delivery is automatic post-payment — no manual admin intervention needed
- Download limit (2) and expiry (7 days) are configurable per-record
- `@aws-sdk/s3-request-presigner` used for generating presigned GET URLs

## [0.8.0] - 2026-02-12

### Added — Phase 5: Admin Panel Backend

#### Cloudflare R2 Image Upload
- `src/configs/r2Config.ts` — S3Client configured for Cloudflare R2 (S3-compatible)
- `src/services/upload.service.ts` — `uploadImage`, `uploadMultipleImages`, `deleteImage`, `deleteMultipleImages`, `extractKeyFromUrl`
- `src/middlewares/upload.middleware.ts` — multer memory storage, 5MB limit, JPEG/PNG/WebP/GIF/SVG filter, `uploadProductImages` (max 10), `uploadCategoryImage` (single)
- `src/controllers/upload.controller.ts` — `POST /admin/upload/images`, `DELETE /admin/upload/images`

#### Admin Product CRUD
- `src/validators/admin.product.validator.ts` — `createProductSchema`, `updateProductSchema`, `adminProductQuerySchema` (Zod v4)
- `src/services/admin.product.service.ts` — `adminListProducts` (filter by status/stock/search, includes inactive), `createProduct` (unique slug generation, variants), `updateProduct` (slug regen, variant replace), `deleteProduct` (soft delete), `hardDeleteProduct`, `getDashboardStats`
- `src/controllers/admin.product.controller.ts` — full CRUD handlers + dashboard stats endpoint

#### Admin Category CRUD
- `src/validators/admin.category.validator.ts` — `createCategorySchema`, `updateCategorySchema`, `adminCategoryQuerySchema`
- `src/services/admin.category.service.ts` — `adminListCategories`, `createCategory` (unique slug), `updateCategory`, `deleteCategory` (soft delete, unlink children, optionally move products), `getCategoryById`
- `src/controllers/admin.category.controller.ts` — full CRUD handlers

#### Admin Routes
- `src/routes/admin.routes.ts` — all routes behind `requireAuth` + `requireAdmin` middleware
  - `GET /admin/dashboard/stats` — aggregate dashboard statistics
  - `GET|POST /admin/products`, `GET|PUT|DELETE /admin/products/:id`
  - `GET|POST /admin/categories`, `GET|PUT|DELETE /admin/categories/:id`
  - `POST|DELETE /admin/upload/images`
- Mounted at `/api/v1/admin` in `app.ts`

### Technical Notes
- Express 5 `req.params.id` returns `string | string[]` — used `as string` cast throughout
- Zod v4 `z.record()` requires two arguments: `z.record(z.string(), z.string())`
- Prisma `InputJsonValue` incompatible with `Record<string, unknown>[]` — solved via `JSON.parse(JSON.stringify())`

## [0.7.1] - 2026-02-11

### Fixed — Cart Unique Constraint Issues
- MongoDB treats `null` as a unique value for unique constraints
- Changed authenticated user cart creation to use `sessionId: "user_{userId}"` placeholder instead of `null`
- Fixed cart migration to use unique placeholder `migrated_{userId}_{timestamp}` instead of `null`
- Updated `getCartIdentifiers()` in cart controller to ignore sessionId entirely when user is authenticated
- Applied fixes to `getOrCreateCart`, `addToCart`, and `mergeGuestCartToUser` functions
- Resolved "Cart_sessionId_key unique constraint failed" errors for authenticated users

### Changed
- Cart service now uses find-then-create pattern instead of upsert for better control and error handling

## [0.7.0] - 2026-02-10

### Added — Service 9: Reviews (Customer-Facing)
- `Review` Prisma model — `productId @db.ObjectId`, `userId`, `userName`, `rating (1-5)`, `title?`, `comment`, `isVerified`, `@@unique([productId, userId])`, indexes on productId and userId
- `src/types/review.types.ts` — `ReviewResponse`, `ReviewSummary` (with rating distribution), `PaginatedReviews`
- `src/validators/review.validator.ts` — `createReviewSchema`, `updateReviewSchema`, `reviewsQuerySchema` (Zod schemas)
- `src/services/review.service.ts` — `getProductReviews` (paginated, filterable by rating, sortable), `getReviewSummary`, `createReview` (auto-verifies if user has DELIVERED order), `updateReview`, `deleteReview`, `getUserReviewForProduct`
- `src/controllers/review.controller.ts` — `getProductReviews`, `getReviewSummary`, `getMyReview`, `createReview`, `updateReview`, `deleteReview`
- `src/routes/review.routes.ts` — mounted at `/api/v1/products/:productId/reviews` with `mergeParams: true`
- Auto-recalculates `Product.avgRating` and `Product.reviewCount` on every create/update/delete via Prisma aggregate
- One review per user per product enforced via `@@unique([productId, userId])`

### Added — Service 10: Wishlist
- `Wishlist` Prisma model — `userId @unique`, one-to-many `WishlistItem[]`
- `WishlistItem` Prisma model — `wishlistId @db.ObjectId`, `productId @db.ObjectId`, `addedAt`, `@@unique([wishlistId, productId])`
- Added `reviews Review[]` and `wishlistItems WishlistItem[]` relations to `Product` model
- `src/types/wishlist.types.ts` — `WishlistItemResponse` (with product details), `WishlistResponse`
- `src/services/wishlist.service.ts` — `getWishlist` (auto-create on first access), `addToWishlist`, `removeFromWishlist`, `isInWishlist`
- `src/controllers/wishlist.controller.ts` — `getWishlist`, `addToWishlist`, `removeFromWishlist`, `checkWishlist`
- `src/routes/wishlist.routes.ts` — all routes behind `requireAuth`

### Changed
- `app.ts` — mounted review routes at `/api/v1/products/:productId/reviews` and wishlist routes at `/api/v1/wishlist`; added both to endpoint info response

### Endpoints Added
- `GET /api/v1/products/:productId/reviews` — paginated reviews (public)
- `GET /api/v1/products/:productId/reviews/summary` — review summary + distribution (public)
- `GET /api/v1/products/:productId/reviews/mine` — current user's review (auth)
- `POST /api/v1/products/:productId/reviews` — create review (auth)
- `PUT /api/v1/products/:productId/reviews/:reviewId` — update own review (auth)
- `DELETE /api/v1/products/:productId/reviews/:reviewId` — delete own review (auth)
- `GET /api/v1/wishlist` — get wishlist with product details (auth)
- `POST /api/v1/wishlist/items` — add product to wishlist (auth)
- `DELETE /api/v1/wishlist/items/:productId` — remove from wishlist (auth)
- `GET /api/v1/wishlist/check/:productId` — check if in wishlist (auth)

## [0.6.2] - 2026-02-09

### Fixed — Resend Email Integration (Render Deploy)
- `resendConfig.ts` simplified to direct `import { Resend } from 'resend'` (matches reference pattern)
- Added `paths` mapping in `tsconfig.json` (`"resend": ["./node_modules/resend/dist/index.d.cts"]`) to resolve Resend SDK exports with default `node10` moduleResolution
- Removed previous `require()` lazy-loading workaround and typed interface shim
- Email receipt now fires from both `handleWebhook()` (primary) and `verifyPayment()` (fallback) via `sendReceiptIfNeeded()` dedup helper
- Dedup prevents duplicate emails — checks `Payment.metadata.receiptSentAt` before sending
- Build and runtime verified on Render.com

## [0.6.1] - 2026-02-09

### Added — Email Receipts (Resend)
- `resend` dependency for transactional emails
- `src/configs/resendConfig.ts` — Resend client instance with env guard
- `src/services/email.service.ts` — `sendOrderReceipt()` fire-and-forget function with full HTML receipt template
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` environment variables in `envConfig.ts`

### Changed
- `payment.service.ts` — `handleWebhook()` now sends order receipt email after successful `charge.success` webhook
- Receipt includes: order number, date, payment channel, itemised line items with images, subtotal/shipping/discount/total, shipping address, "View My Orders" CTA
- Email failures are logged via Winston — never block or break the checkout flow

## [0.6.0] - 2026-02-09

### Added — Service 8: Payments (Paystack)
- `Payment` Prisma model with `orderId @unique`, `userId`, `amount`, `currency`, `status`, `provider`, `reference @unique`, `paystackId`, `channel`, `metadata`, `paidAt`, timestamps
- `PaymentStatus` enum (PENDING, COMPLETED, FAILED, REFUNDED)
- `src/configs/paystackConfig.ts` — Paystack API helper (`initializeTransaction`, `verifyTransaction`, `verifyWebhookSignature` HMAC SHA-512)
- `src/types/payment.types.ts` — `PaymentResponse`, `InitializePaymentResult`, `VerifyPaymentResult`, `PaystackInitResponse`, `PaystackVerifyResponse`, `PaystackWebhookEvent`
- `src/validators/payment.validator.ts` — `initializePaymentSchema` (orderId)
- `src/services/payment.service.ts` — `initializePayment` (ownership check, CREATED status guard, idempotent re-init for PENDING, creates Payment record, calls Paystack API), `verifyPayment` (verify with Paystack, update Payment + Order status in transaction), `handleWebhook` (idempotent charge.success/charge.failed handling)
- `src/controllers/payment.controller.ts` — `initialize`, `verify`, `webhook` (HMAC signature verification, no auth)
- `src/routes/payment.routes.ts` — POST `/initialize` (requireAuth), GET `/verify/:reference` (requireAuth), POST `/webhook` (no auth)
- Mounted at `/api/v1/payments` in `app.ts`
- `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` in envConfig

### Endpoints Added
- `POST /api/v1/payments/initialize` — initialize Paystack payment for an order (auth required)
- `GET /api/v1/payments/verify/:reference` — verify payment status (auth required)
- `POST /api/v1/payments/webhook` — Paystack webhook handler (HMAC SHA-512 verified, no auth)

### Payment Flow
1. User creates order (status: CREATED) → POST `/orders`
2. Frontend calls POST `/payments/initialize` with orderId
3. Backend creates Payment (PENDING), calls Paystack API, returns authorization URL
4. User redirected to Paystack hosted payment page
5. On success: Paystack redirects to `/checkout/success?reference=xxx`
6. Frontend calls GET `/payments/verify/:reference` → backend verifies with Paystack, updates Payment (COMPLETED) + Order (PAID)
7. Paystack also sends webhook POST → backend processes idempotently

## [0.5.0] - 2026-02-09

### Added — Service 6: Addresses
- `Address` Prisma model with `userId`, `label`, `firstName`, `lastName`, `phone`, `street`, `apartment`, `city`, `state`, `country` (default "Nigeria"), `postalCode`, `isDefault`, timestamps
- `@@index([userId])` for efficient per-user queries
- `src/types/address.types.ts` — `AddressResponse` interface, `ADDRESS_LIMITS` (max 5 per user), `NIGERIAN_STATES` tuple constant (37 states)
- `src/validators/address.validator.ts` — `createAddressSchema`, `updateAddressSchema` with `z.enum(NIGERIAN_STATES)` for state validation
- `src/services/address.service.ts` — `getUserAddresses`, `getAddressById`, `createAddress` (enforces max 5, auto-default for first), `updateAddress`, `deleteAddress` (prevents deleting default), `setDefaultAddress`
- `src/controllers/address.controller.ts` — 6 controller functions wrapped in `catchAsync`
- `src/routes/address.routes.ts` — all routes behind `requireAuth`
- Mounted at `/api/v1/addresses` in `app.ts`

### Endpoints Added
- `GET /api/v1/addresses` — list user addresses (default first, then newest)
- `GET /api/v1/addresses/:id` — get single address (ownership enforced)
- `POST /api/v1/addresses` — create address (max 5 limit)
- `PUT /api/v1/addresses/:id` — update address
- `DELETE /api/v1/addresses/:id` — delete address (cannot delete default)
- `PATCH /api/v1/addresses/:id/default` — set as default address

## [0.4.0] - 2026-02-09

### Added — Service 5: Cart & Orders
- `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderStatusHistory` Prisma models
- `OrderStatus` enum (PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED)
- Cart service with guest (sessionId) and authenticated (userId) support
- Cart merge on login (guest → authenticated)
- Checkout service with cart validation (stock + price verification)
- Order service with order creation from cart, order listing with pagination, order detail, and cancellation
- Shipping calculation (free over ₦50,000, flat ₦2,500 otherwise)
- Order number generation (`WS-YYYYMMDD-XXXXX` format)
- Stock decrement on order creation (transactional)

### Endpoints Added
- `GET /api/v1/cart` — get or create cart
- `POST /api/v1/cart/items` — add item to cart
- `PATCH /api/v1/cart/items/:id` — update cart item quantity
- `DELETE /api/v1/cart/items/:id` — remove cart item
- `DELETE /api/v1/cart` — clear cart
- `POST /api/v1/cart/merge` — merge guest cart into user cart
- `POST /api/v1/checkout/validate` — validate cart for checkout
- `POST /api/v1/orders` — create order from cart
- `GET /api/v1/orders` — list user orders (paginated)
- `GET /api/v1/orders/:id` — get order detail
- `GET /api/v1/orders/number/:orderNumber` — get order by order number
- `POST /api/v1/orders/:id/cancel` — cancel order

## [0.3.0] - 2026-02-09

### Added — Service 3: Products
- Product, ProductImage, and ProductVariant Prisma models
- Product list and detail endpoints with filtering and pagination
- Product validators, service, controller, and routes

### Added — Service 4: Categories
- Category Prisma model
- Category list and detail endpoints
- Category validators, service, controller, and routes

## [0.2.0] - 2026-02-08

### Added — Service 1: Auth Middleware
- JWT authentication middleware (`requireAuth`, `optionalAuth`) with local token verification
- Admin authorization middleware (`requireAdmin`) for role-based access control
- Zod validation middleware (`validate`, `validateQuery`) for request body and query param validation
- Express Request type extension with `JwtPayload` (id, email, firstName, lastName, role)
- Cookie-parser support for reading HttpOnly JWT cookies from WorldStreet Identity
- JWT environment config: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`

### Added — Service 2: Profile
- `UserProfile` Prisma model with userId, email, firstName, lastName, phone, avatar, dateOfBirth, gender
- `Gender` enum (MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY)
- Profile service with auto-create on first access (`getOrCreateProfile`)
- Profile update with Zod validation (`updateProfileSchema`)
- `GET /api/v1/profile` — fetch authenticated user's profile
- `PATCH /api/v1/profile` — update profile fields

### Changed
- CORS now configured for `shop.worldstreetgold.com` + localhost dev origins, with `credentials: true`
- CORS allows `X-Session-ID` header (for future guest cart)
- `envConfig.ts` exports `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `CLIENT_URL`

### Dependencies
- Added: `jsonwebtoken`, `@types/jsonwebtoken`, `zod`, `cookie-parser`, `@types/cookie-parser`

## [0.1.0] - Initial

### Added
- Express 5 server with TypeScript
- Prisma with MongoDB connection
- Rate limiting, Sentry error tracking, Winston logging
- Task CRUD sample routes
- Health check endpoint
