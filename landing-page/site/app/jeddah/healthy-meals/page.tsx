import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AppCta } from "@/components/AppCta";
import { LeadDialog } from "@/components/LeadDialog";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";

const FALLBACK = "https://basicdiet-landing-production.up.railway.app";
const canonical = (() => {
  try {
    const value = new URL(process.env.NEXT_PUBLIC_SITE_URL || FALLBACK);
    return (value.protocol === "https:" ? value.origin : FALLBACK) + "/jeddah/healthy-meals";
  } catch { return FALLBACK + "/jeddah/healthy-meals"; }
})();

export const metadata: Metadata = {
  title: "اشتراك وجبات صحية في جدة | باقات أسبوعية وشهرية | Basic Diet",
  description: "تبحث عن اشتراك وجبات صحية في جدة؟ اختر من باقات Basic Diet لمدة 7 أو 26 أو 30 يومًا، وحدد حجم الوجبة وعدد وجباتك اليومية. اطلب تواصلًا أو حمّل التطبيق.",
  alternates: { canonical },
  openGraph: {
    title: "اشتراكات وجبات صحية في جدة | Basic Diet",
    description: "باقات وجبات صحية في جدة بخيارات متعددة لأيام الاشتراك وحجم الوجبة وعدد الوجبات والتوصيل.",
    type: "website", locale: "ar_SA", url: canonical,
  },
};

const faqs = [
  { q: "كيف أختار اشتراك وجبات صحية مناسبًا في جدة؟", a: "ابدأ بتحديد عدد الأيام والوجبات التي تحتاجها يوميًا، ثم اختر حجم الوجبة وطريقة الاستلام. راجع تفاصيل الباقة والسعر النهائي داخل تطبيق Basic Diet قبل الدفع." },
  { q: "هل توجد اشتراكات وجبات صحية أسبوعية وشهرية؟", a: "توجد خيارات اشتراك لمدة 7 أيام و26 يومًا و30 يومًا. توافر خيارات كل باقة يعتمد على الإعدادات الحالية." },
  { q: "هل أقدر أطلب وجبة واحدة يوميًا؟", a: "تقدر تختار عدد الوجبات من الخيارات المتاحة في الباقة، بما فيها وجبة واحدة عندما تكون مفعّلة." },
  { q: "هل يتم توصيل الاشتراكات لكل أحياء جدة؟", a: "تُراجع تغطية منطقة عنوانك أثناء الطلب؛ لا يمكن تأكيد توصيل كل الأحياء قبل التحقق من موقع العميل." },
  { q: "هل إرسال الطلب من الموقع يُنشئ اشتراكًا مدفوعًا؟", a: "لا. إرسال رقم جوالك من الموقع هو طلب للتواصل معك بشأن الباقة، وليس عملية دفع أو اشتراكًا مؤكدًا." },
];
const plans = [
  { days: 7, title: "اشتراك أسبوعي", copy: "خيار لتجربة تنظيم وجباتك لمدة أقصر." },
  { days: 26, title: "اشتراك 26 يومًا", copy: "للي يفضل تنظيم وجباته على فترة أطول." },
  { days: 30, title: "اشتراك 30 يومًا", copy: "لتخطيط وجبات الشهر بشكل متواصل." },
];

