/**
 * Seed script — Populates Categories & Products for development.
 * Run: npx ts-node prisma/seed.ts
 *
 * Uses image paths from the frontend /public/images/ directory.
 * All prices in NGN (₦).
 */

import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── Clean existing data ─────────────────────────────────────
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  // Delete child categories first, then parent categories (self-referential relation)
  await prisma.category.deleteMany({ where: { parentId: { not: null } } });
  await prisma.category.deleteMany();
  console.log('  ✓ Cleared existing products, variants & categories');

  // ══════════════════════════════════════════════════════════════
  // CATEGORIES  (flat — no subcategories)
  // ══════════════════════════════════════════════════════════════
  const electronics = await prisma.category.create({
    data: {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Latest electronics and gadgets',
      image: '/images/categories/img1.png',
      icon: 'laptop',
      sortOrder: 1,
    },
  });

  const fashion = await prisma.category.create({
    data: {
      name: 'Fashion',
      slug: 'fashion',
      description: 'Trendy fashion and apparel',
      image: '/images/categories/img2.png',
      icon: 'shirt',
      sortOrder: 2,
    },
  });

  const homeGarden = await prisma.category.create({
    data: {
      name: 'Home & Garden',
      slug: 'home-garden',
      description: 'Everything for your home',
      image: '/images/categories/img3.png',
      icon: 'home',
      sortOrder: 3,
    },
  });

  const sports = await prisma.category.create({
    data: {
      name: 'Sports & Outdoors',
      slug: 'sports-outdoors',
      description: 'Gear for active lifestyle',
      image: '/images/categories/img1.jpg',
      icon: 'activity',
      sortOrder: 4,
    },
  });

  console.log('  ✓ Created 4 categories');

  // ══════════════════════════════════════════════════════════════
  // PRODUCTS  (prices in NGN ₦)
  // ══════════════════════════════════════════════════════════════

  // Helper to create product + variants in one call
  const products = await Promise.all([
    // ── 1. Wireless Bluetooth Headphones Pro ────────────────────
    prisma.product.create({
      data: {
        name: 'Wireless Bluetooth Headphones Pro',
        slug: 'wireless-bluetooth-headphones-pro',
        description:
          'Experience premium sound quality with our Wireless Bluetooth Headphones Pro. Featuring active noise cancellation, 40-hour battery life, and ultra-comfortable memory foam ear cushions. Perfect for music lovers, gamers, and professionals who demand the best audio experience.',
        shortDesc: 'Premium wireless headphones with active noise cancellation and 40-hour battery life.',
        stockKeepingUnit: 'WBH-PRO-001',
        basePrice: 149990,
        salePrice: 119990,
        categoryId: electronics.id,
        brand: 'SoundMax',
        tags: ['wireless', 'bluetooth', 'headphones', 'noise-cancelling'],
        images: [
          { url: '/images/products/img1.jpg', alt: 'Headphones Pro - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img2.png', alt: 'Headphones Pro - Side', isPrimary: false, sortOrder: 2 },
          { url: '/images/products/img3.jpg', alt: 'Headphones Pro - Folded', isPrimary: false, sortOrder: 3 },
        ],
        avgRating: 4.5,
        reviewCount: 128,
        stock: 95,
        isFeatured: true,
        variants: {
          create: [
            { name: 'Black', stockKeepingUnit: 'WBH-PRO-001-BLK', price: 149990, stock: 45, attributes: { color: 'Black' } },
            { name: 'Silver', stockKeepingUnit: 'WBH-PRO-001-SLV', price: 149990, stock: 30, attributes: { color: 'Silver' } },
            { name: 'Rose Gold', stockKeepingUnit: 'WBH-PRO-001-RG', price: 159990, stock: 20, attributes: { color: 'Rose Gold' } },
          ],
        },
      },
    }),

    // ── 2. Smart Watch Ultra ────────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Smart Watch Ultra',
        slug: 'smart-watch-ultra',
        description:
          'The ultimate smartwatch for fitness enthusiasts and tech lovers. Features include GPS tracking, heart rate monitoring, blood oxygen sensor, sleep tracking, and a stunning AMOLED display. Water-resistant up to 100 metres.',
        shortDesc: 'Ultimate fitness smartwatch with GPS and AMOLED display.',
        stockKeepingUnit: 'SWU-001',
        basePrice: 299990,
        salePrice: 249990,
        categoryId: electronics.id,
        brand: 'TechFit',
        tags: ['smartwatch', 'fitness', 'gps', 'health'],
        images: [
          { url: '/images/products/img4.jpg', alt: 'Smart Watch Ultra - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img5.jpg', alt: 'Smart Watch Ultra - Band', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.7,
        reviewCount: 89,
        stock: 60,
        isFeatured: true,
        variants: {
          create: [
            { name: '44mm Black', stockKeepingUnit: 'SWU-001-44-BLK', price: 299990, stock: 30, attributes: { size: '44mm', color: 'Black' } },
            { name: '44mm Blue', stockKeepingUnit: 'SWU-001-44-BLU', price: 299990, stock: 30, attributes: { size: '44mm', color: 'Blue' } },
          ],
        },
      },
    }),

    // ── 3. Premium Laptop Stand ─────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Premium Laptop Stand',
        slug: 'premium-laptop-stand',
        description:
          'Ergonomic aluminium laptop stand with adjustable height and angle. Improves posture and reduces neck strain. Compatible with all laptops up to 17 inches. Foldable design for portability.',
        shortDesc: 'Ergonomic aluminium laptop stand with adjustable height.',
        stockKeepingUnit: 'PLS-001',
        basePrice: 45990,
        categoryId: electronics.id,
        brand: 'ErgoTech',
        tags: ['laptop', 'stand', 'ergonomic', 'aluminium'],
        images: [
          { url: '/images/products/img6.jpg', alt: 'Laptop Stand - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img7.png', alt: 'Laptop Stand - Angle', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.3,
        reviewCount: 56,
        stock: 200,
        isFeatured: false,
      },
    }),

    // ── 4. Men's Classic Polo ───────────────────────────────────
    prisma.product.create({
      data: {
        name: "Men's Classic Polo Shirt",
        slug: 'mens-classic-polo-shirt',
        description:
          'Timeless classic polo shirt crafted from 100% premium cotton piqué. Features a ribbed collar, two-button placket, and embroidered logo. Available in multiple colours and sizes.',
        shortDesc: '100% premium cotton classic polo in multiple colours.',
        stockKeepingUnit: 'MCP-001',
        basePrice: 24990,
        salePrice: 19990,
        categoryId: fashion.id,
        brand: 'UrbanWear',
        tags: ['polo', 'mens', 'cotton', 'classic'],
        images: [
          { url: '/images/products/img8.jpg', alt: 'Classic Polo - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img9.png', alt: 'Classic Polo - Back', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.2,
        reviewCount: 73,
        stock: 180,
        isFeatured: true,
        variants: {
          create: [
            { name: 'S White', stockKeepingUnit: 'MCP-001-S-WHT', price: 24990, stock: 30, attributes: { size: 'S', color: 'White' } },
            { name: 'M White', stockKeepingUnit: 'MCP-001-M-WHT', price: 24990, stock: 40, attributes: { size: 'M', color: 'White' } },
            { name: 'L Navy', stockKeepingUnit: 'MCP-001-L-NVY', price: 24990, stock: 35, attributes: { size: 'L', color: 'Navy' } },
            { name: 'XL Navy', stockKeepingUnit: 'MCP-001-XL-NVY', price: 24990, stock: 25, attributes: { size: 'XL', color: 'Navy' } },
          ],
        },
      },
    }),

    // ── 5. Women's Running Shoes ────────────────────────────────
    prisma.product.create({
      data: {
        name: "Women's Running Shoes",
        slug: 'womens-running-shoes',
        description:
          'Lightweight running shoes designed for comfort and speed. Features responsive cushioning, breathable mesh upper, and durable rubber outsole. Ideal for daily training and races.',
        shortDesc: "Lightweight women's running shoes with responsive cushioning.",
        stockKeepingUnit: 'WRS-001',
        basePrice: 89990,
        salePrice: 74990,
        categoryId: fashion.id,
        brand: 'SwiftStep',
        tags: ['shoes', 'running', 'womens', 'athletic'],
        images: [
          { url: '/images/products/img10.png', alt: 'Running Shoes - Side', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img11.png', alt: 'Running Shoes - Top', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.6,
        reviewCount: 204,
        stock: 120,
        isFeatured: true,
        variants: {
          create: [
            { name: 'Size 37 Pink', stockKeepingUnit: 'WRS-001-37-PNK', price: 89990, stock: 20, attributes: { size: '37', color: 'Pink' } },
            { name: 'Size 38 Pink', stockKeepingUnit: 'WRS-001-38-PNK', price: 89990, stock: 25, attributes: { size: '38', color: 'Pink' } },
            { name: 'Size 39 Black', stockKeepingUnit: 'WRS-001-39-BLK', price: 89990, stock: 30, attributes: { size: '39', color: 'Black' } },
            { name: 'Size 40 Black', stockKeepingUnit: 'WRS-001-40-BLK', price: 89990, stock: 25, attributes: { size: '40', color: 'Black' } },
          ],
        },
      },
    }),

    // ── 6. Modern Coffee Table ──────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Modern Coffee Table',
        slug: 'modern-coffee-table',
        description:
          'Sleek modern coffee table with tempered glass top and solid oak legs. Minimalist Scandinavian design that fits any living room. Dimensions: 120cm × 60cm × 45cm.',
        shortDesc: 'Scandinavian-style glass & oak coffee table.',
        stockKeepingUnit: 'MCT-001',
        basePrice: 189990,
        categoryId: homeGarden.id,
        brand: 'NordicHome',
        tags: ['furniture', 'table', 'modern', 'scandinavian'],
        images: [
          { url: '/images/products/img12.png', alt: 'Coffee Table - Top', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img13.png', alt: 'Coffee Table - Side', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.4,
        reviewCount: 31,
        stock: 15,
        isFeatured: true,
      },
    }),

    // ── 7. Professional Blender ─────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Professional Blender 1200W',
        slug: 'professional-blender-1200w',
        description:
          'High-performance 1200W blender with 6 stainless steel blades. 2-litre BPA-free jug with 10 speed settings and pulse function. Perfect for smoothies, soups, and food processing.',
        shortDesc: '1200W professional blender with 10 speed settings.',
        stockKeepingUnit: 'PBL-001',
        basePrice: 69990,
        salePrice: 59990,
        categoryId: homeGarden.id,
        brand: 'ChefPro',
        tags: ['blender', 'kitchen', 'appliance', 'professional'],
        images: [
          { url: '/images/products/img14.png', alt: 'Blender - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img15.jpg', alt: 'Blender - In Use', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.8,
        reviewCount: 167,
        stock: 75,
        isFeatured: false,
      },
    }),

    // ── 8. Yoga Mat Premium ─────────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Yoga Mat Premium 6mm',
        slug: 'yoga-mat-premium-6mm',
        description:
          'Eco-friendly TPE yoga mat with superior grip and cushioning. 6mm thickness provides joint comfort. Includes carrying strap. Non-toxic and free from PVC, latex, and harmful chemicals.',
        shortDesc: 'Eco-friendly 6mm yoga mat with carrying strap.',
        stockKeepingUnit: 'YMP-001',
        basePrice: 19990,
        categoryId: sports.id,
        brand: 'ZenFit',
        tags: ['yoga', 'mat', 'fitness', 'eco-friendly'],
        images: [
          { url: '/images/products/img16.jpg', alt: 'Yoga Mat - Rolled', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img17.jpg', alt: 'Yoga Mat - Flat', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.1,
        reviewCount: 92,
        stock: 250,
        isFeatured: false,
      },
    }),

    // ── 9. Camping Tent 4-Person ────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Camping Tent 4-Person',
        slug: 'camping-tent-4-person',
        description:
          'Spacious 4-person dome tent with waterproof fly sheet and mesh windows. Easy 5-minute setup with colour-coded poles. Includes storage pockets, electric cord access, and carrying bag.',
        shortDesc: 'Waterproof 4-person dome tent with quick setup.',
        stockKeepingUnit: 'CT4-001',
        basePrice: 159990,
        salePrice: 129990,
        categoryId: sports.id,
        brand: 'WildTrail',
        tags: ['camping', 'tent', 'outdoor', 'waterproof'],
        images: [
          { url: '/images/products/img18.jpg', alt: 'Tent - Exterior', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img19.jpg', alt: 'Tent - Interior', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.4,
        reviewCount: 48,
        stock: 30,
        isFeatured: true,
      },
    }),

    // ── 10. Wireless Charging Pad ───────────────────────────────
    prisma.product.create({
      data: {
        name: 'Wireless Charging Pad 15W',
        slug: 'wireless-charging-pad-15w',
        description:
          'Fast 15W wireless charging pad compatible with all Qi-enabled devices. LED indicator, anti-slip base, and over-charge protection. Ultra-slim 8mm profile.',
        shortDesc: '15W fast wireless charging pad with safety protection.',
        stockKeepingUnit: 'WCP-001',
        basePrice: 14990,
        categoryId: electronics.id,
        brand: 'ChargeTech',
        tags: ['charging', 'wireless', 'accessories', 'qi'],
        images: [
          { url: '/images/products/img20.jpg', alt: 'Charging Pad - Top', isPrimary: true, sortOrder: 1 },
        ],
        avgRating: 4.0,
        reviewCount: 215,
        stock: 300,
        isFeatured: false,
      },
    }),

    // ── 11. Designer Tote Bag ───────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Designer Leather Tote Bag',
        slug: 'designer-leather-tote-bag',
        description:
          'Handcrafted genuine leather tote bag with spacious interior, laptop compartment, and premium gold-tone hardware. Perfect for work and travel.',
        shortDesc: 'Genuine leather tote with laptop compartment.',
        stockKeepingUnit: 'DLT-001',
        basePrice: 199990,
        salePrice: 169990,
        categoryId: fashion.id,
        brand: 'LuxCraft',
        tags: ['bag', 'leather', 'tote', 'designer'],
        images: [
          { url: '/images/products/img21.png', alt: 'Tote Bag - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img22.jpg', alt: 'Tote Bag - Interior', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.6,
        reviewCount: 61,
        stock: 40,
        isFeatured: true,
        variants: {
          create: [
            { name: 'Tan', stockKeepingUnit: 'DLT-001-TAN', price: 199990, stock: 15, attributes: { color: 'Tan' } },
            { name: 'Black', stockKeepingUnit: 'DLT-001-BLK', price: 199990, stock: 15, attributes: { color: 'Black' } },
            { name: 'Burgundy', stockKeepingUnit: 'DLT-001-BRG', price: 209990, stock: 10, attributes: { color: 'Burgundy' } },
          ],
        },
      },
    }),

    // ── 12. Smart Home Speaker ──────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Smart Home Speaker',
        slug: 'smart-home-speaker',
        description:
          'Voice-controlled smart speaker with 360° sound, built-in virtual assistant, multi-room support, and smart home device control. Premium fabric design.',
        shortDesc: 'Voice-controlled speaker with 360° sound.',
        stockKeepingUnit: 'SHS-001',
        basePrice: 79990,
        categoryId: electronics.id,
        brand: 'SoundMax',
        tags: ['speaker', 'smart-home', 'voice-control', 'wireless'],
        images: [
          { url: '/images/products/img23.jpg', alt: 'Smart Speaker - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img24.jpg', alt: 'Smart Speaker - Side', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.3,
        reviewCount: 143,
        stock: 85,
        isFeatured: false,
      },
    }),

    // ── 13. Adjustable Dumbbells Set ────────────────────────────
    prisma.product.create({
      data: {
        name: 'Adjustable Dumbbells Set 24kg',
        slug: 'adjustable-dumbbells-set-24kg',
        description:
          'Space-saving adjustable dumbbells that replace 15 sets of weights. Quick-change mechanism from 2.5kg to 24kg per dumbbell. Includes storage tray.',
        shortDesc: 'Adjustable 2.5–24kg dumbbells replacing 15 sets.',
        stockKeepingUnit: 'ADS-001',
        basePrice: 249990,
        salePrice: 219990,
        categoryId: sports.id,
        brand: 'IronGrip',
        tags: ['dumbbells', 'weights', 'fitness', 'home-gym'],
        images: [
          { url: '/images/products/img25.jpg', alt: 'Dumbbells - Front', isPrimary: true, sortOrder: 1 },
          { url: '/images/products/img26.jpg', alt: 'Dumbbells - Racked', isPrimary: false, sortOrder: 2 },
        ],
        avgRating: 4.7,
        reviewCount: 38,
        stock: 20,
        isFeatured: true,
      },
    }),

    // ── 14. Ceramic Dinner Set ──────────────────────────────────
    prisma.product.create({
      data: {
        name: 'Ceramic Dinner Set 16-Piece',
        slug: 'ceramic-dinner-set-16-piece',
        description:
          'Elegant 16-piece ceramic dinner set. Includes 4 dinner plates, 4 side plates, 4 bowls, and 4 mugs. Microwave and dishwasher safe. Matte glaze finish.',
        shortDesc: '16-piece matte ceramic dinner set, microwave safe.',
        stockKeepingUnit: 'CDS-001',
        basePrice: 54990,
        categoryId: homeGarden.id,
        brand: 'CasaVita',
        tags: ['dinnerware', 'ceramic', 'kitchen', 'dining'],
        images: [
          { url: '/images/products/img12.png', alt: 'Dinner Set - Full', isPrimary: true, sortOrder: 1 },
        ],
        avgRating: 4.5,
        reviewCount: 76,
        stock: 50,
        isFeatured: false,
      },
    }),

    // ── 15. USB-C Hub 7-in-1 ────────────────────────────────────
    prisma.product.create({
      data: {
        name: 'USB-C Hub 7-in-1',
        slug: 'usb-c-hub-7-in-1',
        description:
          '7-in-1 USB-C hub: HDMI 4K@60Hz, USB 3.0 ×2, USB-C PD 100W, SD/microSD card readers, and Gigabit Ethernet. Aluminium build, compact for travel.',
        shortDesc: '7-in-1 USB-C hub with 4K HDMI and 100W PD.',
        stockKeepingUnit: 'UCH-001',
        basePrice: 34990,
        salePrice: 29990,
        categoryId: electronics.id,
        brand: 'ConnectPro',
        tags: ['usb-c', 'hub', 'adapter', 'laptop-accessories'],
        images: [
          { url: '/images/products/img7.png', alt: 'USB-C Hub - Top', isPrimary: true, sortOrder: 1 },
        ],
        avgRating: 4.4,
        reviewCount: 182,
        stock: 150,
        isFeatured: false,
      },
    }),
  ]);

  console.log(`  ✓ Created ${products.length} products with variants\n`);

  // ── Summary ───────────────────────────────────────────────────
  const categoryCount = await prisma.category.count();
  const productCount = await prisma.product.count();
  const variantCount = await prisma.productVariant.count();

  console.log('📊 Seed Summary:');
  console.log(`   Categories : ${categoryCount}`);
  console.log(`   Products   : ${productCount}`);
  console.log(`   Variants   : ${variantCount}`);
  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
