/** Real Arabic descriptions from the Basic_Diet_App_Menu snapshot (2026-10-24).
 * Show only on corresponding cashier POS items with verified name/price match.
 * Calorie/ingredient allergen claims must NOT be inferred from this text.
 * The nutrition-status column of that app snapshot says values were not visible
 * in the public API, so no kcal/macros are published from that source here.
 */
export type VerifiedItemDetail = {
  description: string;
  source: "app_menu_snapshot_2026_10_24";
};

export const verifiedMenuDetails: Record<string, VerifiedItemDetail> = {
  "204": { description: "طبق بيض مخفوق ناعم مجهز بكريمة الطبخ وجبن الشيدر الخفيف.", source: "app_menu_snapshot_2026_10_24" },
  "211": { description: "شكشوكة صحية مكونة من البيض المطهو مع الخضار الطازجة.", source: "app_menu_snapshot_2026_10_24" },
  "207": { description: "طبق حمص صافي ومهروس يقدم مع الطحينة وزيت الزيتون والليمون.", source: "app_menu_snapshot_2026_10_24" },
  "218": { description: "طبق جرانولا مقرمش يجمع بين المكسرات والشوفان والعسل والفواكه.", source: "app_menu_snapshot_2026_10_24" },
  "186": { description: "معكرونة بينا بالصوص الأبيض وصدور الدجاج الغنية بالبارميزان.", source: "app_menu_snapshot_2026_10_24" },
  "183": { description: "مسقعة صحية من الباذنجان والفلفل المشوي مع اللحم البقري المفروم وصلصة الطماطم.", source: "app_menu_snapshot_2026_10_24" },
  "185": { description: "كفتة لحم بقري مع صوص الطحينة والأرز الأبيض.", source: "app_menu_snapshot_2026_10_24" },
  "193": { description: "معكرونة فوتوتشيني مع صدور الدجاج وكريمة الطبخ وجبنة البارميزان.", source: "app_menu_snapshot_2026_10_24" },
  "187": { description: "معكرونة بينا بالصوص الوردي مع صدور الدجاج.", source: "app_menu_snapshot_2026_10_24" },
  "188": { description: "أرز أبيض مطهو بمرق اللحم مع قطعة لحم بقري.", source: "app_menu_snapshot_2026_10_24" },
  "195": { description: "برجر صحي بقطعة لحم داخل خبز القمح الكامل مع الخضار والجبن والصوصات الخفيفة.", source: "app_menu_snapshot_2026_10_24" },
  "180": { description: "جبنة فيتا ودجاج مشوي وخضار طازجة.", source: "app_menu_snapshot_2026_10_24" },
  "176": { description: "دجاج مشوي وخبز محمص وصوص سيزر.", source: "app_menu_snapshot_2026_10_24" },
};