export default function JeddahHealthyMealsPage() {
  return (
    <>
      <AnalyticsTracker />
      <LeadDialog />
      <Header />
      <main dir="rtl" className="min-h-screen" style={{ background: "#f6f8f3", color: "#14382e" }}>
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-28 md:px-8 md:pt-40">
          <nav className="mb-6 text-sm" aria-label="مسار التنقل">
            <Link href="/" className="underline underline-offset-4" style={{ color: "#108055" }}>الرئيسية</Link>
            <span aria-hidden="true"> / </span> اشتراكات وجبات صحية جدة
          </nav>
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-bold" style={{ color: "#108055" }}>Basic Diet · جدة</p>
            <h1 className="text-3xl font-extrabold leading-tight md:text-5xl">اشتراك وجبات صحية في جدة، على مقاس يومك</h1>
            <p className="mt-6 text-base leading-8 md:text-lg">
              لو بتدور على اشتراك وجبات دايت في جدة، تقدر تبدأ بتحديد المدة اللي تناسبك وحجم الوجبة
              وعدد وجباتك اليومية. Basic Diet بيوفر خيارات اشتراك مرنة تخلّيك تختار الوجبات
              اللي تناسب روتينك، سواء لجدول الأسبوع أو باقات الفترة الأطول.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <AppCta location="plans" className="button">اطلب تواصل بخصوص اشتراكك ←</AppCta>
              <Link href="/#plans" className="text-sm font-bold underline underline-offset-4" style={{ color: "#108055" }}>
                شوف تفاصيل الباقات
              </Link>
            </div>
            <p className="mt-3 text-xs" style={{ color: "#63756d" }}>طلب التواصل مش عملية دفع. الأسعار النهائية بتظهر بعد تحديد خياراتك في التطبيق.</p>
          </div>

          <section className="mt-16 md:mt-20" aria-labelledby="jeddah-plans-heading">
            <h2 id="jeddah-plans-heading" className="text-2xl font-bold md:text-3xl">باقات اشتراكات وجبات صحية أسبوعية وشهرية</h2>
            <p className="mt-3 max-w-3xl leading-8" style={{ color: "#526c5d" }}>
              اختار مدة الاشتراك، وبعدها حدد عدد وجباتك اليومية والكمية المناسبة لك. توافر كل خيار بيتحدد حسب الباقة.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {plans.map(plan => (
                <article key={plan.days} className="flex flex-col gap-3 rounded-2xl border bg-white p-6" style={{ borderColor: "#dbe8db" }}>
                  <p className="text-sm font-bold" style={{ color: "#108055" }}>{plan.title}</p>
                  <h3 className="text-3xl font-extrabold">{plan.days} يومًا</h3>
                  <p className="flex-1 text-sm leading-7" style={{ color: "#526c5d" }}>{plan.copy}</p>
                  <AppCta location="plans" planDays={plan.days} className="button">استفسر عن الباقة ←</AppCta>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-16 grid gap-8 md:mt-20 md:grid-cols-2" aria-labelledby="jeddah-how-heading">
            <div>
              <h2 id="jeddah-how-heading" className="text-2xl font-bold md:text-3xl">طريقة بدء اشتراك وجبات دايت في جدة</h2>
              <div className="mt-5 space-y-5 leading-8">
                <p><strong>1. حدّد الأيام:</strong> جرّب باقة أسبوعية أو اختَر فترة أطول.</p>
                <p><strong>2. اختَر كمية الوجبة:</strong> خيارات 100 و150 و200 جرام، ومن وجبة إلى خمس وجبات يوميًا وفق المتاح داخل الباقة.</p>
                <p><strong>3. اختَر التوصيل أو الاستلام:</strong> راجع تغطية عنوانك وخيارات الفرع قبل التأكيد.</p>
                <p><strong>4. أكمل من التطبيق:</strong> راجع قائمة الوجبات والإضافات والسعر النهائي قبل الدفع.</p>
              </div>
            </div>
            <div className="rounded-3xl p-7 md:p-9" style={{ background: "#e5f0e5" }}>
              <h3 className="text-xl font-bold">مش متأكد تختار أي اشتراك؟</h3>
              <p className="mt-4 leading-8">
                اختَر مدة مبدئية من الموقع وسيب رقم جوالك، وفريق Basic Diet يتواصل معك
                بخصوص الخيارات المتاحة. ولو تفضّل تبدأ بنفسك، تقدر تستخدم التطبيق
                لتحديد الوجبات والاستلام ومراجعة السعر الفعلي.
              </p>
              <p className="mt-4 text-sm" style={{ color: "#526c5d" }}>التوصيل والاستلام حسب الخيارات المتاحة ومناطق التغطية في جدة.</p>
              <AppCta location="final" className="button mt-5">ساعدني أختار الاشتراك ←</AppCta>
            </div>
          </section>

          <section className="mt-16 md:mt-20" aria-labelledby="jeddah-faq-heading">
            <h2 id="jeddah-faq-heading" className="text-2xl font-bold md:text-3xl">أسئلة شائعة عن اشتراكات الوجبات الصحية في جدة</h2>
            <div className="mt-5 grid gap-3">
              {faqs.map(item => (
                <details key={item.q} className="rounded-xl border bg-white px-5 py-4" style={{ borderColor: "#dbe8db" }}>
                  <summary className="cursor-pointer font-bold leading-7">{item.q}</summary>
                  <p className="mt-3 text-sm leading-7" style={{ color: "#526c5d" }}>{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <div className="mt-14 border-t pt-7 text-sm leading-7" style={{ borderColor: "#dbe8db" }}>
            <p>Basic Diet — اشتراكات وجبات صحية في جدة.</p>
            <p>للاستفسار: <a href="tel:+966535332639" dir="ltr" className="font-bold underline">+966 53 533 2639</a>.
              {" "}وللمزيد من التفاصيل، <Link href="/" className="font-bold underline">زور الصفحة الرئيسية</Link>.</p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
