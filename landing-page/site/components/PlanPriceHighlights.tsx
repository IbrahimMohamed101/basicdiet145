import Link from "next/link";
import { formatSar, getPublicPlanPrices } from "@/lib/public-plan-prices";

export async function PlanPriceHighlights() {
  const plans = await getPublicPlanPrices();
  const examples = plans.flatMap(plan =>
    plan.gramsOptions.filter(option => option.grams === 150).flatMap(gram =>
      gram.mealsOptions.filter(option => option.mealsPerDay === 2).map(meal => ({
        days: plan.daysCount, price: meal.priceSar,
      }))
    )
  );
  return (
    <section aria-labelledby="public-prices-heading" className="py-12 md:py-16" style={{ background: "#f6f8f3", color: "#14382e" }}>
      <div className="page-shell">
        <p className="text-sm font-bold" style={{ color: "#108055" }}>أسعار الاشتراكات في جدة</p>
        <h2 id="public-prices-heading" className="mt-2 text-2xl font-extrabold md:text-3xl">
          قارن أسعار باقات بيسك دايت قبل التسجيل
        </h2>
        {examples.length ? (
          <>
            <p className="mt-3 text-sm leading-7">أمثلة لأسعار الباقات بحصة بروتين 150 جم ووجبتين يوميًا، من قائمة الاشتراكات الحالية:</p>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {examples.map(item => (
                <article key={item.days} className="rounded-2xl border bg-white p-5" style={{ borderColor: "#dbe8db" }}>
                  <h3 className="font-bold">باقة {item.days} {item.days === 7 ? "أيام" : "يومًا"}</h3>
                  <p className="mt-3 text-2xl font-extrabold" dir="auto">{formatSar(item.price)}</p>
                  <p className="mt-2 text-sm">150 جم · وجبتان يوميًا · قبل خصم التسجيل</p>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 leading-8">الأسعار تتحدد حسب المدة والجرامات وعدد الوجبات، وتظهر عند توفر قائمة الأسعار الحالية.</p>
        )}
        <p className="mt-4 text-sm leading-7">الأسعار الأساسية للباقة فقط؛ التوصيل والإضافات منفصلة. السعر النهائي وتطبيق خصم التسجيل 15% يخضعان للتحقق قبل إتمام الاشتراك.</p>
        <Link href="/jeddah/subscription-prices" className="mt-4 inline-flex min-h-11 items-center rounded-xl border px-5 py-3 font-bold underline underline-offset-4" style={{ borderColor: "#108055", color: "#108055" }}>
          شاهد أسعار ومدد الاشتراكات بالتفصيل
        </Link>
      </div>
    </section>
  );
}
