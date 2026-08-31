/**
 * Runtime feature flags.
 *
 * These are deliberately few. A flag here is a temporary switch with an owner
 * and an end date, not a permanent configuration knob — when the thing it
 * guards is settled, the flag and its branches come out.
 */

/**
 * Whether a mall must pay to be seen.
 *
 * OFF while the mall feature is being tested (2026-08-31): a mall is publicly
 * visible from the moment it is created, and its substores go live with it, so
 * the whole flow can be exercised without moving $300. The subscription is
 * still created and still chargeable — only the visibility gate is lifted, so
 * turning this back on restores the paywall with no data migration.
 *
 * Turn it on by setting MALL_PAYWALL=on (no deploy needed), or by flipping the
 * default below once testing is signed off.
 */
export const MALL_PAYWALL_ENABLED = process.env.MALL_PAYWALL === 'on';
