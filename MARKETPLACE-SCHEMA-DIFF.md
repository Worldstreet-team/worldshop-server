# Schema diff: ecommerce → subscription marketplace

Revised 2026-07-26 to match the clarified product spec.

## The model

A vendor signs up, creates a store, and fills it with richly detailed product
listings (images, sizes, specs). The store stays **private until the first
subscription payment clears** — $5/month keeps it visible. Buyers browse, read
reviews, and start a **chat thread on the platform**; the vendor replies there.
Sales themselves happen off-platform.

So the platform sells one thing to vendors — visibility — and offers one thing
to buyers: a trustworthy way to find and talk to a seller.

## What changed from the first draft

| Area | First draft | Now |
|---|---|---|
| Reviews | Removed | **Restored**, re-anchored to conversations |
| `ProductVariant` | Deleted (69 rows) | **Kept** — sizes are explicitly required |
| Contact | Phone/WhatsApp reveal | **In-platform chat first**, other channels secondary |
| Store visibility | `PENDING → ACTIVE` | **`DRAFT` until first charge clears** |
| Pricing | NGN, undecided | **USD $5/mo on the existing wallet rail** |

---

## Finding: the billing rail already exists

`worldshop` is already a registered platform on the WorldStreet dollar-wallet
service. Live in `user-account`:

```
dollarspendcharges.platform  →  ['livestream', 'prediction', 'worldshop']
sample: { platform: 'worldshop', currency: 'USD', amountMinor: 349,
          platformRevenueMinor: 349, description: 'WorldShop order WS-...' }
```

`src/services/payment/providers/wallet.provider.ts` already speaks to it
(`WALLET_API_URL`, `WALLET_SERVICE_TOKEN`, hold/capture/refund primitives), and
3,217 users hold `dollaraccounts` denominated in USD minor units.

Two consequences:

1. **Bill in USD, not NGN.** The $5 becomes `amountMinor: 500, currency: 'USD'`
   on a rail that already works. The NGN→USD FX conversion in
   `wallet.provider.ts` (CoinGecko / er-api, rounded up so the platform never
   undercharges) exists only because *orders* were priced in NGN. A subscription
   priced natively in USD skips FX entirely — no rate risk, no rounding drift.
2. **`chargeRef` is your idempotency key.** The renewal cron will retry, and
   double-charging a vendor is the fastest way to lose one. Derive it
   deterministically: `sub_<storeId>_<periodStart>`.

The subscription charge should reuse the spend-charge primitive rather than
introduce a second payment path. What's needed is a caller, not a rail.

---

## 1. Remove

| Model | Why |
|---|---|
| `Cart`, `CartItem` | No on-platform checkout |
| `Order`, `OrderItem`, `OrderStatusHistory` | No on-platform orders |
| `Payment` | Buyers never pay the platform |
| `DeliveryPartner`, `ShippingMethod` | Nothing ships |
| `DigitalAsset`, `DownloadRecord` | No fulfilment |
| `Address` | Buyer delivery addresses; store location moves to `Store` |
| `VendorBalance`, `VendorWithdrawalAccount`, `VendorWithdrawalRequest` | Vendors pay in, never out — see open decision |
| `OrderStatus`, `PaymentStatus`, `PaymentProvider` enums | Unused after the above |

All except the vendor-financial rows are already deleted (2026-07-26).

**Resolved 2026-07-26 — the NGN 523,170 across 5 vendor balances was not real
money.** An audit traced every balance to its ledger entry, order and payment.
All five reconcile exactly — but the payments behind ₦518,370 of the ₦523,170
were verified against Flutterwave in **TEST mode** (`FLWSECK_TEST…`), where
sandbox cards return a clean "successful" and no funds move. The only genuine
charge the platform has ever taken is **$3.49** (order `WS-20260710-T8R6A`,
confirmed against `user-account.dollarspendcharges`), and that buyer was the
platform owner, who waived it.

Additional findings: none of the six orders was ever shipped or delivered, one
buyer ("Joshua Boyi", across two sequential-email accounts) accounts for
₦576,500 of ₦581,300, and the ₦190,000 order has that same person on both
sides of the transaction.

The balances were briefly converted to credit and then fully reversed
($382.75 granted, $382.75 reversed — the `StoreCreditEntry` trail retains
both). `VendorBalance` and `VendorWithdrawalAccount` have since been deleted by
the `financial` teardown phase. All 73 stores hold $0.00.

