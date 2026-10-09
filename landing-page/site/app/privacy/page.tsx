import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "خصوصية طلب التواصل | Basic Diet",
  description: "كيف يستخدم Basic Diet بيانات نموذج طلب التواصل بشأن الاشتراكات.",
  robots: { index: false, follow: true },
};

export default function LandingPrivacyPage() {
  return (
    <main dir="rtl" className="min-h-screen px-5 py-10 md:py-16" style={{ background: "#f5f8f2", color: "#12332a" }}>
      <article className="mx-auto max-w-3xl rounded-3xl border bg-white p-6 shadow-sm md:p-10" style={{ borderColor: "#dbe9d9" }}>
        <Link className="mb-8 inline-flex rounded-full border px-4 py-2 text-sm font-bold" href="/" style={{ color: "#108055", borderColor: "#dbe9d9" }}>
          ← العودة إلى Basic Diet
        </Link>
        <p className="mb-2 text-sm font-bold" style={{ color: "#108055" }}>خصوصية نموذج طلب الاشتراك</p>
        <h1 className="mb-5 text-3xl font-bold leading-snug">بياناتك لطلب التواصل فقط</h1>
        <p className="mb-6 leading-8">
          عند إرسال طلب من صفحة Basic Diet، نستخدم البيانات التي تدخلها ليتواصل فريق المطعم
          معك بخصوص الباقة التي اخترتها. هذا الطلب لا ينشئ حسابًا في التطبيق أو اشتراكًا مدفوعًا.
        </p>
        <div className="space-y-6 text-sm leading-8 md:text-base">
          <section>
            <h2 className="mb-2 text-xl font-bold">ما البيانات التي نحفظها؟</h2>
            <p>رقم الجوال، والاسم إن أدخلته، ومدة الاشتراك وحجم الوجبة وعدد الوجبات وطريقة الاستلام المفضلة.
              ونحفظ أيضًا وقت الطلب، وموافقات التواصل، ومصدر الحملة إن وصلت من رابط تسويقي،
              وحالة متابعة الطلب والملاحظات التي يضيفها الموظف المختص.</p>
          </section>
          <section>
            <h2 className="mb-2 text-xl font-bold">لماذا نستخدمها؟</h2>
            <p>للتواصل معك بشأن طلب الاشتراك والرد على استفساراتك ومتابعة الطلب.
              لا نرسل عروضًا ترويجية مستقبلية بناءً على نموذج الطلب إلا إذا اخترت الموافقة التسويقية المنفصلة.
              ويمكنك طلب وقف الرسائل التسويقية في أي وقت.</p>
          </section>
          <section>
            <h2 className="mb-2 text-xl font-bold">من يمكنه الاطلاع عليها؟</h2>
            <p>الأشخاص المصرّح لهم بمتابعة طلبات العملاء في لوحة تحكم المطعم.
              يعمل الموقع والخادم وقاعدة البيانات من خلال مزوّدي تشغيل تقنيين.
              لا تظهر بيانات الجوال والاسم في تقارير الزيارات العامة.</p>
          </section>
          <section>
            <h2 className="mb-2 text-xl font-bold">مدة الاحتفاظ</h2>
            <p>تُضبط طلبات التواصل للحذف الآلي من قاعدة بيانات الطلبات بعد 180 يومًا من إنشائها.
              وقد يحتاج الحذف الآلي مدة تنفيذ قصيرة. بيانات زيارات الموقع المجمّعة منفصلة عن طلب التواصل.</p>
          </section>
          <section>
            <h2 className="mb-2 text-xl font-bold">طلب الاطلاع أو التصحيح أو الحذف</h2>
            <p>تواصل مع فريق Basic Diet عبر
              {" "}<a className="font-bold underline" style={{ color: "#108055" }} href="tel:+966535332639" dir="ltr">+966 53 533 2639</a>
              {" "}للاستفسار عن بيانات طلبك أو طلب تصحيحها أو حذفها أو سحب موافقتك التسويقية.
              قد نحتاج للتحقق من ملكية رقم الجوال قبل تنفيذ الطلب.</p>
          </section>
          <section className="rounded-xl p-4" style={{ background: "#f0f7f2" }}>
            <h2 className="mb-2 text-lg font-bold">سياسة خصوصية التطبيق</h2>
            <p>عند إنشاء حساب أو شراء اشتراك من تطبيق Basic Diet، تُطبّق
              {" "}<a className="font-bold underline" style={{ color: "#108055" }} href="https://basicdiet145-production-51e9.up.railway.app/privacy-policy" target="_blank" rel="noopener noreferrer">سياسة خصوصية التطبيق</a>
              {" "}بالإضافة إلى المعلومات الخاصة بهذا النموذج.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
