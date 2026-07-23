"use strict";

// Generated from the reviewed Basic Diet menu workbook on 2026-07-23.
// Prices are stored in halalas. Main catalog products are one-time-order items.

const categories = [
  {
    "key": "breakfast",
    "name": {
      "ar": "الفطور",
      "en": "Breakfast"
    },
    "description": {
      "ar": "أطباق فطور صحية وخيارات صباحية خفيفة.",
      "en": "Healthy breakfast dishes and light morning options."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 1
  },
  {
    "key": "meals",
    "name": {
      "ar": "الوجبات",
      "en": "Meals"
    },
    "description": {
      "ar": "وجبات جاهزة وأطباق متكاملة تعتمد على البروتين.",
      "en": "Ready meals and complete protein-based dishes."
    },
    "ui": {
      "cardVariant": "meal_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 2
  },
  {
    "key": "sandwiches",
    "name": {
      "ar": "الساندويتشات",
      "en": "Sandwiches"
    },
    "description": {
      "ar": "ساندويتشات جاهزة وقابلة للتخصيص.",
      "en": "Ready and customizable sandwiches."
    },
    "ui": {
      "cardVariant": "sandwich_collection",
      "behaviorHint": "customize_optional_addons",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 3
  },
  {
    "key": "salads",
    "name": {
      "ar": "السلطات",
      "en": "Salads"
    },
    "description": {
      "ar": "سلطات صغيرة وكبيرة وخيارات قابلة للتخصيص.",
      "en": "Small, large and customizable salads."
    },
    "ui": {
      "cardVariant": "meal_collection",
      "behaviorHint": "customize_optional_addons",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 4
  },
  {
    "key": "carbs",
    "name": {
      "ar": "الكارب",
      "en": "Carbs & Sides"
    },
    "description": {
      "ar": "الأرز والمكرونة والبطاطس والخضار الجانبية.",
      "en": "Rice, pasta, potatoes and vegetable side dishes."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 5
  },
  {
    "key": "greek_yogurt",
    "name": {
      "ar": "زبادي يوناني",
      "en": "Greek Yogurt"
    },
    "description": {
      "ar": "منتجات الزبادي اليوناني المنفردة.",
      "en": "Individual Greek yogurt products."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 6
  },
  {
    "key": "desserts",
    "name": {
      "ar": "الحلويات",
      "en": "Desserts"
    },
    "description": {
      "ar": "كيك وتشيز كيك وبراونيز وحلويات بروتين.",
      "en": "Cakes, cheesecakes, brownies and protein desserts."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 7
  },
  {
    "key": "ice_cream",
    "name": {
      "ar": "الآيس كريم",
      "en": "Ice Cream"
    },
    "description": {
      "ar": "منتجات وإضافات الآيس كريم.",
      "en": "Ice cream products and add-ons."
    },
    "ui": {
      "cardVariant": "addon_collection",
      "behaviorHint": "customize_optional_addons",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 8
  },
  {
    "key": "juices",
    "name": {
      "ar": "العصائر",
      "en": "Juices"
    },
    "description": {
      "ar": "عصائر ومشروبات فواكه وخضار.",
      "en": "Fruit and vegetable juice options."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 9
  },
  {
    "key": "drinks",
    "name": {
      "ar": "المشروبات",
      "en": "Drinks"
    },
    "description": {
      "ar": "مشروبات البروتين والمشروبات الباردة.",
      "en": "Protein drinks and cold beverages."
    },
    "ui": {
      "cardVariant": "compact_product_collection",
      "behaviorHint": "direct_add",
      "priceLabelMode": "fixed"
    },
    "sortOrder": 10
  }
];

const products = [
  {
    "key": "breakfast_scrambled_eggs",
    "categoryKey": "breakfast",
    "name": {
      "ar": "بيض اسكرامبل",
      "en": "Scrambled Eggs"
    },
    "description": {
      "ar": "طبق بيض مخفوق ناعم مجهز بكريمة الطبخ وجبن الشيدر الخفيف.",
      "en": "Soft scrambled eggs prepared with cooking cream and light cheddar cheese."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 230,
      "proteinGrams": 19,
      "carbsGrams": 1,
      "fatGrams": 15
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 1
  },
  {
    "key": "breakfast_shakshuka",
    "categoryKey": "breakfast",
    "name": {
      "ar": "شكشوكة",
      "en": "Shakshuka"
    },
    "description": {
      "ar": "شكشوكة صحية مكونة من البيض المطهو مع الخضار الطازجة.",
      "en": "A healthy shakshuka made with eggs cooked with fresh vegetables."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 260,
      "proteinGrams": 20,
      "carbsGrams": 8,
      "fatGrams": 16
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 2
  },
  {
    "key": "breakfast_eggs_with_tomato_and_thyme",
    "categoryKey": "breakfast",
    "name": {
      "ar": "بيض بالطماطم والزعتر",
      "en": "Eggs with Tomato and Thyme"
    },
    "description": {
      "ar": "بيض لذيذ بنكهة الطماطم الممزوجة مع الزعتر والثوم وزيت الزيتون.",
      "en": "Eggs flavored with tomato, thyme, garlic and olive oil."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 265,
      "proteinGrams": 19,
      "carbsGrams": 7,
      "fatGrams": 17
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 3
  },
  {
    "key": "breakfast_vegetable_omelet",
    "categoryKey": "breakfast",
    "name": {
      "ar": "بيض أومليت بالخضار",
      "en": "Vegetable Omelet"
    },
    "description": {
      "ar": "أومليت متكامل غني بالخضار المشكلة وزيت الزيتون النقي.",
      "en": "A wholesome omelet with mixed vegetables and pure olive oil."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 230,
      "proteinGrams": 19,
      "carbsGrams": 1,
      "fatGrams": 16
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 4
  },
  {
    "key": "breakfast_turkey_eggs",
    "categoryKey": "breakfast",
    "name": {
      "ar": "بيض تركي",
      "en": "Turkey Eggs"
    },
    "description": {
      "ar": "طبق بيض مميز مضاف إليه شرائح الديك الرومي والفلفل الرومي.",
      "en": "Eggs served with turkey slices and bell peppers."
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 280,
      "proteinGrams": 26,
      "carbsGrams": 2,
      "fatGrams": 17
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 5
  },
  {
    "key": "breakfast_foul_medames",
    "categoryKey": "breakfast",
    "name": {
      "ar": "فول",
      "en": "Foul Medames"
    },
    "description": {
      "ar": "طبق فول مدمس تقليدي وغني بالنكهات والخضار الطازجة مع عصرة الليمون.",
      "en": "Traditional fava beans with fresh vegetables and a squeeze of lemon."
    },
    "priceHalala": 900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 250,
      "proteinGrams": 15,
      "carbsGrams": 28,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 6
  },
  {
    "key": "breakfast_hummus",
    "categoryKey": "breakfast",
    "name": {
      "ar": "حمص",
      "en": "Hummus"
    },
    "description": {
      "ar": "طبق حمص صافي ومهروس يقدم مع الطحينة وزيت الزيتون والليمون.",
      "en": "Smooth hummus served with tahini, olive oil and lemon."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 320,
      "proteinGrams": 12,
      "carbsGrams": 28,
      "fatGrams": 17
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 7
  },
  {
    "key": "breakfast_beef_liver",
    "categoryKey": "breakfast",
    "name": {
      "ar": "كبدة",
      "en": "Beef Liver"
    },
    "description": {
      "ar": "كبدة بقري طازجة مقلمة بالفلفل الأخضر والطماطم والكزبرة.",
      "en": "Fresh beef liver sautéed with green pepper, tomato and coriander."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 315,
      "proteinGrams": 41,
      "carbsGrams": 6,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 8
  },
  {
    "key": "breakfast_tuna",
    "categoryKey": "breakfast",
    "name": {
      "ar": "تونا",
      "en": "Tuna"
    },
    "description": {
      "ar": "سلطة تونة خفيفة ومنعشة بالبصل الأخضر والفلفل الرومي والليمون.",
      "en": "A light tuna salad with spring onion, bell pepper and lemon."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 260,
      "proteinGrams": 48,
      "carbsGrams": 3,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 9
  },
  {
    "key": "breakfast_healthy_baked_falafel_6_pieces",
    "categoryKey": "breakfast",
    "name": {
      "ar": "فلافل صحية (6 حبات)",
      "en": "Healthy Baked Falafel (6 Pieces)"
    },
    "description": {
      "ar": "6 حبات فلافل مخبوزة بشكل صحي مكونة من الحمص والخضار.",
      "en": "Six healthy baked falafel pieces made with chickpeas and vegetables."
    },
    "priceHalala": 900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 270,
      "proteinGrams": 12,
      "carbsGrams": 32,
      "fatGrams": 9
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 10
  },
  {
    "key": "breakfast_healthy_fries",
    "categoryKey": "breakfast",
    "name": {
      "ar": "فرايز صحي",
      "en": "Healthy Fries"
    },
    "description": {
      "ar": "أصابع بطاطس مشوية صحية ومحضرة بزيت الزيتون الخفيف.",
      "en": "Healthy roasted potato fries prepared with a light touch of olive oil."
    },
    "priceHalala": 900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 205,
      "proteinGrams": 4,
      "carbsGrams": 32,
      "fatGrams": 5
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 11
  },
  {
    "key": "breakfast_parmesan_mashed_potatoes_with_boiled_eggs",
    "categoryKey": "breakfast",
    "name": {
      "ar": "ماش بوتيتو بالبارميزان وبيض مسلوق",
      "en": "Parmesan Mashed Potatoes with Boiled Eggs"
    },
    "description": {
      "ar": "بطاطس مهروسة كريمية تقدم مع البيض المسلوق وتتوج بجبنة البارميزان.",
      "en": "Creamy mashed potatoes served with boiled eggs and Parmesan cheese."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 375,
      "proteinGrams": 23,
      "carbsGrams": 32,
      "fatGrams": 15
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 12
  },
  {
    "key": "breakfast_labneh_with_sumac",
    "categoryKey": "breakfast",
    "name": {
      "ar": "لبنة بالسماق",
      "en": "Labneh with Sumac"
    },
    "description": {
      "ar": "لبنة طازجة منكهة بالسماق وزيت الزيتون ومقدمة مع الطماطم الشيري والزيتون.",
      "en": "Fresh labneh flavored with sumac and olive oil, served with cherry tomatoes and olives."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": 11,
      "carbsGrams": 9,
      "fatGrams": 9
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 13
  },
  {
    "key": "breakfast_oatmeal_with_milk",
    "categoryKey": "breakfast",
    "name": {
      "ar": "شوفان مع الحليب",
      "en": "Oatmeal with Milk"
    },
    "description": {
      "ar": "إفطار شوفان مغذي يحضر بالحليب ويُحلى بالعسل مع قطع الفواكه.",
      "en": "Nutritious oatmeal prepared with milk, honey and fruit pieces."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 195,
      "proteinGrams": 11,
      "carbsGrams": 32,
      "fatGrams": 3
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 14
  },
  {
    "key": "breakfast_greek_yogurt_with_honey_and_fruit",
    "categoryKey": "breakfast",
    "name": {
      "ar": "زبادي يوناني",
      "en": "Greek Yogurt with Honey and Fruit"
    },
    "description": {
      "ar": "زبادي يوناني غني بالبروتين يقدم مع العسل الطبيعي والفواكه الطازجة.",
      "en": "Protein-rich Greek yogurt served with natural honey and fresh fruit."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 150,
      "proteinGrams": 16,
      "carbsGrams": 23,
      "fatGrams": 0.5
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 15
  },
  {
    "key": "breakfast_granola_with_fruit_and_honey",
    "categoryKey": "breakfast",
    "name": {
      "ar": "جرانولا مع الفواكه والعسل",
      "en": "Granola with Fruit and Honey"
    },
    "description": {
      "ar": "طبق جرانولا مقرمش يجمع بين المكسرات والشوفان والعسل والفواكه.",
      "en": "Crunchy granola with nuts, oats, honey and fruit."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 310,
      "proteinGrams": 6,
      "carbsGrams": 39,
      "fatGrams": 9
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 16
  },
  {
    "key": "meals_chicken_white_sauce_pasta",
    "categoryKey": "meals",
    "name": {
      "ar": "باستا وايت صوص بالدجاج",
      "en": "Chicken White Sauce Pasta"
    },
    "description": {
      "ar": "معكرونة بينا بالصوص الأبيض وصدور الدجاج الغنية بالبارميزان.",
      "en": "Penne pasta with white sauce, chicken breast and Parmesan cheese."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 410,
      "proteinGrams": 38,
      "carbsGrams": 39,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 1
  },
  {
    "key": "meals_chicken_with_molokhia",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج بالملوخية",
      "en": "Chicken with Molokhia"
    },
    "description": {
      "ar": "دجاج مع الملوخية الخضراء اللذيذة، محضرة بلمسة صحية.",
      "en": "Chicken served with flavorful green molokhia, prepared with a healthy touch."
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 124,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 2
  },
  {
    "key": "meals_chicken_with_okra",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج بالبامية",
      "en": "Chicken with Okra"
    },
    "description": {
      "ar": "قطع دجاج طرية مطهوة ببطء مع البامية الطازجة بصلصة صحية.",
      "en": "Tender chicken slow-cooked with fresh okra in a light, flavorful sauce."
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 110,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 3
  },
  {
    "key": "meals_moussaka_with_minced_beef",
    "categoryKey": "meals",
    "name": {
      "ar": "مسقعة باللحمة المفرومة",
      "en": "Moussaka with Minced Beef"
    },
    "description": {
      "ar": "مسقعة صحية من الباذنجان والفلفل المشوي مع اللحم البقري المفروم وصلصة الطماطم.",
      "en": "Healthy moussaka with eggplant, roasted peppers, minced beef and tomato sauce."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": 18,
      "carbsGrams": 13,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 4
  },
  {
    "key": "meals_beef_lasagna",
    "categoryKey": "meals",
    "name": {
      "ar": "لازانيا باللحم المفروم",
      "en": "Beef Lasagna"
    },
    "description": {
      "ar": "لازانيا من الحبة الكاملة باللحم المفروم والأجبان الخفيفة وصلصة الطماطم.",
      "en": "Whole-grain lasagna with minced beef, light cheese and natural tomato sauce."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 290,
      "proteinGrams": 26,
      "carbsGrams": 26,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 5
  },
  {
    "key": "meals_b_chamel_pasta_with_minced_beef",
    "categoryKey": "meals",
    "name": {
      "ar": "مكرونة بشاميل باللحم المفروم",
      "en": "Béchamel Pasta with Minced Beef"
    },
    "description": {
      "ar": "معكرونة بصوص البشاميل الصحي مع اللحم البقري المفروم وحليب قليل الدسم وموتزاريلا لايت.",
      "en": "Pasta with a light béchamel sauce, minced beef, low-fat milk and light mozzarella."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 290,
      "proteinGrams": 22,
      "carbsGrams": 26,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 6
  },
  {
    "key": "meals_stuffed_zucchini_with_minced_beef",
    "categoryKey": "meals",
    "name": {
      "ar": "محشي كوسا باللحم المفروم",
      "en": "Stuffed Zucchini with Minced Beef"
    },
    "description": {
      "ar": "كوسا محشو باللحم البقري المفروم ومطهو بصلصة الطماطم وزيت الزيتون.",
      "en": "Zucchini stuffed with minced beef and cooked in tomato sauce and olive oil."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 220,
      "proteinGrams": 28,
      "carbsGrams": 12,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 7
  },
  {
    "key": "meals_kofta_with_tahini_and_white_rice",
    "categoryKey": "meals",
    "name": {
      "ar": "كفتة بالطحينة مع أرز أبيض",
      "en": "Kofta with Tahini and White Rice"
    },
    "description": {
      "ar": "كفتة لحم بقري مع صوص الطحينة والأرز الأبيض.",
      "en": "Beef kofta served with tahini sauce and white rice."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 360,
      "proteinGrams": 20,
      "carbsGrams": 36,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 8
  },
  {
    "key": "meals_chicken_fettuccine",
    "categoryKey": "meals",
    "name": {
      "ar": "فوتوتشيني بالدجاج",
      "en": "Chicken Fettuccine"
    },
    "description": {
      "ar": "معكرونة فوتوتشيني مع صدور الدجاج وكريمة الطبخ وجبنة البارميزان.",
      "en": "Fettuccine pasta with chicken breast, cooking cream and Parmesan cheese."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 410,
      "proteinGrams": 38,
      "carbsGrams": 39,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 9
  },
  {
    "key": "meals_shish_tawook",
    "categoryKey": "meals",
    "name": {
      "ar": "شيش طاووق",
      "en": "Shish Tawook"
    },
    "description": {
      "ar": "مكعبات دجاج مشوية بتتبيلة تقليدية.",
      "en": "Grilled chicken cubes with a traditional shish tawook marinade."
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 240,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 10
  },
  {
    "key": "meals_chicken_red_sauce_pasta",
    "categoryKey": "meals",
    "name": {
      "ar": "باستا رد صوص دجاج",
      "en": "Chicken Red Sauce Pasta"
    },
    "description": {
      "ar": "معكرونة بينا بصلصة الطماطم الحمراء مع صدور الدجاج والبارميزان.",
      "en": "Penne pasta with natural red tomato sauce, chicken breast and Parmesan."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 390,
      "proteinGrams": 38,
      "carbsGrams": 39,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 11
  },
  {
    "key": "meals_chicken_pink_sauce_pasta",
    "categoryKey": "meals",
    "name": {
      "ar": "باستا بنك صوص دجاج",
      "en": "Chicken Pink Sauce Pasta"
    },
    "description": {
      "ar": "معكرونة بينا بالصوص الوردي مع صدور الدجاج.",
      "en": "Penne pasta with a creamy tomato pink sauce and chicken breast."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 420,
      "proteinGrams": 39,
      "carbsGrams": 41,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 12
  },
  {
    "key": "meals_saleeg",
    "categoryKey": "meals",
    "name": {
      "ar": "سليق",
      "en": "Saleeg"
    },
    "description": {
      "ar": "أرز أبيض مطهو بمرق اللحم مع قطعة لحم بقري.",
      "en": "Traditional white rice cooked in meat broth and served with beef."
    },
    "priceHalala": 3500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 420,
      "proteinGrams": 38,
      "carbsGrams": 36,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 13
  },
  {
    "key": "meals_indian_kebab",
    "categoryKey": "meals",
    "name": {
      "ar": "كباب هندي",
      "en": "Indian Kebab"
    },
    "description": {
      "ar": "لحم مفروم وفلفل رومي وصلصة طماطم يقدم مع الأرز.",
      "en": "Seasoned minced beef with bell peppers and tomato sauce, served with rice."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 430,
      "proteinGrams": 38,
      "carbsGrams": 38,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 14
  },
  {
    "key": "meals_meat_kabsa",
    "categoryKey": "meals",
    "name": {
      "ar": "كبسة لحم",
      "en": "Meat Kabsa"
    },
    "description": {
      "ar": "كبسة سعودية باللحم البقري والأرز والبهارات.",
      "en": "Saudi-style kabsa with beef, rice, tomato and aromatic spices."
    },
    "priceHalala": 3500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 430,
      "proteinGrams": 38,
      "carbsGrams": 39,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 15
  },
  {
    "key": "meals_chicken_kabsa",
    "categoryKey": "meals",
    "name": {
      "ar": "كبسة دجاج",
      "en": "Chicken Kabsa"
    },
    "description": {
      "ar": "كبسة دجاج بصدور الدجاج والأرز والبهارات.",
      "en": "Light chicken kabsa with chicken breast, rice, tomato and spices."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 380,
      "proteinGrams": 44,
      "carbsGrams": 39,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 16
  },
  {
    "key": "meals_dawood_basha_kofta",
    "categoryKey": "meals",
    "name": {
      "ar": "كفتة داوود باشا",
      "en": "Dawood Basha Kofta"
    },
    "description": {
      "ar": "كرات كفتة بصلصة الطماطم مع الأرز الأبيض.",
      "en": "Seasoned kofta meatballs in fresh tomato sauce with white rice."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 410,
      "proteinGrams": 38,
      "carbsGrams": 39,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 17
  },
  {
    "key": "meals_beef_and_potato_bake",
    "categoryKey": "meals",
    "name": {
      "ar": "بطاطس باللحمة",
      "en": "Beef and Potato Bake"
    },
    "description": {
      "ar": "صينية لحم مع البطاطس بالفرن والأرز وصلصة الطماطم.",
      "en": "Oven-baked beef and potatoes with rice and tomato sauce."
    },
    "priceHalala": 3500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 410,
      "proteinGrams": 40,
      "carbsGrams": 39,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 18
  },
  {
    "key": "meals_150g_beef_steak_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة ستيك لحم 150 جرام",
      "en": "150g Beef Steak Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 3900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 270,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 19
  },
  {
    "key": "meals_100g_creamy_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج كريمة 100 جرام",
      "en": "100g Creamy Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 240,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 20
  },
  {
    "key": "meals_100g_spicy_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج سبايسي 100 جرام",
      "en": "100g Spicy Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 220,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 21
  },
  {
    "key": "meals_100g_italian_herb_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج توابل إيطالية 100 جرام",
      "en": "100g Italian Herb Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 22
  },
  {
    "key": "meals_100g_chicken_tikka_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج تكا 100 جرام",
      "en": "100g Chicken Tikka Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 23
  },
  {
    "key": "meals_100g_asian_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج آسيوي 100 جرام",
      "en": "100g Asian Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 220,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 24
  },
  {
    "key": "meals_100g_grilled_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج مشوي 100 جرام",
      "en": "100g Grilled Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 175,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 25
  },
  {
    "key": "meals_100g_mexican_chicken_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج مكسيكي 100 جرام",
      "en": "100g Mexican Chicken Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 26
  },
  {
    "key": "meals_100g_beef_stroganoff_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة لحم استرغانوف 100 جرام",
      "en": "100g Beef Stroganoff Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 2200,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 250,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 27
  },
  {
    "key": "meals_100g_chicken_fajita_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة دجاج فاهيتا 100 جرام",
      "en": "100g Chicken Fajita Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 28
  },
  {
    "key": "meals_100g_shrimp_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة جمبري 100 جرام",
      "en": "100g Shrimp Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 3900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 380,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 29
  },
  {
    "key": "meals_100g_fish_fillet_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة سمك فيليه 100 جرام",
      "en": "100g Fish Fillet Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 130,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 30
  },
  {
    "key": "meals_100g_salmon_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة سالمون 100 جرام",
      "en": "100g Salmon Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 3900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 31
  },
  {
    "key": "meals_100g_tuna_meal",
    "categoryKey": "meals",
    "name": {
      "ar": "وجبة تونا 100 جرام",
      "en": "100g Tuna Meal"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 32
  },
  {
    "key": "meals_healthy_beef_burger",
    "categoryKey": "meals",
    "name": {
      "ar": "برجر لحم صحي",
      "en": "Healthy Beef Burger"
    },
    "description": {
      "ar": "برجر صحي بقطعة لحم داخل خبز القمح الكامل مع الخضار والجبن والصوصات الخفيفة.",
      "en": "A healthy beef burger in whole-wheat bread with vegetables, cheese and light sauces."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 420,
      "proteinGrams": 41,
      "carbsGrams": 34,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 33
  },
  {
    "key": "meals_chicken_65",
    "categoryKey": "meals",
    "name": {
      "ar": "دجاج 65",
      "en": "Chicken 65"
    },
    "description": {
      "ar": "قطع دجاج متبلة بتوابل حارة بطابع هندي.",
      "en": "Chicken pieces seasoned with spicy Indian-style spices."
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 260,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 34
  },
  {
    "key": "meals_bbq_chicken",
    "categoryKey": "meals",
    "name": {
      "ar": "دجاج باربكيو",
      "en": "BBQ Chicken"
    },
    "description": {
      "ar": "قطع دجاج مشوية مغطاة بصوص باربكيو مدخن خفيف.",
      "en": "Grilled chicken coated with a lightly smoked barbecue sauce."
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 270,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 35
  },
  {
    "key": "sandwiches_tuna_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش تونا",
      "en": "Tuna Sandwich"
    },
    "description": {
      "ar": "خبز حسب الاختيار مع خلطة تونة وصوص البيستو والورقيات.",
      "en": "Bread of your choice filled with tuna mix, pesto sauce and leafy greens."
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 310,
      "proteinGrams": 22,
      "carbsGrams": 32,
      "fatGrams": 5
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 1
  },
  {
    "key": "sandwiches_halloumi_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش حلومي",
      "en": "Halloumi Sandwich"
    },
    "description": {
      "ar": "جبنة حلوم مشوية مع صوص البيستو والخضار.",
      "en": "Grilled halloumi with pesto sauce and fresh vegetables."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 340,
      "proteinGrams": 21,
      "carbsGrams": 33,
      "fatGrams": 12
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 2
  },
  {
    "key": "sandwiches_turkey_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش تركي",
      "en": "Turkey Sandwich"
    },
    "description": {
      "ar": "شرائح ديك رومي مدخن مع صوص الرانش والخس والطماطم.",
      "en": "Smoked turkey slices with ranch sauce, lettuce and tomato."
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 310,
      "proteinGrams": 26,
      "carbsGrams": 33,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 3
  },
  {
    "key": "sandwiches_grilled_chicken_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش دجاج مشوي",
      "en": "Grilled Chicken Sandwich"
    },
    "description": {
      "ar": "دجاج مشوي مع صوص البيستو والورقيات.",
      "en": "Grilled chicken with pesto sauce and leafy greens."
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 350,
      "proteinGrams": 34,
      "carbsGrams": 33,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 4
  },
  {
    "key": "sandwiches_beef_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش لحم",
      "en": "Beef Sandwich"
    },
    "description": {
      "ar": "شرائح لحم بقري مع صوص الرانش.",
      "en": "Beef slices served with ranch sauce in bread of your choice."
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 360,
      "proteinGrams": 29,
      "carbsGrams": 33,
      "fatGrams": 9
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 5
  },
  {
    "key": "sandwiches_liver_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش كبدة",
      "en": "Liver Sandwich"
    },
    "description": {
      "ar": "كبدة مع صوص الطحينة وخبز حسب الاختيار.",
      "en": "Seasoned liver with tahini sauce in bread of your choice."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 350,
      "proteinGrams": 29,
      "carbsGrams": 34,
      "fatGrams": 11
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 6
  },
  {
    "key": "sandwiches_boiled_egg_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش بيض مسلوق",
      "en": "Boiled Egg Sandwich"
    },
    "description": {
      "ar": "بيض مسلوق مع صوص البيستو والخس.",
      "en": "Boiled eggs with pesto sauce and lettuce."
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 365,
      "proteinGrams": 23,
      "carbsGrams": 34,
      "fatGrams": 15
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 7
  },
  {
    "key": "sandwiches_labneh_and_vegetable_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش لبنة بالخضار",
      "en": "Labneh and Vegetable Sandwich"
    },
    "description": {
      "ar": "لبنة مع الزيتون والفلفل والطماطم الكرزية.",
      "en": "Labneh with olives, peppers and cherry tomatoes."
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": 230,
      "proteinGrams": 11,
      "carbsGrams": 34,
      "fatGrams": 6
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 8
  },
  {
    "key": "sandwiches_build_your_own_sandwich",
    "categoryKey": "sandwiches",
    "name": {
      "ar": "ساندويش على مزاجك",
      "en": "Build Your Own Sandwich"
    },
    "description": {
      "ar": "خيار يسمح لك بتكوين ساندويشك المفضل حسب المكونات المتاحة.",
      "en": "Build your preferred sandwich using the available ingredients."
    },
    "priceHalala": 2100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Builder Setup",
    "notes": "Define bread, protein, sauce, vegetables, min/max selections.; Missing: calories, macros",
    "sortOrder": 9
  },
  {
    "key": "salads_chicken_leafy_greens_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الورقيات بالدجاج | حجم كبير",
      "en": "Chicken Leafy Greens Salad | Large"
    },
    "description": {
      "ar": "سلطة ورقيات مع الشمندر والأفوكادو والدجاج وصوص البلسميك.",
      "en": "Leafy greens with beetroot, avocado, chicken and balsamic dressing."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 280,
      "proteinGrams": 40,
      "carbsGrams": 12,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 1
  },
  {
    "key": "salads_arugula_and_beetroot_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الجرجير مع الشمندر | حجم كبير",
      "en": "Arugula and Beetroot Salad | Large"
    },
    "description": {
      "ar": "جرجير وشمندر ورمان وجبن فيتا وعين جمل.",
      "en": "Arugula and beetroot with pomegranate, feta cheese and walnuts."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 440,
      "proteinGrams": 40,
      "carbsGrams": 32,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 2
  },
  {
    "key": "salads_arugula_and_beetroot_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الجرجير مع الشمندر | حجم صغير",
      "en": "Arugula and Beetroot Salad | Small"
    },
    "description": {
      "ar": "جرجير وشمندر ورمان وجبن فيتا وعين جمل.",
      "en": "Arugula and beetroot with pomegranate, feta cheese and walnuts."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 220,
      "proteinGrams": 20,
      "carbsGrams": 16,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 3
  },
  {
    "key": "salads_tuna_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة التونا | حجم كبير",
      "en": "Tuna Salad | Large"
    },
    "description": {
      "ar": "تونة وخضار وصوص ليمون.",
      "en": "Tuna with mixed vegetables and lemon dressing."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 400,
      "proteinGrams": 44,
      "carbsGrams": 22,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 4
  },
  {
    "key": "salads_tuna_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة التونا | حجم صغير",
      "en": "Tuna Salad | Small"
    },
    "description": {
      "ar": "تونة وخضار وصوص ليمون.",
      "en": "Tuna with mixed vegetables and lemon dressing."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": 22,
      "carbsGrams": 11,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 5
  },
  {
    "key": "salads_golden_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الجولدن | حجم كبير",
      "en": "Golden Salad | Large"
    },
    "description": {
      "ar": "مجففات ودجاج مشوي وصوص خردل وعسل.",
      "en": "A sweet-and-savory salad with dried fruit, grilled chicken and honey-mustard dressing."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 420,
      "proteinGrams": 42,
      "carbsGrams": 56,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 6
  },
  {
    "key": "salads_golden_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الجولدن | حجم صغير",
      "en": "Golden Salad | Small"
    },
    "description": {
      "ar": "مجففات ودجاج مشوي وصوص خردل وعسل.",
      "en": "A sweet-and-savory salad with dried fruit, grilled chicken and honey-mustard dressing."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": 21,
      "carbsGrams": 28,
      "fatGrams": 2
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 7
  },
  {
    "key": "salads_greek_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة يونانية | حجم كبير",
      "en": "Greek Salad | Large"
    },
    "description": {
      "ar": "جبنة فيتا ودجاج مشوي وخضار طازجة.",
      "en": "A Greek-style salad with feta cheese, grilled chicken and fresh vegetables."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 480,
      "proteinGrams": 40,
      "carbsGrams": 12,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 8
  },
  {
    "key": "salads_greek_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة يونانية | حجم صغير",
      "en": "Greek Salad | Small"
    },
    "description": {
      "ar": "جبنة فيتا ودجاج مشوي وخضار طازجة.",
      "en": "A Greek-style salad with feta cheese, grilled chicken and fresh vegetables."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 240,
      "proteinGrams": 20,
      "carbsGrams": 6,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 9
  },
  {
    "key": "salads_build_your_own_salad_100g_protein",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة على مزاجك – 100 جرام بروتين",
      "en": "Build Your Own Salad – 100g Protein"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 2900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": true,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Builder Setup",
    "notes": "Define proteins, greens, toppings, sauces and selection limits.; Missing: description, calories, macros",
    "sortOrder": 10
  },
  {
    "key": "salads_chicken_leafy_greens_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة الورقيات بالدجاج | حجم صغير",
      "en": "Chicken Leafy Greens Salad | Small"
    },
    "description": {
      "ar": "سلطة ورقيات مع الشمندر والأفوكادو والدجاج وصوص البلسميك.",
      "en": "Leafy greens with beetroot, avocado, chicken and balsamic dressing."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 140,
      "proteinGrams": 20,
      "carbsGrams": 6,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 11
  },
  {
    "key": "salads_chicken_pasta_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة باستا بالدجاج | حجم كبير",
      "en": "Chicken Pasta Salad | Large"
    },
    "description": {
      "ar": "معكرونة ودجاج مشوي وخضروات وصوص بيستو.",
      "en": "Pasta salad with grilled chicken, vegetables and pesto dressing."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 480,
      "proteinGrams": 40,
      "carbsGrams": 46,
      "fatGrams": 8
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 12
  },
  {
    "key": "salads_chicken_pasta_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة باستا بالدجاج | حجم صغير",
      "en": "Chicken Pasta Salad | Small"
    },
    "description": {
      "ar": "معكرونة ودجاج مشوي وخضروات وصوص بيستو.",
      "en": "Pasta salad with grilled chicken, vegetables and pesto dressing."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 240,
      "proteinGrams": 20,
      "carbsGrams": 23,
      "fatGrams": 4
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 13
  },
  {
    "key": "salads_chicken_caesar_salad_large",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة سيزر بالدجاج | حجم كبير",
      "en": "Chicken Caesar Salad | Large"
    },
    "description": {
      "ar": "دجاج مشوي وخبز محمص وصوص سيزر.",
      "en": "Classic Caesar salad with grilled chicken, croutons and Caesar dressing."
    },
    "priceHalala": 2500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 415,
      "proteinGrams": 40,
      "carbsGrams": 30,
      "fatGrams": 10
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 14
  },
  {
    "key": "salads_chicken_caesar_salad_small",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة سيزر بالدجاج | حجم صغير",
      "en": "Chicken Caesar Salad | Small"
    },
    "description": {
      "ar": "دجاج مشوي وخبز محمص وصوص سيزر.",
      "en": "Classic Caesar salad with grilled chicken, croutons and Caesar dressing."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 210,
      "proteinGrams": 20,
      "carbsGrams": 15,
      "fatGrams": 5
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 15
  },
  {
    "key": "salads_green_salad",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة خضراء",
      "en": "Green Salad"
    },
    "description": {
      "ar": "سلطة خضراء كلاسيكية.",
      "en": "A simple classic green salad."
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 60,
      "proteinGrams": 2,
      "carbsGrams": 9,
      "fatGrams": 3
    },
    "status": "Ready",
    "notes": "",
    "sortOrder": 16
  },
  {
    "key": "salads_fruit_salad_150g",
    "categoryKey": "salads",
    "name": {
      "ar": "سلطة فواكه – 150 جرام",
      "en": "Fruit Salad – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 17
  },
  {
    "key": "carbs_white_rice_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "رز أبيض من 150 جرام",
      "en": "White Rice – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 190,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 1
  },
  {
    "key": "carbs_turmeric_rice_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "رز بالكركم من 150 جرام",
      "en": "Turmeric Rice – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 2
  },
  {
    "key": "carbs_alfredo_pasta_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "باستا ألفريدو 150 جرام",
      "en": "Alfredo Pasta – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 300,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 3
  },
  {
    "key": "carbs_red_sauce_pasta_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "باستا صوص أحمر 150 جرام",
      "en": "Red Sauce Pasta – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 180,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 4
  },
  {
    "key": "carbs_roasted_potatoes_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "بطاطا مشوية 150 جرام",
      "en": "Roasted Potatoes – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 120,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Arabic source says بطاطا; confirm whether regular potato or sweet potato.; Missing: description, macros",
    "sortOrder": 5
  },
  {
    "key": "carbs_sweet_potatoes_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "بطاطا حلوة 150 جرام",
      "en": "Sweet Potatoes – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 120,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 6
  },
  {
    "key": "carbs_grilled_mixed_vegetables_150g",
    "categoryKey": "carbs",
    "name": {
      "ar": "خضار مشكلة مشوية 150 جرام",
      "en": "Grilled Mixed Vegetables – 150g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 87,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 7
  },
  {
    "key": "greek_yogurt_greek_yogurt_200g",
    "categoryKey": "greek_yogurt",
    "name": {
      "ar": "زبادي يوناني - 200 جرام",
      "en": "Greek Yogurt – 200g"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 1
  },
  {
    "key": "desserts_orange_cake",
    "categoryKey": "desserts",
    "name": {
      "ar": "كيكة البرتقال",
      "en": "Orange Cake"
    },
    "description": {
      "ar": "كيكة برتقال صحية بمكونات خفيفة وبدون سكر.",
      "en": "A light, healthy orange cake with natural orange flavor and no added sugar."
    },
    "priceHalala": 900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 100,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Nutrition",
    "notes": "Missing: macros",
    "sortOrder": 1
  },
  {
    "key": "desserts_apple_cinnamon_muffins_2_pieces",
    "categoryKey": "desserts",
    "name": {
      "ar": "مافن التفاح بالقرفة قطعتين",
      "en": "Apple Cinnamon Muffins (2 Pieces)"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1200,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 300,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 2
  },
  {
    "key": "desserts_berry_cheesecake",
    "categoryKey": "desserts",
    "name": {
      "ar": "تشيز كيك بالتوت",
      "en": "Berry Cheesecake"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 350,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 3
  },
  {
    "key": "desserts_strawberry_cheesecake",
    "categoryKey": "desserts",
    "name": {
      "ar": "تشيز كيك بالفراولة",
      "en": "Strawberry Cheesecake"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 340,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 4
  },
  {
    "key": "desserts_dark_brownies",
    "categoryKey": "desserts",
    "name": {
      "ar": "براونيز داكن",
      "en": "Dark Brownies"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 360,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 5
  },
  {
    "key": "desserts_protein_bar",
    "categoryKey": "desserts",
    "name": {
      "ar": "بروتين بار",
      "en": "Protein Bar"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1500,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 220,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 6
  },
  {
    "key": "desserts_classic_biscuit",
    "categoryKey": "desserts",
    "name": {
      "ar": "بيسك كلاسيك",
      "en": "Classic Biscuit"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1400,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 310,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Confirm the intended English commercial name for بيسك كلاسيك.; Missing: description, macros",
    "sortOrder": 7
  },
  {
    "key": "desserts_chocolate_protein_cake",
    "categoryKey": "desserts",
    "name": {
      "ar": "كيك شوكولاتة بروتين",
      "en": "Chocolate Protein Cake"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 320,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 8
  },
  {
    "key": "ice_cream_vanilla_ice_cream",
    "categoryKey": "ice_cream",
    "name": {
      "ar": "آيس كريم فانيليا",
      "en": "Vanilla Ice Cream"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 1
  },
  {
    "key": "ice_cream_chocolate_ice_cream",
    "categoryKey": "ice_cream",
    "name": {
      "ar": "آيس كريم شوكولاتة",
      "en": "Chocolate Ice Cream"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 2
  },
  {
    "key": "ice_cream_ice_cream_add_on",
    "categoryKey": "ice_cream",
    "name": {
      "ar": "إضافة آيس كريم",
      "en": "Ice Cream Add-on"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 700,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Clarification",
    "notes": "May be an add-on rather than a standalone product.; Missing: description, calories, macros",
    "sortOrder": 3
  },
  {
    "key": "juices_berry_blast",
    "categoryKey": "juices",
    "name": {
      "ar": "بيري بلاست",
      "en": "Berry Blast"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 150,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 1
  },
  {
    "key": "juices_berry_protein",
    "categoryKey": "juices",
    "name": {
      "ar": "بيري بروت",
      "en": "Berry Protein"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 2
  },
  {
    "key": "juices_classic_green",
    "categoryKey": "juices",
    "name": {
      "ar": "كلاسيك جرين",
      "en": "Classic Green"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 120,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 3
  },
  {
    "key": "juices_beet_punch",
    "categoryKey": "juices",
    "name": {
      "ar": "بيت بنش",
      "en": "Beet Punch"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 140,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "English name inferred from بيت بنش; please confirm.; Missing: description, macros",
    "sortOrder": 4
  },
  {
    "key": "juices_orange_and_carrot",
    "categoryKey": "juices",
    "name": {
      "ar": "برتقال وجزر",
      "en": "Orange and Carrot"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 130,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 5
  },
  {
    "key": "juices_watermelon_with_mint",
    "categoryKey": "juices",
    "name": {
      "ar": "بطيخ بالنعناع",
      "en": "Watermelon with Mint"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1100,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 100,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 6
  },
  {
    "key": "drinks_protein_drink",
    "categoryKey": "drinks",
    "name": {
      "ar": "مشروب بروتين",
      "en": "Protein Drink"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 1900,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 200,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 1
  },
  {
    "key": "drinks_diet_iced_tea",
    "categoryKey": "drinks",
    "name": {
      "ar": "آيس تي دايت",
      "en": "Diet Iced Tea"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 400,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": 5,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, macros",
    "sortOrder": 2
  },
  {
    "key": "drinks_diet_soda",
    "categoryKey": "drinks",
    "name": {
      "ar": "صودا دايت",
      "en": "Diet Soda"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 300,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 3
  },
  {
    "key": "drinks_still_water",
    "categoryKey": "drinks",
    "name": {
      "ar": "مياه عادية",
      "en": "Still Water"
    },
    "description": {
      "ar": "",
      "en": ""
    },
    "priceHalala": 200,
    "pricingModel": "fixed",
    "currency": "SAR",
    "isCustomizable": false,
    "nutrition": {
      "calories": null,
      "proteinGrams": null,
      "carbsGrams": null,
      "fatGrams": null
    },
    "status": "Needs Description",
    "notes": "Missing: description, calories, macros",
    "sortOrder": 4
  }
];

module.exports = { categories, products };