## 2. Keep, with changes

### `Product` — a listing, but a *detailed* one

The spec asks for maximum detail per listing, so the descriptive fields all
stay. What goes is inventory and checkout.

```prisma
enum ListingStatus {
  DRAFT
  PENDING      // awaiting moderation
  ACTIVE
  HIDDEN       // store subscription lapsed
  REJECTED
  ARCHIVED
}

enum PriceType {
  FIXED
  RANGE
  ON_REQUEST
}

model Product {
  id            String        @id @default(auto()) @map("_id") @db.ObjectId
  name          String
  slug          String        @unique
  description   String
  shortDesc     String?

  storeId       String        @db.ObjectId          // was: vendorId String?
  store         Store         @relation(fields: [storeId], references: [id], onDelete: Cascade)

  categoryId    String?       @db.ObjectId
  category      Category?     @relation(fields: [categoryId], references: [id])

  // Price is indicative — nothing is charged here
  priceType     PriceType     @default(FIXED)
  basePrice     Float?                              // was: required
  maxPrice      Float?                              // when priceType = RANGE
  currency      String        @default("NGN")       // listing prices stay local
  isNegotiable  Boolean       @default(true)

  // "every single detail"
  condition     String?                             // NEW, USED, REFURBISHED
  brand         String?
  material      String?
  specs         Json?                               // free-form spec sheet
  weightGrams   Int?
  dimensions    Json?
  tags          String[]
  images        Json          @default("[]")        // enforce a minimum in validation

  state         String                              // primary browse filter
  city          String?

  status        ListingStatus @default(DRAFT)
  publishedAt   DateTime?
  isFeatured    Boolean       @default(false)

  avgRating     Float         @default(0)
  reviewCount   Int           @default(0)
  viewCount     Int           @default(0)
  inquiryCount  Int           @default(0)

  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  variants      ProductVariant[]
  reviews       Review[]
  conversations Conversation[]

  @@index([storeId])
  @@index([categoryId, status])
  @@index([state, status])
  @@index([status, publishedAt])
}
```

Dropped: `stock`, `lowStockThreshold`, `stockKeepingUnit`, `salePrice`,
`type` (PHYSICAL/DIGITAL), `approvalStatus` (folded into `status`),
`isNewArrival`, and the cart/order/digital-asset relations.

### `ProductVariant` — kept

Sizes and colours are explicitly part of the spec. Drop only the commerce
fields; keep the variant as a *descriptive* axis.

```prisma
model ProductVariant {
  id         String   @id @default(auto()) @map("_id") @db.ObjectId
  productId  String   @db.ObjectId
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  name       String
  attributes Json     // { size: "XL", color: "Red" }
  price      Float?   // optional per-variant indicative price
  isAvailable Boolean @default(true)   // replaces stock: Int
  images     Json     @default("[]")   // NEW — variant-specific photos

  @@index([productId])
}
```

Dropped: `stock`, `stockKeepingUnit`, `compareAtPrice`, cart/order relations.

### `Review` — restored, anchored to conversations

Reviews are back in scope. The old anchor is gone: `isVerified` used to mean
"this user has a DELIVERED order for this product", and there are no orders any
more. Without *some* anchor this is an open fake-review surface, and it's the
single most common way classifieds platforms lose buyer trust.

The anchor the new model gives you for free is **the conversation**. A buyer
who opened a thread with the vendor and received a reply has demonstrably made
contact.

```prisma
model Review {
  id             String   @id @default(auto()) @map("_id") @db.ObjectId
  productId      String   @db.ObjectId
  product        Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  storeId        String   @db.ObjectId              // NEW — enables store-level rating
  userId         String
  userName       String
  rating         Int                                // 1-5
  title          String?
  comment        String

  // Trust anchor: set when the reviewer has a replied-to thread on this listing
  conversationId String?  @db.ObjectId
  isVerified     Boolean  @default(false)           // "contacted this seller"

  vendorReply    String?                            // NEW — right of reply
  vendorRepliedAt DateTime?

  status         String   @default("PUBLISHED")     // PUBLISHED, FLAGGED, REMOVED

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([productId, userId])
  @@index([productId])
  @@index([storeId])
}
```

Giving vendors a right of reply matters more here than in an ecommerce shop:
they have no refund or resolution lever, so a public response is their only
defence against an unfair review.

