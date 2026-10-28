/** Basic Diet meal builder presentation options (2026-10-28).
 * Customer-requested shortlist; this is a website preview, not an API menu,
 * live inventory, recipe declaration, pricing or order submission.
 * Missing photographs use clearly labeled illustrations.
 */
export const mealProteinGroups = [
  {
    "key": "all",
    "label": "الكل"
  },
  {
    "key": "chicken",
    "label": "الدجاج"
  },
  {
    "key": "beef",
    "label": "اللحم"
  },
  {
    "key": "fish",
    "label": "السمك"
  }
] as const;

export const mealProteinChoices = [
  {
    "name": "دجاج مشوي",
    "group": "chicken",
    "image": "/api/meal-image?id=1fw69ZcOyMtusTGj9Cx1tVfvpf6ZyJNAu"
  },
  {
    "name": "دجاج كريمة",
    "group": "chicken",
    "image": "/api/meal-image?id=1sWQhsJSvuiu016TMwfx-QMwBjpGVHGxs"
  },
  {
    "name": "دجاج مشروم",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج مكسيكي",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج باربكيو",
    "group": "chicken",
    "image": "/api/meal-image?id=1zmxsFVYROw1_3cTpaXKV2GDxX-lHzofQ"
  },
  {
    "name": "دجاج استربس",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج ملوخية",
    "group": "chicken",
    "image": "/api/meal-image?id=1Xn_zM9vUEmYx_BNcJOIyRLpGhbyaKz7i"
  },
  {
    "name": "دجاج هاني مسترد",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج سبايسي",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج بالروزماري",
    "group": "chicken",
    "image": null
  },
  {
    "name": "دجاج شيش",
    "group": "chicken",
    "image": null
  },
  {
    "name": "لحم مشروم",
    "group": "beef",
    "image": null
  },
  {
    "name": "لحم كفتة كباب",
    "group": "beef",
    "image": null
  },
  {
    "name": "لحم مفروم",
    "group": "beef",
    "image": null
  },
  {
    "name": "سمك مشوي",
    "group": "fish",
    "image": "/api/meal-image?id=1POU5X9gYEz1ohchifjwDVbCR_jTnJ7Bg"
  },
  {
    "name": "سمك كريمي",
    "group": "fish",
    "image": null
  }
] as const;
export const mealSideChoices = [
  {
    "name": "بطاطس مشوي",
    "image": "/api/meal-image?id=1Yee9VzPNT76BYe8BwTWrxjsq1Y6qZoBl"
  },
  {
    "name": "بطاطس مهروسة",
    "image": null
  },
  {
    "name": "بطاطا حلوة",
    "image": "/menu-images/builder_sweet_potato.webp"
  },
  {
    "name": "خضار مشكل مشوي",
    "image": null
  },
  {
    "name": "رز مصري بالشعيرية",
    "image": null
  },
  {
    "name": "رز أبيض",
    "image": "/api/meal-image?id=1J0uWPLXV7sTiQEfZzAf0W0WK_HrYpt5O"
  },
  {
    "name": "رز صيني معجن",
    "image": null
  },
  {
    "name": "باستا بالكريمة",
    "image": "/api/meal-image?id=1JR-lQhqRwbwjB9p7nk2n6LNBBiAW1Dne"
  },
  {
    "name": "باستا بالصلصة الحمراء",
    "image": "/api/meal-image?id=1O54P_hDBopu9POcVVB6XEOYeNdLiYFR5"
  }
] as const;
