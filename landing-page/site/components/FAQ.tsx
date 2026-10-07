"use client";

import { useState } from "react";

const items = [
  {
    question: "كيف أختار الباقة المناسبة؟",
    answer:
      "اختر المدة الأقرب لروتينك، وبعدها خصص كمية الوجبة وعدد وجباتك اليومية من التطبيق.",
  },
  {
    question: "كم عدد الوجبات اللي أقدر أختارها يوميًا؟",
    answer:
      "تقدر تختار من وجبة واحدة إلى خمس وجبات يوميًا حسب الباقة والإعدادات المتاحة.",
  },
  {
    question: "هل أقدر أختار وزن الوجبة؟",
    answer: "نعم. خيارات الكمية الحالية تشمل 100g و150g و200g.",
  },
  {
    question: "كيف أختار وجباتي؟",
    answer:
      "اختيار الوجبات يتم من خلال التطبيق حسب الخيارات المتاحة في اشتراكك.",
  },
  {
    question: "هل يوجد توصيل واستلام؟",
    answer:
      "نعم، Basic Diet يوفر التوصيل والاستلام. تفاصيل التوفر تظهر حسب موقعك وخيارات الاشتراك.",
  },
  {
    question: "كيف أدير اشتراكي؟",
    answer:
      "من خلال التطبيق، حيث تقدر تتابع اشتراكك وتدير الخيارات المتاحة لك.",
  },
  {
    question: "هل توجد معلومات للسعرات أو الماكروز؟",
    answer:
      "تتوفر معلومات غذائية للعديد من أصناف Basic Diet، ونستخدم في الصفحة فقط البيانات الموثقة.",
  },
  {
    question: "أين تتوفر الخدمة؟",
    answer:
      "Basic Diet يعمل في جدة. تفاصيل التغطية الدقيقة للتوصيل يتم تأكيدها حسب الموقع عند الطلب.",
  },
];

export const faqItems = items;

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="faq-section" id="faq" aria-labelledby="faq-title">
      <div className="page-shell faq-grid">
        <div className="faq-heading">
          <p className="eyebrow">
            <span />
            قبل ما تبدأ
          </p>
          <h2 id="faq-title">
            أسئلة
            <br />
            <span>ممكن تكون في بالك.</span>
          </h2>
        </div>

        <div className="faq-list">
          {items.map((item, index) => {
            const open = openIndex === index;
            return (
              <article className="faq-item" key={item.question}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`faq-answer-${index}`}
                    onClick={() => setOpenIndex(open ? null : index)}
                  >
                    <span>{item.question}</span>
                    <span className="faq-icon" aria-hidden="true">
                      {open ? "−" : "+"}
                    </span>
                  </button>
                </h3>
                <div
                  id={`faq-answer-${index}`}
                  className={`faq-answer ${open ? "faq-answer--open" : ""}`}
                >
                  <p>{item.answer}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
