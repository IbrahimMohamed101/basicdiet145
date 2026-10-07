import { faqItems } from "@/components/FAQ";

export function StructuredData() {
  const restaurant = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: "Basic Diet",
    areaServed: {
      "@type": "City",
      name: "Jeddah",
    },
    servesCuisine: "Healthy meals",
    sameAs: ["https://apps.apple.com/ar/app/basic-diet/id6775085745"],
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(restaurant) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
    </>
  );
}
