import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LeadDialog } from "@/components/LeadDialog";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { AppCta } from "@/components/AppCta";
import { formatSar, getPublicPlanPrices } from "@/lib/public-plan-prices";

export const metadata: Metadata = {
  title: "أسعار اشتراك وجبات دايت جدة | باقات 7 و26 و30 يومًا | بيسك دايت",
  description: "قارن أسعار اشتراكات الوجبات الصحية في جدة حسب مدة الباقة وحصة البروتين وعدد الوجبات يوميًا، واعرف الفرق بين التوصيل والاستلام وخصم التسجيل في بيسك دايت.",
  alternates: { canonical: "/jeddah/subscription-prices" },
  openGraph: { title: "أسعار باقات الوجبات الصحية في جدة | بيسك دايت", locale: "ar_SA", type: "website" },
};

// Always return server HTML from a current or 15-minute cached live price catalog.
export const dynamic = "force-dynamic";

export default async function SubscriptionPricesPage() {
  const plans = await getPublicPlanPrices();
  const rows = plans.flatMap(plan =>
    plan.gramsOptions.flatMap(gram =>
      gram.mealsOptions.map(meal => ({
        days: plan.daysCount, grams: gram.grams,
        meals: meal.mealsPerDay, price: meal.priceSar,
      }))
    )
  );
  const breadcrumb = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "بيسك دايت", item: "https://basicdietksa.com/" },
      { "@type": "ListItem", position: 2, name: "أسعار اشتراكات جدة", item: "https://basicdietksa.com/jeddah/subscription-prices" },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <AnalyticsTracker />
      <LeadDialog />
      <Header />
      <main dir="rtl" className="min-h-screen" style={{ background: "#f6f8f3", color: "#14382e" }}>
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-28 md:px-8 md:pt-40">
          <nav aria-label="مسار التنقل" className="text-sm">
            <Link href="/" className="underline">الرئيسية</Link> / <Link href="/jeddah/healthy-meals" className="underline">اشتراكات جدة</Link> / الأسعار
          </nav>
          <div className="mt-8 max-w-4xl">
            <p className="text-sm font-bold" style={{ color: "#108055" }}>بيسك دايت · جدة</p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight md:text-5xl">أسعار اشتراك وجبات دايت في جدة</h1>
            <p className="mt-5 text-base leading-8 md:text-lg">
              اختَر باقتك حسب ميزانيتك وروتينك: 7 أيام للتجربة، أو 26 يومًا، أو 30 يومًا للوجبات الشهرية.
              يختلف السعر حسب حصة البروتين (100 أو 150 أو 200 جم) وعدد الوجبات اليومية من 1 إلى 5.
              وزن الحصة ليس كمية البروتين الغذائية نفسها.
            </p>
          </div>

          <section className="mt-12" aria-labelledby="price-table-heading">
            <h2 id="price-table-heading" className="text-2xl font-extrabold md:text-3xl">جدول أسعار باقات الاشتراك</h2>
            {rows.length ? (
              <>
                <p className="mt-3 leading-7">الأسعار الأساسية التالية مصدرها قائمة الاشتراكات الحالية، قبل أي عرض أو رسوم توصيل أو إضافات.</p>
                <div className="mt-5 overflow-x-auto rounded-2xl border bg-white" style={{ borderColor: "#dbe8db" }}>
                  <table className="w-full min-w-[530px] border-collapse text-right text-sm">
                    <thead style={{ background: "#e5f0e5" }}>
                      <tr><th scope="col" className="p-4">المدة</th><th scope="col" className="p-4">حصة البروتين</th><th scope="col" className="p-4">الوجبات يوميًا</th><th scope="col" className="p-4">السعر الأساسي</th></tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr className="border-t" style={{ borderColor: "#dbe8db" }} key={row.days + "-" + row.grams + "-" + row.meals}>
                          <td className="p-4">{row.days === 7 ? "7 أيام" : `${row.days} يومًا`}</td><td className="p-4">{row.grams} جم</td>
                          <td className="p-4">{row.meals}</td><td className="p-4 font-bold"><span dir="ltr">{formatSar(row.price)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-xl bg-white p-6 leading-8">قائمة الأسعار غير متاحة للعرض الآن. لن نعرض أسعارًا تقديرية غير مؤكدة. يُمكنك التسجيل ليتواصل معك الفريق بالسعر المناسب لاختياراتك.</p>
            )}
            <p className="mt-4 text-sm leading-7">
              الخصم المعلن للتسجيل من الموقع 15% على سعر باقة الاشتراك فقط، ولا يشمل الوجبات الفردية أو التوصيل أو الإضافات. يراجع الفريق أهلية العرض والسعر النهائي قبل التأكيد.
              التسجيل لا يتطلب دفعًا.
            </p>
            <AppCta location="plans" className="button mt-5">سجّل لخصم 15%</AppCta>
          </section>

          <section className="mt-14 grid gap-6 md:grid-cols-2" aria-labelledby="price-selection-heading">
            <div className="rounded-2xl border bg-white p-6" style={{ borderColor: "#dbe8db" }}>
              <h2 id="price-selection-heading" className="text-xl font-bold">كيف تختار اشتراكك الشهري؟</h2>
              <p className="mt-3 leading-8">باقة 26 يومًا مناسبة لمن يريد تنظيم الوجبات على أيام أكثر خلال الشهر، وباقة 30 يومًا لمن يحتاج تغطية يومية لشهر كامل. قارن إجمالي الوجبات والسعر واختَر ما يناسب استخدامك.</p>
            </div>
            <div className="rounded-2xl border bg-white p-6" style={{ borderColor: "#dbe8db" }}>
              <h2 className="text-xl font-bold">التوصيل والاستلام في جدة</h2>
              <p className="mt-3 leading-8">اختر التوصيل أو الاستلام بحسب المتاح. تأكد من تغطية عنوانك ورسوم التوصيل قبل الطلب؛ السعر المعروض في الجدول لا يتضمن رسوم التوصيل.</p>
            </div>
          </section>
          <p className="mt-8 leading-8">
            <Link href="/menu" className="font-bold underline" style={{ color: "#108055" }}>تصفّح منيو بيسك دايت بالصور والسعرات</Link>
            {" "}أو{" "}
            <Link href="/jeddah/healthy-meals" className="font-bold underline" style={{ color: "#108055" }}>اقرأ دليل اشتراكات الوجبات الصحية في جدة</Link>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
