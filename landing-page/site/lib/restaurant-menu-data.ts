export type RestaurantMenuItem = {
  id: string;
  category: "الدجاج" | "الساندوتشات" | "الأسماك واللحوم" | "الكارب";
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
    "name": "تونا",
    "price": 13,
    "calories": 310,
    "image": "/restaurant-menu/sandwich_2.jpg"
  },
  {
    "id": "restaurant-18",
    "category": "الساندوتشات",
    "name": "بيض اسكرامبل",
    "price": 13,
    "calories": 280,
    "image": "/restaurant-menu/sandwich_3.jpg"
  },
  {
    "id": "restaurant-19",
    "category": "الساندوتشات",
    "name": "بيض مسلوق",
    "price": 11,
    "calories": 365,
    "image": "/restaurant-menu/sandwich_4.jpg"
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
    "name": "ساندوتش تركي",
    "illustrative": true,
    "price": 13,
    "calories": 310,
    "image": "/restaurant-menu/sandwich_new_turkey.jpg"
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
    "image": "/restaurant-menu/carb_right_3.jpg"
  },
  {
    "id": "restaurant-32",
    "category": "الكارب",
    "name": "مكرونة بيستو",
    "price": 7,
    "calories": 380,
    "image": "/restaurant-menu/carb_right_4.jpg"
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
    "image": "/restaurant-menu/carb_left_1.jpg"
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
  }
];
