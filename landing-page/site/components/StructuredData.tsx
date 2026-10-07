import { faqItems } from "@/lib/faq-data";

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
    telephone: "+966535332639",
    openingHours: "Mo-Su 00:00-23:59",
    hasMap: "https://maps.app.goo.gl/CGEn7oQWiKEXJzgG7",
    sameAs: [
      "https://apps.apple.com/ar/app/basic-diet/id6775085745",
      "https://play.google.com/store/apps/details?id=com.app.basic_diet&hl=ar",
      "https://www.instagram.com/basicdiet.sa/",
      "https://www.tiktok.com/@basicdiet.sa",
      "https://www.snapchat.com/@basicdiet.sa",
    ],
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
