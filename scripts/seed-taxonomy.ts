/**
 * Seeds the fixed, admin-managed category taxonomy: two levels deep, with the
 * filterable attributes that make browse and search work.
 *
 *   npm run seed:taxonomy                          # dry run
 *   npm run seed:taxonomy -- --apply
 *   npm run seed:taxonomy -- --apply --deactivate-unlisted
 *
 * Shape of the data:
 *   - Top level = browse headings. Listings can NOT be filed against them.
 *   - Leaves    = where listings live, and where attributes hang.
 *   - Attributes are the *structured* layer: controlled vocabulary, validated
 *     on publish, and the only thing buyers can filter on. Anything a vendor
 *     wants to add beyond these goes in per-product custom fields.
 *
 * `Condition` is deliberately NOT an attribute anywhere — it is a first-class
 * column on Product (`condition`), so it filters uniformly across every
 * category instead of being redefined 70 times.
 *
 * appliesTo:
 *   PRODUCT — one value for the whole listing (Brand, Year, Bedrooms)
 *   VARIANT — varies per variant row (Size, Colour)
 *
 * Additive and idempotent: categories upsert by slug, attributes by
 * (category, name). Nothing is ever deleted — `--deactivate-unlisted` sets
 * `isActive: false` on categories outside this list, because products still
 * point at them and deleting would orphan live data.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const deactivateUnlisted = process.argv.includes('--deactivate-unlisted');

type Attr = {
  name: string;
  type?: 'SELECT' | 'TEXT' | 'NUMBER';
  options?: string[];
  isRequired?: boolean;
  appliesTo?: 'PRODUCT' | 'VARIANT';
  isFilterable?: boolean;
};

type Leaf = { name: string; slug: string; attributes?: Attr[] };
type Top = { name: string; slug: string; icon?: string; children: Leaf[] };

// ── Reusable attribute sets ──

const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const COLOURS = [
  'Black', 'White', 'Grey', 'Blue', 'Navy', 'Red', 'Green', 'Yellow',
  'Orange', 'Pink', 'Purple', 'Brown', 'Beige', 'Gold', 'Silver', 'Multicolour',
];

const clothing = (extra: Attr[] = []): Attr[] => [
  { name: 'Size', options: CLOTHING_SIZES, isRequired: true, appliesTo: 'VARIANT' },
  { name: 'Colour', options: COLOURS, isRequired: true, appliesTo: 'VARIANT' },
  { name: 'Material', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
  ...extra,
];

const shoes = (extra: Attr[] = []): Attr[] => [
  {
    name: 'Shoe Size',
    options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47'],
    isRequired: true,
    appliesTo: 'VARIANT',
  },
  { name: 'Colour', options: COLOURS, isRequired: true, appliesTo: 'VARIANT' },
  { name: 'Material', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
  ...extra,
];

const STORAGE = ['8GB', '16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
const RAM = ['1GB', '2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB', '64GB'];

const PHONE_BRANDS = [
  'Apple', 'Samsung', 'Tecno', 'Infinix', 'itel', 'Xiaomi', 'Redmi', 'Oppo',
  'Vivo', 'Nokia', 'Huawei', 'Realme', 'Google', 'OnePlus', 'Other',
];

const LAPTOP_BRANDS = [
  'HP', 'Dell', 'Lenovo', 'Apple', 'Asus', 'Acer', 'MSI', 'Toshiba', 'Samsung', 'Other',
];

const CAR_MAKES = [
  'Toyota', 'Honda', 'Lexus', 'Mercedes-Benz', 'BMW', 'Ford', 'Hyundai', 'Kia',
  'Nissan', 'Volkswagen', 'Peugeot', 'Mazda', 'Mitsubishi', 'Land Rover',
  'Audi', 'Innoson', 'Other',
];

/** Nigerian land/property title documents — the first thing a buyer asks about. */
const TITLE_DOCS = [
  'Certificate of Occupancy',
  "Governor's Consent",
  'Deed of Assignment',
  'Registered Survey',
  'Excision',
  'Gazette',
  'Family Receipt',
  'Other',
];

const RENT_PERIODS = ['Per Year', 'Per Month', 'Per Week', 'Per Night'];
const FURNISHING = ['Unfurnished', 'Semi-furnished', 'Fully furnished'];