The 23 existing reviews are in the backup but were written against the purchase
model. I'd start clean rather than restore them — they'd all carry
`isVerified: false` under the new anchor anyway.

### `Category` / `CategoryAttribute` — kept, and load-bearing

`CategoryAttribute` is what makes "every single detail" enforceable rather than
aspirational: it defines per-category required fields, and `isRequired` becomes
a publish-time gate. With `appliesTo` supporting both PRODUCT and VARIANT, it
covers the sizes case directly. The taxonomy wants redesigning, but the model
doesn't.

### `LedgerEntry` — repurposed

```prisma
enum LedgerEntryType {
  SUBSCRIPTION_CHARGE
  CREDIT_ADJUSTMENT     // admin grant / migrated legacy balance
  REFUND
  REVERSAL
}
```

Local audit mirror of what the wallet service did. `reference` holds the
wallet's `chargeRef`.

## 3. Add

### `Store`

```prisma
enum StoreStatus {
  DRAFT        // created, never paid — visible only to its owner
  ACTIVE       // subscription current
  GRACE        // payment failed, still visible
  EXPIRED      // lapsed — hidden from browse
  SUSPENDED
  BANNED
}

enum VerificationTier {
  UNVERIFIED
  EMAIL_VERIFIED
  ID_VERIFIED
  BUSINESS_VERIFIED
}

model Store {
  id               String           @id @default(auto()) @map("_id") @db.ObjectId
  ownerId          String           @unique          // UserProfile.userId
  name             String
  slug             String           @unique          // required → plain unique index
  description      String?
  logo             String?
  banner           String?

  phone            String?
  whatsapp         String?
  email            String?
  website          String?

  state            String
  city             String?
  address          String?
  openingHours     Json?

  status           StoreStatus      @default(DRAFT)
  verificationTier VerificationTier @default(UNVERIFIED)
  verifiedAt       DateTime?

  avgRating        Float            @default(0)      // rolled up from reviews
  reviewCount      Int              @default(0)
  listingCount     Int              @default(0)
  responseRate     Float?                            // % of threads replied to
  avgResponseMins  Int?                              // both surfaced to buyers

  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  listings         Product[]
  subscription     Subscription?

  @@index([status])
  @@index([state, status])
}
```

`responseRate` / `avgResponseMins` are cheap to compute from threads and are
the strongest trust signal you can offer when nothing is transacted on
platform. They also give a vendor a concrete reason to answer chats.

### Subscriptions

```prisma
enum SubscriptionStatus {
  PENDING_PAYMENT   // store created, never charged — no trial
  ACTIVE
  GRACE
  LAPSED
  CANCELLED
}

model SubscriptionPlan {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  code          String   @unique                  // "standard"
  name          String
  amountMinor   Int                               // 500 = $5.00
  currency      String   @default("USD")
  intervalDays  Int      @default(30)
  listingLimit  Int?                              // null = unlimited
  perks         String[]
  isActive      Boolean  @default(true)
}

model Subscription {
  id                 String             @id @default(auto()) @map("_id") @db.ObjectId
  storeId            String             @unique @db.ObjectId
  store              Store              @relation(fields: [storeId], references: [id], onDelete: Cascade)
  planId             String             @db.ObjectId
  status             SubscriptionStatus @default(PENDING_PAYMENT)

  currentPeriodStart DateTime?
  currentPeriodEnd   DateTime?
  graceEndsAt        DateTime?
  autoRenew          Boolean            @default(true)
  cancelledAt        DateTime?

  charges            SubscriptionCharge[]

  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  @@index([status, currentPeriodEnd])   // drives the daily renewal sweep
}

model SubscriptionCharge {
  id             String       @id @default(auto()) @map("_id") @db.ObjectId
  subscriptionId String       @db.ObjectId
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  storeId        String       @db.ObjectId
  amountMinor    Int
  currency       String       @default("USD")
  periodStart    DateTime
  periodEnd      DateTime
  status         String       @default("PENDING")  // PENDING, PAID, FAILED
  failureReason  String?                           // e.g. INSUFFICIENT_FUNDS
  chargeRef      String       @unique              // sub_<storeId>_<periodStart>
  chargedAt      DateTime?
  createdAt      DateTime     @default(now())

  @@index([storeId])
  @@index([status])
}
```

