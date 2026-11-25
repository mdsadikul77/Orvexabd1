import crypto from 'crypto';
import { db, hashPassword } from './db.ts';

export async function seedInitialData() {
  const now = Date.now();

  // 1. Ensure Admin account exists (only on initial setup)
  const existingAdmin = await db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!existingAdmin) {
    const adminUsername = process.env.ADMIN_USERNAME || 'tmxjakir';
    const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'tmxjakir';
    await db.run(
      `INSERT OR IGNORE INTO users (id, fullName, username, emailOrPhone, passwordHash, role, shopName, status, createdAt)
       VALUES (?, ?, ?, ?, ?, 'admin', ?, 'active', ?)`,
      'admin-root',
      'Orvexa Administrator',
      adminUsername,
      'admin@orvexa.com',
      hashPassword(adminInitialPassword),
      'Orvexa Admin',
      now
    );
  }

  // 2. Seed categories & initial catalog only once if categories table is empty
  const catRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM categories`);
  const catCount = Number(catRow?.cnt || 0);
  if (catCount > 0) return;

  const categories = [
    {
      id: 'cat-fashion',
      nameEn: 'Fashion & Clothing',
      nameBn: 'ফ্যাশন ও পোশাক',
      slug: 'fashion-clothing',
      imageUrl: '/src/assets/images/cat_fashion_clothing_1795274483854.jpg',
      sortOrder: 1,
      subcategories: [
        { nameEn: "Men's Clothing", nameBn: 'ছেলেদের পোশাক' },
        { nameEn: "Women's Clothing", nameBn: 'মেয়েদের পোশাক' },
        { nameEn: "Kids' Clothing", nameBn: 'শিশুদের পোশাক' },
        { nameEn: 'T-Shirts', nameBn: 'টি-শার্ট' },
        { nameEn: 'Shirts', nameBn: 'শার্ট' },
        { nameEn: 'Polo Shirts', nameBn: 'পোলো শার্ট' },
        { nameEn: 'Pants', nameBn: 'প্যান্ট' },
        { nameEn: 'Jeans', nameBn: 'জিন্স' },
        { nameEn: 'Shorts', nameBn: 'শর্টস' },
        { nameEn: 'Jackets', nameBn: 'জ্যাকেট' },
        { nameEn: 'Hoodies', nameBn: 'হুডি' },
        { nameEn: 'Sweaters', nameBn: 'সোয়েটার' },
        { nameEn: 'Dresses', nameBn: 'ড্রেস' },
        { nameEn: 'Sarees', nameBn: 'শাড়ি' },
        { nameEn: 'Panjabi', nameBn: 'পাঞ্জাবি' },
        { nameEn: 'Three-Piece', nameBn: 'থ্রি-পিস' },
        { nameEn: 'Shoes', nameBn: 'জুতা' },
        { nameEn: 'Sneakers', nameBn: 'স্নিকার্স' },
        { nameEn: 'Sandals', nameBn: 'স্যান্ডেল' },
        { nameEn: 'Bags', nameBn: 'ব্যাগ' },
        { nameEn: 'Watches', nameBn: 'ঘড়ি' },
        { nameEn: 'Accessories', nameBn: 'অ্যাক্সেসরিজ' },
      ],
    },
    {
      id: 'cat-electronics',
      nameEn: 'Electronics',
      nameBn: 'ইলেকট্রনিক্স',
      slug: 'electronics',
      imageUrl: '/src/assets/images/cat_electronics_tech_1795274484317.jpg',
      sortOrder: 2,
      subcategories: [
        { nameEn: 'Mobile Phones', nameBn: 'মোবাইল ফোন' },
        { nameEn: 'Smartphones', nameBn: 'স্মার্টফোন' },
        { nameEn: 'Tablets', nameBn: 'ট্যাবলেট' },
        { nameEn: 'Laptops', nameBn: 'ল্যাপটপ' },
        { nameEn: 'Desktop Computers', nameBn: 'ডেস্কটপ কম্পিউটার' },
        { nameEn: 'Computer Accessories', nameBn: 'কম্পিউটার অ্যাক্সেসরিজ' },
        { nameEn: 'Headphones', nameBn: 'হেডফোন' },
        { nameEn: 'Earphones', nameBn: 'ইয়ারফোন' },
        { nameEn: 'Speakers', nameBn: 'স্পিকার' },
        { nameEn: 'Smart Watches', nameBn: 'স্মার্ট ওয়াচ' },
        { nameEn: 'Cameras', nameBn: 'ক্যামেরা' },
        { nameEn: 'Gaming Accessories', nameBn: 'গেমিং অ্যাক্সেসরিজ' },
        { nameEn: 'Chargers', nameBn: 'চার্জার' },
        { nameEn: 'Power Banks', nameBn: 'পাওয়ার ব্যাংক' },
        { nameEn: 'Keyboards', nameBn: 'কীবোর্ড' },
        { nameEn: 'Mouse', nameBn: 'মাউস' },
      ],
    },
    {
      id: 'cat-home',
      nameEn: 'Home & Living',
      nameBn: 'হোম ও লিভিং',
      slug: 'home-living',
      imageUrl: '/src/assets/images/cat_home_living_1795274486801.jpg',
      sortOrder: 3,
      subcategories: [
        { nameEn: 'Furniture', nameBn: 'ফার্নিচার' },
        { nameEn: 'Home Decor', nameBn: 'হোম ডেকোর' },
        { nameEn: 'Lighting', nameBn: 'লাইটিং' },
        { nameEn: 'Kitchen Accessories', nameBn: 'কিচেন অ্যাক্সেসরিজ' },
        { nameEn: 'Cookware', nameBn: 'কুকওয়্যার' },
        { nameEn: 'Home Appliances', nameBn: 'হোম অ্যাপ্লায়েন্স' },
        { nameEn: 'Storage', nameBn: 'স্টোরেজ' },
        { nameEn: 'Bedding', nameBn: 'বেডিং ও বিছানার চাদর' },
        { nameEn: 'Bathroom Accessories', nameBn: 'বাথরুম অ্যাক্সেসরিজ' },
      ],
    },
    {
      id: 'cat-beauty',
      nameEn: 'Beauty & Personal Care',
      nameBn: 'বিউটি ও পার্সোনাল কেয়ার',
      slug: 'beauty-personal-care',
      imageUrl: '/src/assets/images/cat_beauty_skincare_1795274483955.jpg',
      sortOrder: 4,
      subcategories: [
        { nameEn: 'Skincare', nameBn: 'স্কিনকেয়ার' },
        { nameEn: 'Hair Care', nameBn: 'হেয়ার কেয়ার' },
        { nameEn: 'Cosmetics', nameBn: 'কসমেটিক্স' },
        { nameEn: 'Makeup Accessories', nameBn: 'মেকআপ অ্যাক্সেসরিজ' },
        { nameEn: 'Personal Care', nameBn: 'পার্সোনাল কেয়ার' },
      ],
    },
    {
      id: 'cat-sports',
      nameEn: 'Sports & Outdoor',
      nameBn: 'স্পোর্টস ও আউটডোর',
      slug: 'sports-outdoor',
      imageUrl: '/src/assets/images/cat_sports_outdoor_1795274483907.jpg',
      sortOrder: 5,
      subcategories: [
        { nameEn: 'Football', nameBn: 'ফুটবল' },
        { nameEn: 'Sports Clothing', nameBn: 'স্পোর্টস পোশাক' },
        { nameEn: 'Sports Shoes', nameBn: 'স্পোর্টস জুতা' },
        { nameEn: 'Fitness Accessories', nameBn: 'ফিটনেস সরঞ্জাম' },
        { nameEn: 'Outdoor Accessories', nameBn: 'আউটডোর সরঞ্জাম' },
      ],
    },
    {
      id: 'cat-books',
      nameEn: 'Books & Stationery',
      nameBn: 'বই ও স্টেশনারি',
      slug: 'books-stationery',
      imageUrl: '/src/assets/images/cat_books_stationery_1795274483743.jpg',
      sortOrder: 6,
      subcategories: [
        { nameEn: 'Books', nameBn: 'বই' },
        { nameEn: 'Educational Books', nameBn: 'শিক্ষামূলক বই' },
        { nameEn: 'Notebooks', nameBn: 'নোটবুক ও খাতা' },
        { nameEn: 'Stationery', nameBn: 'স্টেশনারি' },
        { nameEn: 'Office Supplies', nameBn: 'অফিস সামগ্রী' },
      ],
    },
    {
      id: 'cat-food',
      nameEn: 'Food & Grocery',
      nameBn: 'খাবার ও গ্রোসারি',
      slug: 'food-grocery',
      imageUrl: '/src/assets/images/cat_food_grocery_1795274484128.jpg',
      sortOrder: 7,
      subcategories: [
        { nameEn: 'Snacks', nameBn: 'স্ন্যাকস' },
        { nameEn: 'Packaged Food', nameBn: 'প্যাকেটজাত খাবার' },
        { nameEn: 'Grocery', nameBn: 'গ্রোসারি' },
        { nameEn: 'Kitchen Essentials', nameBn: 'রান্নাঘরের প্রয়োজনীয় সামগ্রী' },
      ],
    },
    {
      id: 'cat-baby',
      nameEn: 'Baby & Kids',
      nameBn: 'বেবি ও কিডস',
      slug: 'baby-kids',
      imageUrl: '/src/assets/images/cat_baby_gifts_1795274484045.jpg',
      sortOrder: 8,
      subcategories: [
        { nameEn: 'Baby Clothing', nameBn: 'শিশুদের পোশাক' },
        { nameEn: 'Baby Accessories', nameBn: 'বেবি অ্যাক্সেসরিজ' },
        { nameEn: 'Toys', nameBn: 'খেলনা' },
        { nameEn: "Kids' Accessories", nameBn: 'কিডস অ্যাক্সেসরিজ' },
      ],
    },
    {
      id: 'cat-automotive',
      nameEn: 'Automotive',
      nameBn: 'অটোমোটিভ',
      slug: 'automotive',
      imageUrl: '/src/assets/images/cat_automotive_gear_1795274484811.jpg',
      sortOrder: 9,
      subcategories: [
        { nameEn: 'Car Accessories', nameBn: 'কার অ্যাক্সেসরিজ' },
        { nameEn: 'Motorcycle Accessories', nameBn: 'মোটরসাইকেল অ্যাক্সেসরিজ' },
        { nameEn: 'Vehicle Accessories', nameBn: 'যানবাহন সরঞ্জাম' },
      ],
    },
    {
      id: 'cat-other',
      nameEn: 'Other',
      nameBn: 'অন্যান্য',
      slug: 'other',
      imageUrl: '/src/assets/images/cat_baby_gifts_1795274484045.jpg',
      sortOrder: 10,
      subcategories: [
        { nameEn: 'Gifts', nameBn: 'উপহার সামগ্রী' },
        { nameEn: 'Handmade Products', nameBn: 'হস্তশিল্প পণ্য' },
        { nameEn: 'Accessories', nameBn: 'অ্যাক্সেসরিজ' },
        { nameEn: 'Other Products', nameBn: 'অন্যান্য পণ্য' },
      ],
    },
  ];

  // 3. Seed verified storefront sellers for initial marketplace catalog
  const demoSellerPass = hashPassword(crypto.randomBytes(16).toString('hex'));
  const sellers = [
    {
      id: 'seller-dhaka-craft',
      fullName: 'রাশেদুল করিম',
      username: 'dhakacraft',
      emailOrPhone: 'store@dhakacraft.bd',
      shopName: 'ঢাকা ক্র্যাফট ও ফ্যাশন',
      shopDescription: 'প্রিমিয়াম পাঞ্জাবি, দেশীয় শাড়ি ও আধুনিক ফ্যাশন পণ্যের বিশ্বস্ত ঠিকানা।',
    },
    {
      id: 'seller-tech-pulse',
      fullName: 'তানভীর আহমেদ',
      username: 'techpulsebd',
      emailOrPhone: 'sales@techpulse.bd',
      shopName: 'টেকপালস গ্যাজেট',
      shopDescription: 'অরিজিনাল স্মার্টওয়াচ, হেডফোন, চার্জার ও স্মার্ট গ্যাজেট কালেকশন।',
    },
    {
      id: 'seller-pure-living',
      fullName: 'নুসরাত জাহান',
      username: 'purelivingbd',
      emailOrPhone: 'hello@pureliving.bd',
      shopName: 'পিওর লিভিং স্টোর',
      shopDescription: 'হোম ডেকোর, স্কিনকেয়ার, অর্গানিক মধু ও গ্রোসারি পণ্যের নির্ভরযোগ্য শপ।',
    },
  ];

  // 4. Seed initial curated marketplace products
  const products = [
    {
      id: 'prod-emerald-panjabi',
      slug: 'emerald-cotton-panjabi',
      sellerId: 'seller-dhaka-craft',
      shopName: 'ঢাকা ক্র্যাফট ও ফ্যাশন',
      name: 'প্রিমিয়াম এমেরাল্ড কটন পাঞ্জাবি',
      description: '১০০% খাঁটি কমফোর্ট কটন ফেব্রিক দিয়ে তৈরি অভিজাত এমেরাল্ড সবুজ পাঞ্জাবি। উৎসব, ঈদ এবং যেকোনো বিশেষ অনুষ্ঠানে আরামদায়ক ও স্টাইলিশ লুকের জন্য উপযোগী। নিখুঁত এমব্রয়ডারি কলার ও প্লেট ডিজাইন।',
      categoryId: 'cat-fashion',
      subcategory: 'Panjabi',
      previousPrice: 2450,
      currentPrice: 1790,
      stock: 28,
      images: ['/src/assets/images/prod_panjabi_heritage_1795274483747.jpg', '/src/assets/images/cat_fashion_clothing_1795274483854.jpg'],
      variations: { sizes: ['M', 'L', 'XL', 'XXL'], colors: ['এমেরাল্ড গ্রিন', 'নেভি ব্লু'] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 420,
      ratingAvg: 4.9,
      ratingCount: 34,
    },
    {
      id: 'prod-linen-fashion-set',
      slug: 'classic-linen-shirt-sneakers',
      sellerId: 'seller-dhaka-craft',
      shopName: 'ঢাকা ক্র্যাফট ও ফ্যাশন',
      name: 'ক্লাসিক লিনেন শার্ট ও স্নিকার্স কালেকশন',
      description: 'গ্রীষ্মের জন্য আরামদায়ক প্রিমিয়াম লিনেন ক্যাজুয়াল শার্ট। ব্রেথেবল ফেব্রিক, নিখুঁত স্টিচিং এবং দীর্ঘস্থায়ী রঙ। অফিস ও ক্যাজুয়াল আউটিংয়ের জন্য সেরা পছন্দ।',
      categoryId: 'cat-fashion',
      subcategory: 'Shirts',
      previousPrice: 1850,
      currentPrice: 1390,
      stock: 42,
      images: ['/src/assets/images/cat_fashion_clothing_1795274483854.jpg'],
      variations: { sizes: ['S', 'M', 'L', 'XL'], colors: ['বেইজ', 'সাদা'] },
      isFeatured: 1,
      isTrending: 0,
      isRecommended: 1,
      views: 310,
      ratingAvg: 4.7,
      ratingCount: 19,
    },
    {
      id: 'prod-anc-headphones',
      slug: 'studio-wireless-anc-headphones',
      sellerId: 'seller-tech-pulse',
      shopName: 'টেকপালস গ্যাজেট',
      name: 'অ্যাক্টিভ নয়েজ ক্যান্সেলিং ওয়্যারলেস হেডফোন',
      description: '৪০ ঘন্টা ব্যাটারি ব্যাকআপ, ব্লুটুথ ৫.৩, ডিপ বেস সাউন্ড এবং হাইব্রিড অ্যাক্টিভ নয়েজ ক্যান্সেলেশন সুবিধা। ওয়ার্ক ফ্রম হোম, গেমিং এবং মিউজিক লাভারদের জন্য চমৎকার পারফরম্যান্স।',
      categoryId: 'cat-electronics',
      subcategory: 'Headphones',
      previousPrice: 4990,
      currentPrice: 3650,
      stock: 15,
      images: ['/src/assets/images/cat_electronics_tech_1795274484317.jpg'],
      variations: { colors: ['ম্যাট ব্ল্যাক', 'সিলভার'] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 685,
      ratingAvg: 4.9,
      ratingCount: 52,
    },
    {
      id: 'prod-amoled-smartwatch',
      slug: 'aurora-amoled-smartwatch',
      sellerId: 'seller-tech-pulse',
      shopName: 'টেকপালস গ্যাজেট',
      name: 'অরোরা অ্যামোলেড স্মার্টওয়াচ ও কলিং সাপোর্ট',
      description: '১.৯৬ ইঞ্চি কার্ভড অ্যামোলেড ডিসপ্লে, ব্লুটুথ কলিং, হার্ট রেট ও SpO2 মনিটর এবং ওয়াটার-রেজিস্ট্যান্ট ডিজাইন। ১ বছরের অফিসিয়াল ওয়ারেন্টি সহ।',
      categoryId: 'cat-electronics',
      subcategory: 'Smart Watches',
      previousPrice: 3800,
      currentPrice: 2890,
      stock: 22,
      images: ['/src/assets/images/banner_seller_ads_1795274485740.jpg', '/src/assets/images/cat_electronics_tech_1795274484317.jpg'],
      variations: { colors: ['মিডনাইট ব্ল্যাক', 'গোল্ডেন'] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 0,
      views: 540,
      ratingAvg: 4.8,
      ratingCount: 41,
    },
    {
      id: 'prod-ceramic-table-lamp',
      slug: 'scandinavian-ceramic-lamp',
      sellerId: 'seller-pure-living',
      shopName: 'পিওর লিভিং স্টোর',
      name: 'স্ক্যান্ডিনেভিয়ান সিরামিক টেবিল ল্যাম্প ও হোম ডেকোর',
      description: 'হাতে তৈরি ম্যাট সিরামিক বেস ও লিনেন শেড ল্যাম্প। বেডরুম বা ড্রয়িংরুমের পরিবেশকে আরও উষ্ণ ও নান্দনিক করে তোলে। স্ট্যান্ডার্ড E27 বাল্ব সাপোর্টেড।',
      categoryId: 'cat-home',
      subcategory: 'Lighting',
      previousPrice: 3200,
      currentPrice: 2490,
      stock: 14,
      images: ['/src/assets/images/cat_home_living_1795274486801.jpg'],
      variations: { colors: ['ক্রিম হোয়াইট', 'ন্যাচারাল ওক'] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 1,
      views: 275,
      ratingAvg: 4.9,
      ratingCount: 16,
    },
    {
      id: 'prod-botanical-serum',
      slug: 'radiance-botanical-glow-serum',
      sellerId: 'seller-pure-living',
      shopName: 'পিওর লিভিং স্টোর',
      name: 'রেডিয়েন্স বোটানিক্যাল গ্লো সিরাম ও জেড রোলার সেট',
      description: 'ভিটামিন-সি, হায়ালুরোনিক অ্যাসিড এবং প্রাকৃতিক উদ্ভিদ নির্যাস সমৃদ্ধ স্কিনকেয়ার সেট। ত্বকের উজ্জ্বলতা বৃদ্ধি করে এবং আর্দ্রতা ধরে রাখে। সব ধরনের ত্বকের জন্য নিরাপদ।',
      categoryId: 'cat-beauty',
      subcategory: 'Skincare',
      previousPrice: 1950,
      currentPrice: 1450,
      stock: 36,
      images: ['/src/assets/images/cat_beauty_skincare_1795274483955.jpg'],
      variations: { sizes: ['৩০ মিলি সিরাম + রোলার', 'শুধু ৩০ মিলি'] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 490,
      ratingAvg: 4.8,
      ratingCount: 29,
    },
    {
      id: 'prod-pro-running-shoes',
      slug: 'velocity-pro-running-sneakers',
      sellerId: 'seller-dhaka-craft',
      shopName: 'ঢাকা ক্র্যাফট ও ফ্যাশন',
      name: 'ভেলোসিটি প্রো রানিং স্নিকার্স ও স্পোর্টস জুতা',
      description: 'আল্ট্রা-লাইট কুশনড সোল এবং ব্রেথেবল মেশ আপার দিয়ে তৈরি রানিং ও জিম জুতা। দৌড়ানো, হাঁটা এবং দৈনন্দিন ব্যবহারের জন্য অসাধারণ গ্রিপ ও আরাম।',
      categoryId: 'cat-sports',
      subcategory: 'Sports Shoes',
      previousPrice: 3400,
      currentPrice: 2590,
      stock: 19,
      images: ['/src/assets/images/cat_sports_outdoor_1795274483907.jpg'],
      variations: { sizes: ['40', '41', '42', '43', '44'], colors: ['অরেঞ্জ ব্ল্যাক'] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 1,
      views: 360,
      ratingAvg: 4.7,
      ratingCount: 23,
    },
    {
      id: 'prod-artisan-notebook-pen',
      slug: 'executive-notebook-fountain-pen-set',
      sellerId: 'seller-pure-living',
      shopName: 'পিওর লিভিং স্টোর',
      name: 'এক্সিকিউটিভ হার্ডকভার নোটবুক ও পিতলের ফাউন্টেন পেন সেট',
      description: '১২০ জিএসএম প্রিমিয়াম ক্রাফট পেপার নোটবুক ও ক্লাসিক ব্রাস ফাউন্টেন পেন। লেখালেখি, জার্নালিং বা প্রিয়জনকে উপহার দেওয়ার জন্য দারুণ একটি প্যাকেজ।',
      categoryId: 'cat-books',
      subcategory: 'Notebooks',
      previousPrice: 1250,
      currentPrice: 950,
      stock: 50,
      images: ['/src/assets/images/cat_books_stationery_1795274483743.jpg'],
      variations: { colors: ['ক্রাফট ব্রাউন', 'ফরেস্ট গ্রিন'] },
      isFeatured: 0,
      isTrending: 0,
      isRecommended: 1,
      views: 195,
      ratingAvg: 4.8,
      ratingCount: 14,
    },
    {
      id: 'prod-sundarban-honey-tea',
      slug: 'organic-wildflower-honey-tea-combo',
      sellerId: 'seller-pure-living',
      shopName: 'পিওর লিভিং স্টোর',
      name: 'খাঁটি সুন্দরবনের মধু ও প্রিমিয়াম গ্রিন টি কম্বো',
      description: '১০০% প্রাকৃতিক ও ল্যাব-টেস্টেড বুনো ফুলের মধু (৫০০ গ্রাম) এবং সিলেটের বাগান থেকে সংগৃহীত প্রিমিয়াম চা পাতা। পরিবারের প্রতিদিনের সুস্থতার জন্য।',
      categoryId: 'cat-food',
      subcategory: 'Grocery',
      previousPrice: 1400,
      currentPrice: 1090,
      stock: 60,
      images: ['/src/assets/images/cat_food_grocery_1795274484128.jpg'],
      variations: { sizes: ['৫০০ গ্রাম কম্বো', '১ কেজি ফ্যামিলি প্যাক'] },
      isFeatured: 1,
      isTrending: 0,
      isRecommended: 1,
      views: 380,
      ratingAvg: 4.9,
      ratingCount: 47,
    },
    {
      id: 'prod-wooden-baby-gift-box',
      slug: 'eco-wooden-toys-organic-baby-set',
      sellerId: 'seller-pure-living',
      shopName: 'পিওর লিভিং স্টোর',
      name: 'শিশুদের অর্গানিক নিটওয়্যার ও কাঠের খেলনা গিফট বক্স',
      description: 'নবজাতক ও শিশুদের জন্য নরম অর্গানিক কটন সোয়েটার এবং নিরাপদ কেমিক্যালমুক্ত প্রাকৃতিক কাঠের ব্লক খেলনা। আকর্ষণীয় রিবন গিফট বক্সে পরিবেশিত।',
      categoryId: 'cat-baby',
      subcategory: 'Toys',
      previousPrice: 2100,
      currentPrice: 1650,
      stock: 20,
      images: ['/src/assets/images/cat_baby_gifts_1795274484045.jpg'],
      variations: { sizes: ['৬-১২ মাস', '১-২ বছর'] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 0,
      views: 240,
      ratingAvg: 4.9,
      ratingCount: 18,
    },
    {
      id: 'prod-matte-helmet-inflator',
      slug: 'pro-matte-motorcycle-helmet-air-pump',
      sellerId: 'seller-tech-pulse',
      shopName: 'টেকপালস গ্যাজেট',
      name: 'DOT সার্টিফায়েড ম্যাট হেলমেট ও পোর্টেবল টায়ার পাম্প',
      description: 'মজবুত এবিএস শেল ফুল-ফেস ম্যাট ব্ল্যাক মোটরসাইকেল হেলমেট ও ডিজিটাল পোর্টেবল এয়ার ইনফ্লেটর। বাইকারদের নিরাপদ ভ্রমণের নির্ভরযোগ্য সঙ্গী।',
      categoryId: 'cat-automotive',
      subcategory: 'Motorcycle Accessories',
      previousPrice: 5200,
      currentPrice: 4190,
      stock: 11,
      images: ['/src/assets/images/cat_automotive_gear_1795274484811.jpg'],
      variations: { sizes: ['M', 'L', 'XL'], colors: ['ম্যাট ব্ল্যাক'] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 0,
      views: 315,
      ratingAvg: 4.8,
      ratingCount: 21,
    },
  ];

  // 7. Seed Site Settings
  const defaultSettings: Record<string, unknown> = {
    heroBanners: [
      {
        id: 'banner-1',
        title: 'বাংলাদেশের নির্ভরযোগ্য মাল্টি-ভেন্ডর মার্কেটপ্লেস',
        subtitle: 'যাচাইকৃত সেলারদের সেরা মানের ফ্যাশন, গ্যাজেট, হোম ডেকোর এবং নিত্যপ্রয়োজনীয় পণ্য কিনুন সাশ্রয়ী মূল্যে ও ক্যাশ অন ডেলিভারিতে।',
        ctaLabel: 'শপিং শুরু করুন',
        ctaTarget: 'products',
        imageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
        isActive: true,
      },
    ],
    productAdsSection: {
      enabled: true,
      heading: 'স্পন্সরড ও বিশেষ প্রচারমূলক পণ্য',
      subheading: 'হোমপেজের শীর্ষে প্রদর্শিত নির্বাচিত সেলারদের পণ্যসমূহ',
    },
    sellerProductAdsPage: {
      bannerTitle: 'আপনার পণ্যকে আরও বেশি ক্রেতার সামনে তুলে ধরুন!',
      bannerSubtitle: 'Orvexa-তে স্পন্সরড বিজ্ঞাপনের মাধ্যমে আপনার শপের বিক্রি ও পরিচিতি বহুগুণ বাড়িয়ে তুলুন।',
      bannerImageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
      description: 'আপনার পণ্যের বিজ্ঞাপন হোমপেজের বিশেষ প্রচারমূলক অংশে প্রকাশ করার মাধ্যমে আরও বেশি ক্রেতার নজরে আসার সুযোগ তৈরি করুন। বিজ্ঞাপিত পণ্যটি হোমপেজের উপরের অংশে আকর্ষণীয়ভাবে প্রদর্শিত হবে এবং ক্রেতারা View বাটনে ক্লিক করে সরাসরি আপনার পণ্যের বিস্তারিত পেজে যেতে পারবেন।\n\nআপনার পণ্যের প্রচার বৃদ্ধি করুন, আরও বেশি মানুষের কাছে পৌঁছান এবং বিক্রির সম্ভাবনা বাড়িয়ে তুলুন।',
      benefits: [
        'হোমপেজের একদম উপরের প্রাইম সেকশনে পণ্যের বিশেষ প্রদর্শনী',
        'সরাসরি View বাটনের মাধ্যমে ক্রেতাদের পণ্যের বিস্তারিত পেজে প্রবেশ',
        'সেলার ইনবক্সে ক্রেতাদের সরাসরি জিজ্ঞাসা ও দ্রুত অর্ডার বৃদ্ধির সুযোগ',
        'নির্ধারিত সময়সীমা অনুযায়ী Admin দ্বারা পরিচালিত নিরাপদ ও কার্যকর প্রচারণা',
      ],
      howItWorks: [
        'আপনার সেলার অ্যাকাউন্টে আগে পণ্যটি প্রকাশ করুন এবং পণ্যের লিংক কপি করুন।',
        'নিচের WhatsApp নম্বরে Admin-এর সাথে যোগাযোগ করে আপনার পণ্যের লিংক ও শপের নাম পাঠান।',
        'বিজ্ঞাপনের সময়কাল ও বিবরণ নিশ্চিত হলে Admin আপনার পণ্যটি হোমপেজের Product Ads সেকশনে যুক্ত করে দেবেন।',
      ],
      contactHeading: 'আপনার পণ্যের বিজ্ঞাপন প্রকাশ করতে Admin-এর সাথে যোগাযোগ করুন',
      whatsappNumbers: ['01622922252', '01329205761'],
      ctaText: 'WhatsApp-এ মেসেজ দিন',
    },
    paymentOptions: {
      cashOnDelivery: true,
      bkashEnabled: false,
      nagadEnabled: false,
      deliveryFee: 70,
      dhakaDeliveryFee: 70,
      outsideDhakaDeliveryFee: 120,
      freeDeliveryThreshold: 0,
    },
    contactInfo: {
      email: 'support@orvexa.com',
      phone: '01622922252',
      whatsapp: '01622922252',
      address: 'ঢাকা, বাংলাদেশ',
    },
    footerSettings: {
      aboutText: 'Orvexa হলো বাংলাদেশের আধুনিক মাল্টি-ভেন্ডর ই-কমার্স মার্কেটপ্লেস, যেখানে ক্রেতা ও বিক্রেতারা সরাসরি যুক্ত হয়ে নিরাপদ ও দ্রুত কেনাকাটা করতে পারেন।',
      copyrightText: '© ২০২৬ Orvexa. সর্বস্বত্ব সংরক্ষিত।',
    },
    generalSettings: {
      siteName: 'Orvexa',
      announcementText: 'সারা বাংলাদেশে দ্রুত হোম ডেলিভারি ও ক্যাশ অন ডেলিভারি সুবিধা উপলব্ধ।',
      announcementActive: true,
    },
    customCode: {
      enabled: true,
      customCss: '',
      customBannerHtml: '',
      headScripts: '',
      customJs: '',
    },
    customPages: [],
    customBlocks: [],
  };

  await db.transaction(async (tx) => {
    for (const c of categories) {
      await tx.run(
        `INSERT OR IGNORE INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        c.id,
        c.nameEn,
        c.nameBn,
        c.slug,
        c.imageUrl,
        JSON.stringify(c.subcategories),
        c.sortOrder
      );
    }

    for (const s of sellers) {
      await tx.run(
        `INSERT OR IGNORE INTO users (id, fullName, username, emailOrPhone, passwordHash, role, shopName, shopDescription, status, createdAt)
         VALUES (?, ?, ?, ?, ?, 'seller', ?, ?, 'active', ?)`,
        s.id,
        s.fullName,
        s.username,
        s.emailOrPhone,
        demoSellerPass,
        s.shopName,
        s.shopDescription,
        now
      );
    }

    for (let idx = 0; idx < products.length; idx++) {
      const p = products[idx];
      await tx.run(
        `INSERT OR IGNORE INTO products (
          id, slug, sellerId, shopName, name, description, categoryId, subcategory,
          previousPrice, currentPrice, stock, images, variations,
          isFeatured, isTrending, isRecommended, isHidden, views, ratingAvg, ratingCount, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        p.id,
        p.slug,
        p.sellerId,
        p.shopName,
        p.name,
        p.description,
        p.categoryId,
        p.subcategory,
        p.previousPrice,
        p.currentPrice,
        p.stock,
        JSON.stringify(p.images),
        JSON.stringify(p.variations),
        p.isFeatured,
        p.isTrending,
        p.isRecommended,
        p.views,
        p.ratingAvg,
        p.ratingCount,
        now - idx * 3600000
      );
    }

    // 5. Seed Homepage Product Ads (Admin controlled)
    const adProds = [
      ['hpad-1', 'prod-emerald-panjabi', 'বিশেষ উৎসব অফার — ২৭% ছাড়', null, 1, now],
      ['hpad-2', 'prod-anc-headphones', 'টপ সেলার স্পটলাইট', null, 2, now],
      ['hpad-3', 'prod-amoled-smartwatch', 'সীমিত সময়ের প্রচারণা', null, 3, now],
      ['hpad-4', 'prod-botanical-serum', 'জনপ্রিয় স্কিনকেয়ার সেট', null, 4, now],
    ] as const;
    for (const row of adProds) {
      await tx.run(
        `INSERT OR IGNORE INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`,
        ...row
      );
    }

    // 6. Seed Advertisements across sections
    await tx.run(
      `INSERT OR IGNORE INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      'ad-home-mid',
      'সেলার মেগা ক্যাম্পেইন',
      'homepage_middle',
      'banner',
      '/src/assets/images/banner_seller_ads_1795274485740.jpg',
      '#products',
      null,
      null,
      now
    );

    for (const [key, val] of Object.entries(defaultSettings)) {
      await tx.run(
        `INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)`,
        key,
        JSON.stringify(val)
      );
    }
  });
}
