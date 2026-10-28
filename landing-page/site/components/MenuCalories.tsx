import { getMenuNutrition } from "@/lib/menu-nutrition";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function MenuCalories({ posId, detail = false }: { posId: string; detail?: boolean }) {
  const nutrition = getMenuNutrition(posId);
  if (!nutrition) {
    return <p className="menu-calories-missing">{detail ? "السعرات غير متوفرة لهذا الصنف أو الحجم حاليًا." : "السعرات غير متوفرة"}</p>;
  }
  return (
    <div className={"menu-calories" + (detail ? " menu-calories--detail" : "")} data-calories={nutrition.calories}>
      <span><b>{number.format(nutrition.calories)}</b> سعرة حرارية</span>
      <small>تقريبًا · {nutrition.portionLabel}</small>
    </div>
  );
}