const SERVICE_ATTRS: Attr[] = [
  { name: 'Pricing Model', options: ['Per Hour', 'Per Day', 'Per Job', 'Per Month', 'On Request'], isRequired: true, appliesTo: 'PRODUCT' },
  { name: 'Service Type', options: ['On-site', 'Remote', 'Both'], isRequired: true, appliesTo: 'PRODUCT' },
  { name: 'Experience', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
];

// ── The taxonomy ──

const TAXONOMY: Top[] = [
  {
    name: 'Phones & Tablets',
    slug: 'phones-tablets',
    icon: 'smartphone',
    children: [
      {
        name: 'Mobile Phones',
        slug: 'mobile-phones',
        attributes: [
          { name: 'Brand', options: PHONE_BRANDS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Model', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Storage', options: STORAGE, isRequired: true, appliesTo: 'VARIANT' },
          { name: 'RAM', options: RAM, appliesTo: 'VARIANT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
          { name: 'Battery Capacity', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Tablets',
        slug: 'tablets',
        attributes: [
          { name: 'Brand', options: PHONE_BRANDS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Storage', options: STORAGE, isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Screen Size', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Phone Accessories',
        slug: 'phone-accessories',
        attributes: [
          { name: 'Accessory Type', options: ['Case', 'Screen Protector', 'Charger', 'Cable', 'Power Bank', 'Earphones', 'Holder', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Compatible With', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Smartwatches',
        slug: 'smartwatches',
        attributes: [
          { name: 'Brand', options: [...PHONE_BRANDS, 'Amazfit', 'Fitbit', 'Garmin'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Phone Parts & Repair',
        slug: 'phone-parts',
        attributes: [
          { name: 'Part Type', options: ['Screen', 'Battery', 'Charging Port', 'Camera', 'Back Cover', 'Motherboard', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Compatible With', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
    ],
  },
  {
    name: 'Electronics',
    slug: 'electronics',
    icon: 'tv',
    children: [
      {
        name: 'Laptops & Computers',
        slug: 'laptops-computers',
        attributes: [
          { name: 'Brand', options: LAPTOP_BRANDS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Processor', options: ['Intel Celeron', 'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9', 'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'Apple M-series', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'RAM', options: RAM, isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Storage', options: STORAGE, isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Screen Size', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'TVs & Projectors',
        slug: 'tvs-projectors',
        attributes: [
          { name: 'Brand', options: ['Samsung', 'LG', 'Hisense', 'Sony', 'TCL', 'Nexus', 'Skyworth', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Screen Size', options: ['24"', '32"', '40"', '43"', '50"', '55"', '65"', '75"', '85"'], isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Resolution', options: ['HD', 'Full HD', '4K UHD', '8K'], appliesTo: 'PRODUCT' },
          { name: 'Smart TV', options: ['Yes', 'No'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Audio & Speakers',
        slug: 'audio-speakers',
        attributes: [
          { name: 'Audio Type', options: ['Bluetooth Speaker', 'Home Theatre', 'Soundbar', 'Headphones', 'Earbuds', 'Microphone', 'Amplifier', 'DJ Equipment', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Brand', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Cameras & Photography',
        slug: 'cameras-photography',
        attributes: [
          { name: 'Camera Type', options: ['DSLR', 'Mirrorless', 'Point & Shoot', 'Action Camera', 'CCTV', 'Drone', 'Lens', 'Accessory'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Brand', options: ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'GoPro', 'DJI', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Gaming',
        slug: 'gaming',
        attributes: [
          { name: 'Platform', options: ['PlayStation 5', 'PlayStation 4', 'Xbox Series X/S', 'Xbox One', 'Nintendo Switch', 'PC', 'Retro', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Item Type', options: ['Console', 'Game', 'Controller', 'Accessory'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Computer Accessories',
        slug: 'computer-accessories',
        attributes: [
          { name: 'Accessory Type', options: ['Keyboard', 'Mouse', 'Monitor', 'Printer', 'Scanner', 'Router', 'Hard Drive', 'Flash Drive', 'Webcam', 'Cable', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Brand', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Generators & Power',
        slug: 'generators-power',
        attributes: [
          { name: 'Power Type', options: ['Petrol Generator', 'Diesel Generator', 'Inverter', 'Solar Panel', 'Battery', 'Stabiliser', 'UPS', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Capacity', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Brand', options: ['Elepaq', 'Tiger', 'Sumec Firman', 'Honda', 'Lutian', 'Mikano', 'Perkins', 'Other'], appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    icon: 'shirt',
    children: [
      { name: "Women's Clothing", slug: 'womens-clothing', attributes: clothing() },
      { name: "Men's Clothing", slug: 'mens-clothing', attributes: clothing() },
      {
        name: 'Traditional & Ankara',
        slug: 'traditional-ankara',
        attributes: clothing([
          { name: 'Style', options: ['Ankara', 'Aso Oke', 'Lace', 'Adire', 'Kaftan', 'Agbada', 'Senator', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Made To Order', options: ['Yes', 'No'], appliesTo: 'PRODUCT' },
        ]),
      },
      { name: "Women's Shoes", slug: 'womens-shoes', attributes: shoes() },
      { name: "Men's Shoes", slug: 'mens-shoes', attributes: shoes() },
      {
        name: 'Bags & Luggage',
        slug: 'bags-luggage',
        attributes: [
          { name: 'Bag Type', options: ['Handbag', 'Backpack', 'Laptop Bag', 'Travel Suitcase', 'Wallet', 'Clutch', 'Waist Bag', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Material', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Watches & Jewellery',
        slug: 'watches-jewellery',
        attributes: [
          { name: 'Item Type', options: ['Wristwatch', 'Necklace', 'Bracelet', 'Earrings', 'Ring', 'Anklet', 'Set', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Material', options: ['Gold', 'Gold-plated', 'Silver', 'Stainless Steel', 'Leather', 'Beads', 'Other'], appliesTo: 'PRODUCT' },
          { name: 'Gender', options: ['Men', 'Women', 'Unisex'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Underwear & Sleepwear',
        slug: 'underwear-sleepwear',
        attributes: clothing([{ name: 'Gender', options: ['Men', 'Women', 'Unisex'], isRequired: true, appliesTo: 'PRODUCT' }]),
      },
    ],
  },
  {
    name: 'Beauty & Personal Care',
    slug: 'beauty-personal-care',
    icon: 'sparkles',
    children: [
      {
        name: 'Wigs & Hair Extensions',
        slug: 'wigs-hair-extensions',
        attributes: [
          { name: 'Hair Type', options: ['Human Hair', 'Synthetic', 'Blend'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Length', options: ['8"', '10"', '12"', '14"', '16"', '18"', '20"', '22"', '24"', '26"', '30"'], isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Texture', options: ['Straight', 'Body Wave', 'Deep Wave', 'Curly', 'Kinky', 'Bob', 'Other'], appliesTo: 'PRODUCT' },
          { name: 'Cap Type', options: ['Frontal', 'Closure', 'Full Lace', 'HD Lace', 'U-Part', 'None'], appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Skincare',
        slug: 'skincare',
        attributes: [
          { name: 'Product Type', options: ['Cleanser', 'Moisturiser', 'Serum', 'Sunscreen', 'Soap', 'Body Lotion', 'Toner', 'Mask', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Skin Type', options: ['All', 'Oily', 'Dry', 'Combination', 'Sensitive', 'Acne-prone'], appliesTo: 'PRODUCT' },
          { name: 'Size', type: 'TEXT', appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
      {
        name: 'Makeup',
        slug: 'makeup',
        attributes: [
          { name: 'Product Type', options: ['Foundation', 'Concealer', 'Powder', 'Lipstick', 'Lip Gloss', 'Eyeshadow', 'Mascara', 'Eyeliner', 'Brushes', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Shade', type: 'TEXT', appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
      {
        name: 'Fragrances',
        slug: 'fragrances',
        attributes: [
          { name: 'Fragrance Type', options: ['Perfume', 'Eau de Parfum', 'Eau de Toilette', 'Body Spray', 'Oil Perfume', 'Diffuser'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Gender', options: ['Men', 'Women', 'Unisex'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Volume', type: 'TEXT', appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
      {
        name: 'Hair Care',
        slug: 'hair-care',
        attributes: [
          { name: 'Product Type', options: ['Shampoo', 'Conditioner', 'Hair Oil', 'Relaxer', 'Hair Food', 'Edge Control', 'Braiding Hair', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Grooming Tools',
        slug: 'grooming-tools',
        attributes: [
          { name: 'Tool Type', options: ['Clipper', 'Trimmer', 'Hair Dryer', 'Straightener', 'Curler', 'Steamer', 'Manicure Set', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Home, Furniture & Appliances',
    slug: 'home-garden',
    icon: 'sofa',
    children: [
      {
        name: 'Furniture',
        slug: 'furniture',
        attributes: [
          { name: 'Furniture Type', options: ['Sofa', 'Bed Frame', 'Mattress', 'Wardrobe', 'Dining Set', 'Centre Table', 'Office Desk', 'Chair', 'Shelf', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Material', options: ['Wood', 'Leather', 'Fabric', 'Metal', 'Glass', 'Plastic', 'Other'], appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
          { name: 'Dimensions', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Kitchen Appliances',
        slug: 'kitchen-appliances',
        attributes: [
          { name: 'Appliance Type', options: ['Gas Cooker', 'Microwave', 'Blender', 'Air Fryer', 'Toaster', 'Kettle', 'Yam Pounder', 'Deep Fryer', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Brand', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Home Appliances',
        slug: 'home-appliances',
        attributes: [
          { name: 'Appliance Type', options: ['Refrigerator', 'Freezer', 'Washing Machine', 'Air Conditioner', 'Fan', 'Water Dispenser', 'Water Heater', 'Vacuum Cleaner', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Capacity', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Brand', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Home Decor',
        slug: 'home-decor',
        attributes: [
          { name: 'Decor Type', options: ['Wall Art', 'Curtains', 'Rug', 'Mirror', 'Lighting', 'Clock', 'Vase', 'Wallpaper', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Kitchenware & Dining',
        slug: 'kitchenware-dining',
        attributes: [
          { name: 'Item Type', options: ['Cookware Set', 'Pot', 'Plate Set', 'Cutlery', 'Glassware', 'Food Storage', 'Cooler', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Material', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Bedding & Linen',
        slug: 'bedding-linen',
        attributes: [
          { name: 'Item Type', options: ['Bedsheet Set', 'Duvet', 'Pillow', 'Blanket', 'Towel', 'Mattress Protector', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Bed Size', options: ['Single', 'Double', 'Queen', 'King', 'Super King'], appliesTo: 'VARIANT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: 'Garden & Outdoor',
        slug: 'garden-outdoor',
        attributes: [
          { name: 'Item Type', options: ['Plant', 'Planter', 'Garden Tool', 'Outdoor Furniture', 'BBQ & Grill', 'Water Tank', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Vehicles',
    slug: 'vehicles',
    icon: 'car',
    children: [
      {
        name: 'Cars',
        slug: 'cars',
        attributes: [
          { name: 'Make', options: CAR_MAKES, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Model', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Year', type: 'NUMBER', isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Transmission', options: ['Automatic', 'Manual'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Fuel Type', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'CNG'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Body Type', options: ['Saloon', 'SUV', 'Hatchback', 'Bus', 'Pickup', 'Coupe', 'Convertible', 'Wagon'], appliesTo: 'PRODUCT' },
          { name: 'Mileage', type: 'NUMBER', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Registration', options: ['Registered', 'Unregistered (Custom Duty Paid)', 'Unregistered'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Motorcycles & Tricycles',
        slug: 'motorcycles-tricycles',
        attributes: [
          { name: 'Vehicle Type', options: ['Motorcycle', 'Tricycle (Keke)', 'Scooter', 'Power Bike'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Make', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Year', type: 'NUMBER', appliesTo: 'PRODUCT' },
          { name: 'Engine Capacity', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Buses & Heavy Vehicles',
        slug: 'buses-heavy-vehicles',
        attributes: [
          { name: 'Vehicle Type', options: ['Bus', 'Truck', 'Trailer', 'Tipper', 'Tractor', 'Excavator', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Make', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Year', type: 'NUMBER', appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Vehicle Parts & Accessories',
        slug: 'vehicle-parts',
        attributes: [
          { name: 'Part Type', options: ['Engine Parts', 'Body Parts', 'Battery', 'Brakes', 'Suspension', 'Lighting', 'Audio', 'Interior', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Fits Make', options: CAR_MAKES, appliesTo: 'PRODUCT' },
          { name: 'Fits Model', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Tyres & Rims',
        slug: 'tyres-rims',
        attributes: [
          { name: 'Item Type', options: ['Tyre', 'Rim', 'Set'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Size', type: 'TEXT', isRequired: true, appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
    ],
  },
  {
    name: 'Property',
    slug: 'property',
    icon: 'building',
    children: [
      {
        name: 'Houses & Flats for Rent',
        slug: 'houses-for-rent',
        attributes: [
          { name: 'Property Type', options: ['Self-contain', 'Mini Flat', 'Flat/Apartment', 'Duplex', 'Bungalow', 'Terrace', 'Detached House', 'Room & Parlour'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Bedrooms', type: 'NUMBER', isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Bathrooms', type: 'NUMBER', appliesTo: 'PRODUCT' },
          { name: 'Toilets', type: 'NUMBER', appliesTo: 'PRODUCT' },
          { name: 'Furnishing', options: FURNISHING, appliesTo: 'PRODUCT' },
          { name: 'Rent Period', options: RENT_PERIODS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Serviced', options: ['Yes', 'No'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Houses & Flats for Sale',
        slug: 'houses-for-sale',
        attributes: [
          { name: 'Property Type', options: ['Flat/Apartment', 'Duplex', 'Bungalow', 'Terrace', 'Detached House', 'Semi-detached', 'Block of Flats'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Bedrooms', type: 'NUMBER', isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Bathrooms', type: 'NUMBER', appliesTo: 'PRODUCT' },
          { name: 'Title Document', options: TITLE_DOCS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Furnishing', options: FURNISHING, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Land & Plots',
        slug: 'land-plots',
        attributes: [
          { name: 'Land Size', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Title Document', options: TITLE_DOCS, isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Land Use', options: ['Residential', 'Commercial', 'Industrial', 'Agricultural', 'Mixed Use'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Fenced', options: ['Yes', 'No'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Shops & Commercial Property',
        slug: 'commercial-property',
        attributes: [
          { name: 'Property Type', options: ['Shop', 'Office Space', 'Warehouse', 'Plaza', 'Hotel', 'Filling Station', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Listing Type', options: ['For Rent', 'For Sale', 'For Lease'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Floor Area', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Short-let & Serviced Apartments',
        slug: 'short-let',
        attributes: [
          { name: 'Bedrooms', type: 'NUMBER', isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Rent Period', options: ['Per Night', 'Per Week', 'Per Month'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Furnishing', options: FURNISHING, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Baby & Kids',
    slug: 'baby-kids',
    icon: 'baby',
    children: [
      {
        name: 'Baby Gear',
        slug: 'baby-gear',
        attributes: [
          { name: 'Gear Type', options: ['Stroller', 'Car Seat', 'Baby Cot', 'Carrier', 'Walker', 'High Chair', 'Playpen', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: "Kids' Clothing",
        slug: 'kids-clothing',
        attributes: [
          { name: 'Age Range', options: ['0-3 months', '3-6 months', '6-12 months', '1-2 years', '2-4 years', '4-6 years', '6-8 years', '8-10 years', '10-12 years', '12+ years'], isRequired: true, appliesTo: 'VARIANT' },
          { name: 'Gender', options: ['Boys', 'Girls', 'Unisex'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Colour', options: COLOURS, appliesTo: 'VARIANT' },
        ],
      },
      {
        name: "Kids' Shoes",
        slug: 'kids-shoes',
        attributes: [
          { name: 'Shoe Size', type: 'TEXT', isRequired: true, appliesTo: 'VARIANT', isFilterable: false },
          { name: 'Gender', options: ['Boys', 'Girls', 'Unisex'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Toys & Games',
        slug: 'toys-games',
        attributes: [
          { name: 'Toy Type', options: ['Educational', 'Ride-on', 'Doll', 'Building Blocks', 'Board Game', 'Outdoor', 'Soft Toy', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Age Range', options: ['0-1 year', '1-3 years', '3-5 years', '5-8 years', '8-12 years', '12+ years'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Baby Feeding & Care',
        slug: 'baby-feeding-care',
        attributes: [
          { name: 'Item Type', options: ['Bottle', 'Breast Pump', 'Steriliser', 'Nappies', 'Wipes', 'Baby Food', 'Bath & Skincare', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Food & Agriculture',
    slug: 'food-agriculture',
    icon: 'wheat',
    children: [
      {
        name: 'Foodstuff & Grains',
        slug: 'foodstuff-grains',
        attributes: [
          { name: 'Food Type', options: ['Rice', 'Beans', 'Garri', 'Yam', 'Flour', 'Oil', 'Tomatoes & Pepper', 'Spices', 'Fish & Meat', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Pack Size', type: 'TEXT', isRequired: true, appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
      {
        name: 'Drinks & Beverages',
        slug: 'drinks-beverages',
        attributes: [
          { name: 'Drink Type', options: ['Soft Drink', 'Juice', 'Water', 'Energy Drink', 'Wine', 'Spirits', 'Beer', 'Tea & Coffee', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Volume', type: 'TEXT', appliesTo: 'VARIANT', isFilterable: false },
        ],
      },
      {
        name: 'Snacks & Confectionery',
        slug: 'snacks-confectionery',
        attributes: [
          { name: 'Snack Type', options: ['Chin Chin', 'Cakes & Pastries', 'Chocolate & Sweets', 'Biscuits', 'Plantain Chips', 'Nuts', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Made To Order', options: ['Yes', 'No'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Livestock & Poultry',
        slug: 'livestock-poultry',
        attributes: [
          { name: 'Animal Type', options: ['Chicken', 'Turkey', 'Goat', 'Ram', 'Cow', 'Pig', 'Fish (Catfish)', 'Snail', 'Day-old Chicks', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Age', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Weight', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Farm Inputs & Machinery',
        slug: 'farm-inputs-machinery',
        attributes: [
          { name: 'Input Type', options: ['Seeds', 'Fertiliser', 'Animal Feed', 'Pesticide', 'Irrigation', 'Machinery', 'Tools', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Health & Fitness',
    slug: 'health-fitness',
    icon: 'heart-pulse',
    children: [
      {
        name: 'Supplements & Vitamins',
        slug: 'supplements-vitamins',
        attributes: [
          { name: 'Supplement Type', options: ['Multivitamin', 'Protein', 'Weight Gain', 'Weight Loss', 'Immune Support', 'Fertility', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Form', options: ['Tablet', 'Capsule', 'Powder', 'Liquid', 'Gummy'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Herbal & Traditional',
        slug: 'herbal-traditional',
        attributes: [
          { name: 'Form', options: ['Tea', 'Oil', 'Powder', 'Liquid', 'Soap', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Medical Equipment',
        slug: 'medical-equipment',
        attributes: [
          { name: 'Equipment Type', options: ['Blood Pressure Monitor', 'Glucometer', 'Thermometer', 'Wheelchair', 'Nebuliser', 'Oxygen', 'First Aid', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Gym & Fitness Equipment',
        slug: 'gym-fitness-equipment',
        attributes: [
          { name: 'Equipment Type', options: ['Treadmill', 'Exercise Bike', 'Dumbbells', 'Weight Bench', 'Resistance Bands', 'Yoga Mat', 'Multi-gym', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Sportswear & Sports Gear',
        slug: 'sportswear-gear',
        attributes: clothing([
          { name: 'Sport', options: ['Football', 'Basketball', 'Running', 'Gym', 'Swimming', 'Tennis', 'Cycling', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ]),
      },
    ],
  },
  {
    name: 'Business & Industrial',
    slug: 'business-industrial',
    icon: 'factory',
    children: [
      {
        name: 'Building Materials',
        slug: 'building-materials',
        attributes: [
          { name: 'Material Type', options: ['Cement', 'Blocks', 'Iron Rods', 'Roofing Sheets', 'Tiles', 'Paint', 'Plumbing', 'Electrical', 'Doors & Windows', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Unit', options: ['Per Piece', 'Per Bag', 'Per Ton', 'Per Bundle', 'Per Square Metre', 'Per Litre'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Industrial Machinery',
        slug: 'industrial-machinery',
        attributes: [
          { name: 'Machinery Type', options: ['Milling', 'Packaging', 'Printing', 'Welding', 'Compressor', 'Water Treatment', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Power Requirement', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Restaurant & Catering Equipment',
        slug: 'catering-equipment',
        attributes: [
          { name: 'Equipment Type', options: ['Industrial Cooker', 'Deep Fryer', 'Display Fridge', 'Food Warmer', 'Shawarma Machine', 'Popcorn Machine', 'Oven', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Office Equipment & Supplies',
        slug: 'office-equipment',
        attributes: [
          { name: 'Item Type', options: ['Office Furniture', 'Printer & Copier', 'Shredder', 'Projector', 'Safe', 'Stationery', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Safety & Security Equipment',
        slug: 'safety-security',
        attributes: [
          { name: 'Item Type', options: ['CCTV', 'Alarm', 'Fire Extinguisher', 'Safety Boots', 'Helmet', 'Reflective Vest', 'Access Control', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
  {
    name: 'Services',
    slug: 'services',
    icon: 'wrench',
    children: [
      { name: 'Fashion & Tailoring Services', slug: 'tailoring-services', attributes: SERVICE_ATTRS },
      { name: 'Beauty & Grooming Services', slug: 'beauty-services', attributes: SERVICE_ATTRS },
      { name: 'Repairs & Technicians', slug: 'repairs-technicians', attributes: SERVICE_ATTRS },
      { name: 'Building & Construction', slug: 'building-services', attributes: SERVICE_ATTRS },
      { name: 'Events, Catering & Photography', slug: 'events-services', attributes: SERVICE_ATTRS },
      { name: 'Logistics & Delivery', slug: 'logistics-services', attributes: SERVICE_ATTRS },
      { name: 'Cleaning & Home Services', slug: 'cleaning-services', attributes: SERVICE_ATTRS },
      { name: 'Tutoring & Lessons', slug: 'tutoring-services', attributes: SERVICE_ATTRS },
      { name: 'Professional & Business Services', slug: 'professional-services', attributes: SERVICE_ATTRS },
      { name: 'Digital & Creative Services', slug: 'digital-services', attributes: SERVICE_ATTRS },
    ],
  },
  {
    name: 'Books, Media & Hobbies',
    slug: 'books-media-hobbies',
    icon: 'book',
    children: [
      {
        name: 'Books',
        slug: 'books',
        attributes: [
          { name: 'Book Type', options: ['Academic', 'Fiction', 'Religious', 'Business', 'Children', 'Self-help', 'Exam Prep', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Format', options: ['Paperback', 'Hardcover', 'E-book', 'Audiobook'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Stationery & School Supplies',
        slug: 'stationery-school',
        attributes: [
          { name: 'Item Type', options: ['Notebooks', 'Pens & Pencils', 'Art Supplies', 'School Bag', 'Calculator', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Musical Instruments',
        slug: 'musical-instruments',
        attributes: [
          { name: 'Instrument Type', options: ['Keyboard/Piano', 'Guitar', 'Drums', 'Talking Drum', 'Saxophone', 'Violin', 'DJ Controller', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Digital Products & Downloads',
        slug: 'digital-products',
        attributes: [
          { name: 'Product Type', options: ['E-book', 'Course', 'Template', 'Software', 'Beat/Audio', 'Graphics', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Delivery Method', options: ['Instant Download', 'Emailed', 'Access Link'], isRequired: true, appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Art & Collectibles',
        slug: 'art-collectibles',
        attributes: [
          { name: 'Item Type', options: ['Painting', 'Sculpture', 'Print', 'Craft', 'Antique', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Medium', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
    ],
  },
  {
    name: 'Pets & Animals',
    slug: 'pets-animals',
    icon: 'paw-print',
    children: [
      {
        name: 'Dogs & Puppies',
        slug: 'dogs-puppies',
        attributes: [
          { name: 'Breed', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Age', type: 'TEXT', isRequired: true, appliesTo: 'PRODUCT', isFilterable: false },
          { name: 'Sex', options: ['Male', 'Female'], appliesTo: 'PRODUCT' },
          { name: 'Vaccinated', options: ['Yes', 'No', 'Partially'], appliesTo: 'PRODUCT' },
        ],
      },
      {
        name: 'Cats & Other Pets',
        slug: 'cats-other-pets',
        attributes: [
          { name: 'Animal Type', options: ['Cat', 'Bird', 'Rabbit', 'Fish', 'Reptile', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'Age', type: 'TEXT', appliesTo: 'PRODUCT', isFilterable: false },
        ],
      },
      {
        name: 'Pet Food & Accessories',
        slug: 'pet-food-accessories',
        attributes: [
          { name: 'Item Type', options: ['Pet Food', 'Cage/Kennel', 'Leash & Collar', 'Grooming', 'Toys', 'Medication', 'Other'], isRequired: true, appliesTo: 'PRODUCT' },
          { name: 'For Animal', options: ['Dog', 'Cat', 'Bird', 'Fish', 'Other'], appliesTo: 'PRODUCT' },
        ],
      },
    ],
  },
];

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const leafCount = TAXONOMY.reduce((n, t) => n + t.children.length, 0);
  const attrCount = TAXONOMY.reduce(
    (n, t) => n + t.children.reduce((m, c) => m + (c.attributes?.length ?? 0), 0),
    0,
  );
  console.log(`Taxonomy: ${TAXONOMY.length} top-level, ${leafCount} leaves, ${attrCount} attributes\n`);

  const keptSlugs = new Set<string>();
  let createdCats = 0;
  let updatedCats = 0;
  let createdAttrs = 0;

  for (const [topIndex, top] of TAXONOMY.entries()) {
    keptSlugs.add(top.slug);
    const existingTop = await prisma.category.findUnique({ where: { slug: top.slug } });
    existingTop ? (updatedCats += 1) : (createdCats += 1);

    console.log(`${existingTop ? '~' : '+'} ${top.name}  (${top.children.length} subcategories)`);

    let topId = existingTop?.id ?? '';
    if (apply) {
      const saved = await prisma.category.upsert({
        where: { slug: top.slug },
        create: { name: top.name, slug: top.slug, icon: top.icon, sortOrder: topIndex * 100, isActive: true },
        update: { name: top.name, icon: top.icon, sortOrder: topIndex * 100, isActive: true, parentId: null },
      });
      topId = saved.id;
    }

    for (const [leafIndex, leaf] of top.children.entries()) {
      keptSlugs.add(leaf.slug);
      const existingLeaf = await prisma.category.findUnique({ where: { slug: leaf.slug } });
      existingLeaf ? (updatedCats += 1) : (createdCats += 1);

      const attrs = leaf.attributes ?? [];
      const required = attrs.filter((a) => a.isRequired).length;
      console.log(
        `    ${existingLeaf ? '~' : '+'} ${leaf.name.padEnd(36)} ${String(attrs.length).padStart(2)} attrs (${required} required)`,
      );

      if (!apply) {
        createdAttrs += attrs.length;
        continue;
      }

      const savedLeaf = await prisma.category.upsert({
        where: { slug: leaf.slug },
        create: {
          name: leaf.name,
          slug: leaf.slug,
          parentId: topId,
          sortOrder: leafIndex * 10,
          isActive: true,
        },
        update: { name: leaf.name, parentId: topId, sortOrder: leafIndex * 10, isActive: true },
      });

      for (const [attrIndex, attr] of attrs.entries()) {
        const isSelect = (attr.type ?? 'SELECT') === 'SELECT';
        await prisma.categoryAttribute.upsert({
          where: { categoryId_name: { categoryId: savedLeaf.id, name: attr.name } },
          create: {
            categoryId: savedLeaf.id,
            name: attr.name,
            type: attr.type ?? 'SELECT',
            options: attr.options ?? [],
            isRequired: attr.isRequired ?? false,
            appliesTo: attr.appliesTo ?? 'PRODUCT',
            // Only a controlled vocabulary makes a usable facet.
            isFilterable: attr.isFilterable ?? isSelect,
            sortOrder: attrIndex * 10,
          },
          update: {
            type: attr.type ?? 'SELECT',
            options: attr.options ?? [],
            isRequired: attr.isRequired ?? false,
            appliesTo: attr.appliesTo ?? 'PRODUCT',
            isFilterable: attr.isFilterable ?? isSelect,
            sortOrder: attrIndex * 10,
          },
        });
        createdAttrs += 1;
      }
    }
  }

  console.log(
    `\n${apply ? 'Saved' : 'Would save'} ${createdCats} new + ${updatedCats} existing categories, ${createdAttrs} attributes.`,
  );

  // Categories outside the taxonomy. Never deleted — products point at them.
  const unlisted = await prisma.category.findMany({
    where: { slug: { notIn: [...keptSlugs] } },
    select: { id: true, name: true, slug: true, isActive: true, _count: { select: { products: true } } },
  });

  if (unlisted.length) {
    console.log(`\nCategories outside the taxonomy (${unlisted.length}):`);
    for (const c of unlisted) {
      console.log(`  ${c.slug.padEnd(24)} ${c._count.products} products  ${c.isActive ? 'active' : 'inactive'}`);
    }
    if (deactivateUnlisted && apply) {
      const res = await prisma.category.updateMany({
        where: { id: { in: unlisted.map((c) => c.id) } },
        data: { isActive: false },
      });
      console.log(`  → deactivated ${res.count} (kept, not deleted — products still reference them)`);
    } else {
      console.log('  → pass --deactivate-unlisted to hide these from vendors');
    }
  }

  // Anything filed against a top-level category cannot be published under the
  // leaf-only rule, so report it rather than let it fail at publish time.
  const parentSlugs = TAXONOMY.map((t) => t.slug);
  const misfiled = await prisma.product.count({
    where: { category: { is: { slug: { in: parentSlugs } } } },
  });
  if (misfiled) {
    console.log(
      `\n${misfiled} existing listings are filed against a top-level category. ` +
        'They cannot be published until re-filed to a subcategory.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
