import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as chat from '../../services/chat.service';
import * as reviews from '../../services/marketplace.review.service';

const PREFIX = 'revtest-';
const SLUG = 'revtest';

let categoryId: string;

async function cleanup() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const storeIds = stores.map((s) => s.id);

  if (storeIds.length) {
    const convos = await prisma.conversation.findMany({
      where: { storeId: { in: storeIds } },
      select: { id: true },
    });
    if (convos.length) {
      await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
      await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
    }
    await prisma.review.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.product.deleteMany({ where: { storeId: { in: storeIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

async function makeStore(name: string) {
  const ownerId = `${PREFIX}vendor-${name}`;
  await createTestUser({ userId: ownerId });
  return prisma.store.create({
    data: { ownerId, name: `${name} Store`, slug: `${SLUG}-${name}`, state: 'Lagos', status: 'ACTIVE' },
  });
}

async function makeListing(storeId: string) {
  return prisma.product.create({
    data: {
      name: `${SLUG} listing ${Math.random().toString(36).slice(2, 8)}`,
      slug: `${SLUG}-l-${Math.random().toString(36).slice(2, 10)}`,
      description: 'A listing used for review tests',
      basePrice: 9000,
      categoryId,
      storeId,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
}

async function makeBuyer(name: string) {
  const id = `${PREFIX}buyer-${name}`;
  await createTestUser({ userId: id, firstName: 'Ada', lastName: 'Buyer' });
  return id;
}

const body = { rating: 5, comment: 'Exactly as described and packaged well.' };

describe('marketplace reviews', () => {
  beforeAll(async () => {
    await cleanup();
    const category = await prisma.category.upsert({
      where: { slug: `${SLUG}-cat` },
      create: { name: 'Revtest Category', slug: `${SLUG}-cat` },
      update: {},
    });
    categoryId = category.id;
  });

  afterEach(cleanup);
  afterAll(async () => {
    await prisma.category.deleteMany({ where: { slug: `${SLUG}-cat` } });
  });

  it('refuses a review from someone who never contacted the seller', async () => {
    const store = await makeStore('nocontact');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('nocontact');

    const eligibility = await reviews.checkEligibility(buyer, listing.id);
    expect(eligibility).toMatchObject({ canReview: false, wouldBeVerified: false });
    expect(eligibility.reason).toMatch(/message the seller/i);

    await expect(reviews.createReview(buyer, listing.id, body)).rejects.toThrow(/message the seller/i);
  });

  it('allows an unverified review after contact, even if the vendor ignored it', async () => {
    const store = await makeStore('ignored');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('ignored');

    await chat.startConversation(buyer, { listingId: listing.id, message: 'Is this available?' });

    // Requiring a reply would hand vendors a suppression switch: ignore anyone
    // who sounds unhappy and they could never review you.
    const eligibility = await reviews.checkEligibility(buyer, listing.id);
    expect(eligibility).toMatchObject({ canReview: true, wouldBeVerified: false });

    const review = await reviews.createReview(buyer, listing.id, { rating: 2, comment: 'Never replied to me at all.' });
    expect(review.isVerified).toBe(false);
    expect(review.conversationId).toBeTruthy();
  });

  it('marks a review verified once the vendor has replied', async () => {
    const store = await makeStore('replied');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('replied');

    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Any discount?' });
    await chat.sendMessage(store.ownerId, convo!.id, 'Yes, a small one');

    const review = await reviews.createReview(buyer, listing.id, body);
    expect(review.isVerified).toBe(true);
  });

  it('stops a vendor reviewing their own store', async () => {
    const store = await makeStore('selfreview');
    const listing = await makeListing(store.id);

    const eligibility = await reviews.checkEligibility(store.ownerId, listing.id);
    expect(eligibility.reason).toMatch(/your own store/i);
  });

  it('allows one review per listing per person', async () => {
    const store = await makeStore('once');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('once');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'A question' });

    await reviews.createReview(buyer, listing.id, body);
    await expect(reviews.createReview(buyer, listing.id, body)).rejects.toThrow(/already reviewed/i);
  });

  it('rolls the rating up to both the listing and the store', async () => {
    const store = await makeStore('rollup');
    const listingA = await makeListing(store.id);
    const listingB = await makeListing(store.id);

    const buyer1 = await makeBuyer('rollup1');
    const buyer2 = await makeBuyer('rollup2');
    await chat.startConversation(buyer1, { listingId: listingA.id, message: 'Question one' });
    await chat.startConversation(buyer2, { listingId: listingB.id, message: 'Question two' });

    await reviews.createReview(buyer1, listingA.id, { rating: 5, comment: 'Great seller, very responsive.' });
    await reviews.createReview(buyer2, listingB.id, { rating: 3, comment: 'Item was okay, nothing special.' });

    const a = await prisma.product.findUnique({ where: { id: listingA.id } });
    expect(a).toMatchObject({ avgRating: 5, reviewCount: 1 });

    // The store averages across all its listings.
    const s = await prisma.store.findUnique({ where: { id: store.id } });
    expect(s).toMatchObject({ avgRating: 4, reviewCount: 2 });
  });

  it('keeps a store review when the listing it was left on is deleted', async () => {
    const store = await makeStore('survives');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('survives');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    await reviews.createReview(buyer, listing.id, { rating: 1, comment: 'Item never arrived as promised.' });

    // A vendor must not be able to bury a bad review by deleting the listing,
    // so storeId is stored on the review independently.
    const stored = await prisma.review.findFirst({ where: { storeId: store.id } });
    expect(stored?.storeId).toBe(store.id);
  });

  it('lets the vendor reply publicly', async () => {
    const store = await makeStore('reply');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('reply');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    const review = await reviews.createReview(buyer, listing.id, { rating: 2, comment: 'Took ages to respond to me.' });

    const replied = await reviews.replyToReview(store.ownerId, review.id, 'Sorry — we were shut for a public holiday.');
    expect(replied.vendorReply).toMatch(/public holiday/);
    expect(replied.vendorRepliedAt).not.toBeNull();

    const other = await makeStore('notmine');
    await expect(reviews.replyToReview(other.ownerId, review.id, 'Not my review')).rejects.toThrow(
      /not on your store/i,
    );
  });

  it('drops the vendor reply when the review text is edited', async () => {
    const store = await makeStore('edited');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('edited');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    const review = await reviews.createReview(buyer, listing.id, { rating: 2, comment: 'Original complaint text.' });
    await reviews.replyToReview(store.ownerId, review.id, 'Answering the original complaint');

    const updated = await reviews.updateReview(buyer, review.id, { comment: 'Completely different complaint now.' });

    // Leaving the reply attached would misrepresent what the vendor answered.
    expect(updated.vendorReply).toBeNull();
    expect(updated.vendorRepliedAt).toBeNull();
  });

  it('recomputes rollups when a rating is edited or deleted', async () => {
    const store = await makeStore('recompute');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('recompute');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    const review = await reviews.createReview(buyer, listing.id, { rating: 5, comment: 'Initially very happy indeed.' });

    await reviews.updateReview(buyer, review.id, { rating: 1 });
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.avgRating).toBe(1);

    await reviews.deleteReview(buyer, review.id);
    const s = await prisma.store.findUnique({ where: { id: store.id } });
    expect(s).toMatchObject({ avgRating: 0, reviewCount: 0 });
  });

  it('removes a review from public view and from the rollups', async () => {
    const store = await makeStore('moderate');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('moderate');
    await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    const review = await reviews.createReview(buyer, listing.id, { rating: 1, comment: 'Abusive nonsense goes here.' });

    await reviews.setReviewStatus(review.id, 'REMOVED');

    const listed = await reviews.listProductReviews(listing.id, { page: 1, limit: 20 });
    expect(listed.total).toBe(0);
    expect((await prisma.store.findUnique({ where: { id: store.id } }))?.reviewCount).toBe(0);

    // Flagged reviews stay visible while an admin looks at them.
    await reviews.setReviewStatus(review.id, 'FLAGGED');
    const afterFlag = await reviews.listProductReviews(listing.id, { page: 1, limit: 20 });
    expect(afterFlag.total).toBe(1);
  });

  it('orders verified reviews first and can filter to them', async () => {
    const store = await makeStore('ordering');
    const listing = await makeListing(store.id);

    const unverified = await makeBuyer('unverified');
    await chat.startConversation(unverified, { listingId: listing.id, message: 'Ignored question' });
    await reviews.createReview(unverified, listing.id, { rating: 4, comment: 'Unverified opinion here.' });

    const verified = await makeBuyer('verified');
    const convo = await chat.startConversation(verified, { listingId: listing.id, message: 'Answered question' });
    await chat.sendMessage(store.ownerId, convo!.id, 'Here is your answer');
    await reviews.createReview(verified, listing.id, { rating: 4, comment: 'Verified opinion here.' });

    const all = await reviews.listProductReviews(listing.id, { page: 1, limit: 20 });
    expect(all.reviews[0].isVerified).toBe(true);
    expect(all.summary.verifiedCount).toBe(1);

    const onlyVerified = await reviews.listProductReviews(listing.id, { page: 1, limit: 20, verifiedOnly: true });
    expect(onlyVerified.total).toBe(1);
  });

  it('shows response metrics alongside the store rating', async () => {
    const store = await makeStore('storepage');
    const listing = await makeListing(store.id);
    const buyer = await makeBuyer('storepage');
    const convo = await chat.startConversation(buyer, { listingId: listing.id, message: 'Question here' });
    await chat.sendMessage(store.ownerId, convo!.id, 'Fast answer');
    await reviews.createReview(buyer, listing.id, body);

    const page = await reviews.listStoreReviews(store.id, { page: 1, limit: 20 });

    expect(page.summary.averageRating).toBe(5);
    // With nothing transacted on-platform, attentiveness matters as much as score.
    expect(page.summary.responseRate).toBe(1);
    expect(page.summary.avgResponseMins).toBe(0);
    expect(page.reviews[0].product?.id).toBe(listing.id);
  });

  it('reports the star distribution', async () => {
    const store = await makeStore('dist');
    const listing = await makeListing(store.id);

    for (const [i, rating] of [5, 5, 3].entries()) {
      const buyer = await makeBuyer(`dist${i}`);
      const l = i === 0 ? listing : await makeListing(store.id);
      await chat.startConversation(buyer, { listingId: l.id, message: 'A question about this' });
      await reviews.createReview(buyer, l.id, { rating, comment: `Rating of ${rating} stars given.` });
    }

    const page = await reviews.listStoreReviews(store.id, { page: 1, limit: 20 });
    expect(page.summary.distribution).toMatchObject({ 5: 2, 3: 1, 1: 0 });
  });
});
