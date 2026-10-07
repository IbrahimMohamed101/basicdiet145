"use client";

import { useState } from "react";
import { faqItems } from "@/lib/faq-data";

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
          {faqItems.map((item, index) => {
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