**Lifecycle.** Store created → `DRAFT`, `PENDING_PAYMENT`, owner-visible only.
First successful charge → `ACTIVE`, listings publishable. Renewal fails →
`GRACE` (still visible; make this window generous — an insufficient wallet
balance is not intent to churn) → `EXPIRED`, listings flip to `HIDDEN` rather
than being deleted, so paying again restores everything instantly.

### Chat

Chat is now the primary contact channel, so it belongs in this service rather
than borrowed from `social-db` — reviews are anchored to it, and
`responseRate` is computed from it.

```prisma
model Conversation {
  id            String    @id @default(auto()) @map("_id") @db.ObjectId
  listingId     String?   @db.ObjectId
  listing       Product?  @relation(fields: [listingId], references: [id], onDelete: SetNull)
  storeId       String    @db.ObjectId
  buyerId       String                              // UserProfile.userId
  lastMessageAt DateTime  @default(now())
  buyerUnread   Int       @default(0)
  vendorUnread  Int       @default(0)
  vendorFirstReplyAt DateTime?                      // feeds avgResponseMins
  status        String    @default("OPEN")          // OPEN, ARCHIVED, BLOCKED
  createdAt     DateTime  @default(now())

  messages      Message[]

  @@unique([listingId, buyerId])                    // one thread per listing per buyer
  @@index([storeId, lastMessageAt])
  @@index([buyerId, lastMessageAt])
}

model Message {
  id             String       @id @default(auto()) @map("_id") @db.ObjectId
  conversationId String       @db.ObjectId
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String
  senderRole     String                             // BUYER, VENDOR
  body           String
  attachments    Json         @default("[]")
  readAt         DateTime?
  createdAt      DateTime     @default(now())

  @@index([conversationId, createdAt])
}
```

Worth deciding early: whether contact details in message bodies are stripped or
allowed. Letting vendors move buyers to WhatsApp immediately is fine for them
and bad for you — you lose the response-rate signal, the review anchor, and any
evidence of the value you're charging $5 for.

### Moderation

With money off-platform, de-listing is the only enforcement lever left.

```prisma
model Report {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  reporterId  String?
  targetType  String                              // LISTING, STORE, REVIEW, MESSAGE
  targetId    String   @db.ObjectId
  reason      String                              // SCAM, PROHIBITED, MISLEADING, FAKE_REVIEW, OTHER
  details     String?
  status      String   @default("OPEN")
  reviewedBy  String?
  reviewedAt  DateTime?
  createdAt   DateTime @default(now())

  @@index([status, createdAt])
  @@index([targetType, targetId])
}
```

### Analytics

```prisma
// Daily rollup — per-view rows would outgrow everything else in the database.
model ListingStat {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  listingId String   @db.ObjectId
  storeId   String   @db.ObjectId
  date      DateTime                             // midnight UTC
  views     Int      @default(0)
  inquiries Int      @default(0)

  @@unique([listingId, date])
  @@index([storeId, date])
}
```

This is the renewal argument. "You got 40 inquiries this month" is what makes
the next $5 feel obvious; without it the charge looks like rent.

---

## Build order

1. `Store` + `Subscription*` + subscription service calling the existing
   wallet spend-charge rail. Nothing else works until stores can go live.
2. Backfill 73 `Store` rows from the vendor `UserProfile` fields, repoint
   `Product.storeId` from `vendorId`, then run `npm run teardown -- stores`.
3. Reshape `Product` / `ProductVariant`; enforce `CategoryAttribute.isRequired`
   at publish time.
4. Chat (`Conversation`, `Message`) — required before reviews, which anchor to it.
5. Reviews + store rating rollup + vendor right of reply.
6. `ListingStat`, `Report`, verification tiers.
7. Renewal cron: sweep `currentPeriodEnd <= now`, charge, transition state.
8. Drop `scripts/db-push-helper.ts` and the prepare/finish sandwich — with
   `Cart` gone and `storeSlug` moved to a required `Store.slug`, both partial
   indexes disappear.

## One open risk

$5/month with no free tier means the store is invisible until a vendor pays,
and a new vendor's first experience is an empty store they're paying for. With
73 vendors and no buyer traffic yet, expect most not to convert. Consider
either a first-month-free period on the same rail (charge $0, same state
machine) or seeding the marketplace with the existing 213 listings visible
before enforcement starts, so early vendors arrive to something that already
looks alive.
