import { faqItems } from "@/lib/faq-data";

export function StructuredData() {
  const restaurant = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdiet-landing-production.up.railway.app") + "/#restaurant",
    name: "بيسك دايت - Basic Diet",
    alternateName: ["Basic Diet", "بيسك دايت"],
    url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdiet-landing-production.up.railway.app",
    logo: (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdiet-landing-production.up.railway.app") + "/brand/logo-primary.png",
    address: {
      "@type": "PostalAddress",
      streetAddress: "H4GX+JF7، السلامة",
      addressLocality: "جدة",
      addressRegion: "مكة المكرمة",
      addressCountry: "SA",
    },
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
