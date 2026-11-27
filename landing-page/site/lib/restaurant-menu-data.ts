export type RestaurantMenuItem = {
  id: string;
  category: "الدجاج" | "الساندوتشات" | "الأسماك واللحوم" | "الكارب" | "الحلويات";
  nameEn?: string;
  descriptionAr?: string;
  descriptionEn?: string;
  proteinGrams?: number;
  allergens?: string;
  featured?: boolean;
  name: string;
  price: number;
  calories: number;
  image: string;
  illustrative?: boolean;
};

/**
 * Restaurant A4 printed menu, approved on 2026-11-12.
 * This catalogue is intentionally separate from the POS/app/subscription catalogue.
 * Calorie estimates are indicative and need verification against kitchen recipes.
 */
export const restaurantMenuItems: RestaurantMenuItem[] = [
  {
    "id": "restaurant-01",
    "category": "الدجاج",
    "name": "دجاج باربكيو",
    "price": 20,
    "calories": 270,
    "image": "/restaurant-menu/chicken_1.jpg"
  },
  {
    "id": "restaurant-02",
    "category": "الدجاج",
    "name": "دجاج هاني ماسترد",
    "price": 20,
    "calories": 250,
    "image": "/restaurant-menu/chicken_2.jpg"
  },
  {
    "id": "restaurant-03",
    "category": "الدجاج",
    "name": "دجاج زبدة",
    "price": 20,
    "calories": 220,
    "image": "/restaurant-menu/chicken_3.jpg"
  },
  {
    "id": "restaurant-04",
    "category": "الدجاج",
    "name": "دجاج ليمون",
    "price": 20,
    "calories": 190,
    "image": "/restaurant-menu/chicken_4.jpg"
  },
  {
    "id": "restaurant-05",
    "category": "الدجاج",
    "name": "دجاج مكسيكي",
    "price": 20,
    "calories": 210,
    "image": "/restaurant-menu/chicken_5.jpg"
  },
  {
    "id": "restaurant-06",
    "category": "الدجاج",
    "name": "دجاج مشوي",
    "price": 20,
    "calories": 175,
    "image": "/restaurant-menu/chicken_6.jpg"
  },
  {
    "id": "restaurant-07",
    "category": "الدجاج",
    "name": "دجاج مشروم",
    "price": 20,
    "calories": 230,
    "image": "/restaurant-menu/chicken_7.jpg"
  },
  {
    "id": "restaurant-08",
    "category": "الدجاج",
    "name": "دجاج كريمة",
    "price": 20,
    "calories": 240,
    "image": "/restaurant-menu/chicken_8.jpg"
  },
  {
    "id": "restaurant-09",
    "category": "الدجاج",
    "name": "ستربس",
    "price": 20,
    "calories": 250,
    "image": "/restaurant-menu/chicken_9.jpg"
  },
  {
    "id": "restaurant-10",
    "category": "الدجاج",
    "name": "شيش طاووق",
    "price": 20,
    "calories": 240,
    "image": "/restaurant-menu/chicken_10.jpg"
  },
  {
    "id": "restaurant-11",
    "category": "الدجاج",
    "name": "دجاج بامية",
    "price": 20,
    "calories": 190,
    "image": "/restaurant-menu/chicken_11.jpg"
  },
  {
    "id": "restaurant-12",
    "category": "الدجاج",
    "name": "دجاج 65",
    "price": 20,
    "calories": 260,
    "image": "/restaurant-menu/chicken_12.jpg"
  },
  {
    "id": "restaurant-13",
    "category": "الدجاج",
    "name": "دجاج تكا",
    "price": 20,
    "calories": 190,
    "image": "/restaurant-menu/chicken_13.jpg"
  },
  {
    "id": "restaurant-14",
    "category": "الدجاج",
    "name": "دجاج بالملوخية",
    "price": 20,
    "calories": 210,
    "image": "/restaurant-menu/chicken_14.jpg"
  },
  {
    "id": "restaurant-15",
    "category": "الدجاج",
    "name": "دجاج زعتر",
    "illustrative": true,
    "price": 20,
    "calories": 195,
    "image": "/restaurant-menu/chicken_15.jpg"
  },
  {
    "id": "restaurant-16",
    "category": "الساندوتشات",
    "name": "حلوم كلاسيك",
    "price": 15,
    "calories": 340,
    "image": "/restaurant-menu/sandwich_1.jpg"
  },
  {
    "id": "restaurant-17",
    "category": "الساندوتشات",
    "name": "كلوب تونة",
    "nameEn": "Tuna Club",
    "descriptionAr": "كلوب ساندويتش بالحبوب الكاملة بحشوة التونة والصوص الخاص الصحي",
    "descriptionEn": "Whole-grain club sandwich filled with tuna and our special healthy sauce.",
    "price": 13,
    "calories": 290,
    "proteinGrams": 26,
    "allergens": "الأسماك، الحبوب (الجلوتين)",
    "image": "/api/meal-image?id=1MFxMxeMJ5fvo58QbsVZW9QC6X_XJ4x38",
    "featured": true
  },
  {
    "id": "restaurant-18",
    "category": "الساندوتشات",
    "name": "كلوب بيض اسكرامبل",
    "nameEn": "Scrambled Egg Club",
    "descriptionAr": "كلوب بخبز الحبوب الكاملة محشو ببيض اسكرامبل طري وصوص خفيف، وجبة مشبعة وغنية بالبروتين.",
    "descriptionEn": "Whole-grain club sandwich filled with soft scrambled eggs and a light sauce. A filling, high-protein meal.",
    "price": 9,
    "calories": 380,
    "proteinGrams": 20,
    "allergens": "البيض، الحبوب (الجلوتين)",
    "image": "/api/meal-image?id=1mg7uyD1O50fZiU1tOe3Ux6Yu2Oyoc1ze",
    "featured": true
  },
  {
    "id": "restaurant-19",
    "category": "الساندوتشات",
    "name": "كلوب بيض مسلوق وبيستو",
    "nameEn": "Boiled Egg & Pesto Club",
    "descriptionAr": "كلوب بخبز الحبوب الكاملة مع بيض مسلوق وطماطم وخس وصوص بيستو وصوص أبيض خفيف، وجبة مشبعة ومتوازنة.",
    "descriptionEn": "Whole-grain club sandwich with boiled egg, tomato, lettuce, pesto and a light white sauce. A filling, balanced meal.",
    "price": 9,
    "calories": 390,
    "proteinGrams": 18,
    "allergens": "الحليب، البيض، المكسرات (من البيستو)، الحبوب",
    "image": "/api/meal-image?id=12f5VpHuCu9_LVKfvJ350wej5SrSl6bYX",
    "featured": true
  },
  {
    "id": "restaurant-20",
    "category": "الساندوتشات",
    "name": "برجر لحم",
    "price": 23,
    "calories": 420,
    "image": "/restaurant-menu/sandwich_6.jpg"
  },
  {
    "id": "restaurant-21",
    "category": "الساندوتشات",
    "name": "كلوب تركي",
    "nameEn": "Turkey Club",
    "descriptionAr": "كلوب بخبز الحبوب الكاملة مع شرائح تركي وطماطم وخس وصوص خفيف، وجبة خفيفة وغنية بالبروتين.",
    "descriptionEn": "Whole-grain club sandwich with sliced turkey, tomato, lettuce and a light sauce. A light, high-protein meal.",
    "price": 13,
    "calories": 310,
    "proteinGrams": 22,
    "allergens": "الحبوب (الجلوتين) فقط",
    "image": "/api/meal-image?id=1hJltj99qSFwFmYLKo9jK2-FtvvUb652u",
    "featured": true
  },
  {
    "id": "restaurant-22",
    "category": "الساندوتشات",
    "name": "بيض بالتركي",
    "illustrative": true,
    "price": 13,
    "calories": 370,
    "image": "/restaurant-menu/sandwich_new_turkeyegg.jpg"
  },
  {
    "id": "restaurant-23",
    "category": "الساندوتشات",
    "name": "ساندوتش دجاج مشوي",
    "price": 13,
    "calories": 340,
    "image": "/restaurant-menu/sandwich_new_grilled.jpg"
  },
  {
    "id": "restaurant-24",
    "category": "الساندوتشات",
    "name": "ساندوتش دجاج مكسيكي",
    "illustrative": true,
    "price": 13,
    "calories": 370,
    "image": "/restaurant-menu/sandwich_new_mexican.jpg"
  },
  {
    "id": "restaurant-25",
    "category": "الأسماك واللحوم",
    "name": "لحم استراغنوف",
    "price": 22,
    "calories": 250,
    "image": "/restaurant-menu/fish_1.jpg"
  },
  {
    "id": "restaurant-26",
    "category": "الأسماك واللحوم",
    "name": "كباب لحم",
    "price": 22,
    "calories": 270,
    "image": "/restaurant-menu/fish_2.jpg"
  },
  {
    "id": "restaurant-27",
    "category": "الأسماك واللحوم",
    "name": "سمك مشوي",
    "price": 20,
    "calories": 150,
    "image": "/restaurant-menu/fish_3.jpg"
  },
  {
    "id": "restaurant-28",
    "category": "الأسماك واللحوم",
    "name": "سمك كريمة",
    "price": 20,
    "calories": 190,
    "image": "/restaurant-menu/fish_4.jpg"
  },
  {
    "id": "restaurant-38",
    "category": "الأسماك واللحوم",
    "name": "لحم مفروم",
    "price": 22,
    "calories": 250,
    "image": "/api/meal-image?id=1VrtZmwaQaSkmVAw3iyGYpcOYbOCvQzcK",
    "illustrative": true
  },
  {
    "id": "restaurant-39",
    "category": "الأسماك واللحوم",
    "name": "لحم مشروم",
    "price": 22,
    "calories": 240,
    "image": "/api/meal-image?id=1_-GVEqxtZtww4VnHJGojzoULSJf5cTF4",
    "illustrative": true
  },
  {
    "id": "restaurant-29",
    "category": "الكارب",
    "name": "رز أبيض بسمتي",
    "price": 7,
    "calories": 190,
    "image": "/restaurant-menu/carb_right_1.jpg"
  },
  {
    "id": "restaurant-30",
    "category": "الكارب",
    "name": "رز أبيض آسيوي",
    "price": 7,
    "calories": 200,
    "image": "/restaurant-menu/carb_right_2.jpg"
  },
  {
    "id": "restaurant-31",
    "category": "الكارب",
    "name": "رز بخاري",
    "price": 7,
    "calories": 240,
    "image": "/restaurant-menu/10-carb_right_3.jpg"
  },
  {
    "id": "restaurant-32",
    "category": "الكارب",
    "name": "مكرونة بيستو",
    "price": 7,
    "calories": 380,
    "image": "/restaurant-menu/11-carb_right_4.jpg"
  },
  {
    "id": "restaurant-33",
    "category": "الكارب",
    "name": "مكرونة ألفريدو",
    "price": 7,
    "calories": 340,
    "image": "/restaurant-menu/carb_right_5.jpg"
  },
  {
    "id": "restaurant-34",
    "category": "الكارب",
    "name": "بطاطس مهروسة",
    "price": 7,
    "calories": 150,
    "image": "/restaurant-menu/12-carb_left_1.jpg"
  },
  {
    "id": "restaurant-35",
    "category": "الكارب",
    "name": "بطاطس مشوي",
    "price": 7,
    "calories": 120,
    "image": "/restaurant-menu/carb_left_2.jpg"
  },
  {
    "id": "restaurant-36",
    "category": "الكارب",
    "name": "بطاطا حلوة",
    "price": 7,
    "calories": 120,
    "image": "/restaurant-menu/carb_left_3.jpg"
  },
  {
    "id": "restaurant-37",
    "category": "الكارب",
    "name": "خضار مشوي",
    "price": 7,
    "calories": 87,
    "image": "/restaurant-menu/carb_left_4.jpg"
  },
  {
    "id": "restaurant-40",
    "category": "الحلويات",
    "name": "عريكة صحية",
    "nameEn": "Healthy Areeka",
    "descriptionAr": "عريكة صحية سعرات اقل وطعم صحي ولذيذ بقشطة لايت بدون سكر مضاف",
    "descriptionEn": "Healthy areeka with fewer calories, made with light cream and no added sugar.",
    "price": 12,
    "calories": 380,
    "proteinGrams": 13,
    "allergens": "الحليب (الجبنة)، الحبوب",
    "image": "/api/meal-image?id=1lqAQ18ZB_3dmkFg1JUqu3K3GQ-71okzl",
    "featured": true
  }
];
