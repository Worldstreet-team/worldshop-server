# Listings design

How vendors describe products, and what makes a product public.

## The four decisions

| Question | Decision |
|---|---|
| Custom fields vs. search | **Two layers** — admin attributes are filterable, vendor custom fields are display-only |
| Category structure | **Two levels**, one category per listing, attributes on the leaf |
| What makes a listing public | **Payment publishes**, plus a report queue and admin takedown |
| Sizes and variants | **Full variants** — own indicative price, photos, availability |

## Two layers of detail

The requirement pulls two ways: vendors need unlimited freedom to describe unique products, and buyers need filters that actually work. Filters need a shared vocabulary; free text doesn't have one. So detail is stored twice, in two shapes with two different jobs.

**Layer 1 — `Product.attributes`** (structured, filterable)

```json
{ "Condition": "New", "Size": "XL", "Storage": "128GB" }
```

Keys must match a `CategoryAttribute` the admin defined for that category. Values are validated: `SELECT` against `options`, `NUMBER` for numerics, and `isRequired` blocks publishing. This is what `?attr.Condition=New` filters on. An unknown key is **rejected**, not dropped — silently discarding it would leave a vendor believing they'd recorded something search will never see.

**Layer 2 — `Product.customFields`** (free-form, display-only)

```json
[{ "label": "Made to order", "value": "5 working days", "sortOrder": 0 }]
```

Up to 30 rows per product, any label the vendor invents, rendered as a spec table. Deliberately not filterable: allowing it produces `Colour`, `colour`, `Color` and `Shade` as four separate facets within a week, and filter quality degrades as the catalogue grows — the opposite of the goal.

The rule of thumb for admins: **if buyers would want to filter by it, it belongs in the category as an attribute.** Everything else is a custom field.

This also closes a gap that was already flagged in `listing-standards.service.ts` — PRODUCT-level attributes could previously only be enforced against `brand` and `material`, because those were the only columns available to hold a value. Any admin-defined attribute is now enforceable.

## Categories

Two levels: **Fashion > Dresses**. Listings attach to a leaf only; a parent is a browse heading. Filing at both levels would split identical products across two tiers and make filtering inconsistent, so posting to a parent returns:

> "Fashion" is a top-level category — choose one of its subcategories

`CategoryAttribute` rows hang off the leaf, which is what makes the vendor form dynamic: `GET /stores/me/listings/form-spec?categoryId=` returns the fields to render, their allowed values, which are required, and which are filterable. The vendor UI builds itself from that rather than hardcoding a form per category.

## The two gates

A listing is public only when **both** are open:

1. the listing is `PUBLISHED` — the vendor says it's ready
2. the store is `ACTIVE` or `GRACE` — the $5 has cleared

Vendors can build the entire catalogue and publish every item while still unpaid. Nothing is visible, and `publishListing` says so explicitly:

> Listing is ready. It becomes visible to buyers as soon as your subscription is active.

Then one successful charge flips `Store.status` to `ACTIVE` and the whole catalogue appears at once — no per-listing action needed. That ordering is deliberate: asking someone to pay before they can see their own storefront populated is a far worse sell than showing them a finished shop behind a paywall. It's also why `requireStore` does **not** check the subscription — the paywall gates who can *see* listings, not who can *author* them.

`ListingStatus`: `DRAFT` → `PUBLISHED` → `HIDDEN` (vendor unpublished) / `REMOVED` (admin takedown, not editable by the vendor).

## Publishing standards

`publishListing` runs the category's listing standards before flipping status — this is where "well-detailed" stops being a hope:

- a category is required
- at least one image for physical listings
- every `isRequired` attribute present and valid
- `SELECT` values within `options`, `NUMBER` values numeric
- variant-level required attributes present on every variant

All problems are returned at once rather than one at a time, so the vendor fixes them in a single pass.

## API

**Owner** (`requireAuth` + `requireStore`)
```
GET    /api/v1/stores/me/listings                 ?status=&categoryId=&search=&page=&limit=
POST   /api/v1/stores/me/listings                 → DRAFT
GET    /api/v1/stores/me/listings/form-spec       ?categoryId=
GET    /api/v1/stores/me/listings/:id
PATCH  /api/v1/stores/me/listings/:id
DELETE /api/v1/stores/me/listings/:id
POST   /api/v1/stores/me/listings/:id/publish
POST   /api/v1/stores/me/listings/:id/unpublish
```

**Public**
```
GET /api/v1/listings   ?categoryId=&state=&search=&attr.<Name>=<Value>&page=&limit=
```

Both gates are enforced in one place, in `listPublicListings`.

## Variants

Kept as structured rows, with the commerce fields stripped. Each variant has a name, its own attribute map (`{ Size: "L", Colour: "Blue" }`), an optional indicative price, an `isAvailable` flag replacing `stock`, and **its own photos** — which matter most for clothing and shoes, where the colour is the product.

## The taxonomy

Seeded by `npm run seed:taxonomy` — **14 top-level, 81 leaves, 221 attributes**.
Additive and idempotent; nothing is ever deleted, because products reference
categories and deleting would orphan live data.

| Top level | Leaves |
|---|---|
| Phones & Tablets | 5 |
| Electronics | 7 |
| Fashion | 8 |
| Beauty & Personal Care | 6 |
| Home, Furniture & Appliances | 7 |
| Vehicles | 5 |
| Property | 5 |
| Baby & Kids | 5 |
| Food & Agriculture | 5 |
| Health & Fitness | 5 |
| Business & Industrial | 5 |
| Services | 10 |
| Books, Media & Hobbies | 5 |
| Pets & Animals | 3 |

Attributes are written for this market rather than translated from a generic
template. Land and property carry **Title Document** (Certificate of Occupancy,
Governor's Consent, Deed of Assignment, Excision, Gazette, Family Receipt) —
the first question any Nigerian buyer asks. Cars carry **Registration**
(Registered / Unregistered-Custom Duty Paid / Unregistered). Phone brands lead
with Tecno, Infinix and itel alongside Apple and Samsung. Wigs get Length,
Texture and Cap Type. Generators get Capacity and local brands (Elepaq, Tiger,
Sumec Firman, Mikano). Services all share Pricing Model / Service Type /
Experience.

`Condition` is deliberately **not** an attribute anywhere — it's a first-class
column on `Product`, so it filters uniformly instead of being redefined 81
times.

## Admin management

The taxonomy is editable through the API, not just seeded. `admin.category.service.ts`
enforces the two-level invariant that everything else relies on:

```
GET    /api/v1/admin/categories/tree                        tree + per-leaf counts
GET    /api/v1/admin/categories/:id/attributes
POST   /api/v1/admin/categories/:id/attributes
PATCH  /api/v1/admin/categories/:id/attributes/:attributeId
DELETE /api/v1/admin/categories/:id/attributes/:attributeId?force=true
PUT    /api/v1/admin/categories/:id/attributes/order        bulk reorder
```

Guards worth knowing:

- A third level is rejected; a category with children cannot become a child.
- A category with listings cannot be given children — that would invalidate every listing filed against it.
- Attributes live on leaves only.
- Tightening a rule (dropping an option, making a field required) is allowed and **reports how many listings it invalidates**. Those listings stay visible but cannot be republished until fixed — the admin sees the blast radius rather than being blocked.
- Deleting an in-use attribute needs `force=true` and clears the orphaned key from affected listings, so vendors aren't locked out of editing them.
- Renaming does **not** change the slug unless asked.

## Not built yet
- **`condition` is not yet a public filter** — the column exists and is set on create, but `GET /listings` doesn't expose it as a query param yet.
- **Re-filing the 184 legacy listings** onto leaf categories.
- **Report queue** — the `Report` model exists; no endpoints or admin review screen.
- **Image upload wiring** — listings accept image keys; the existing R2 upload endpoints need pointing at the new routes.
