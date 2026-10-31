
export function StructuredData() {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdietksa.com").replace(/\/+$/, "");
  // A WebSite node on the home page makes the preferred Arabic/English site name explicit.
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": siteUrl + "/#website",
    url: siteUrl + "/",
    name: "بيسك دايت",
    alternateName: ["Basic Diet", "بيسك دايت - Basic Diet"],
    inLanguage: "ar-SA",
    publisher: { "@id": siteUrl + "/#restaurant" },
  };
  const restaurant = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": siteUrl + "/#restaurant",
    name: "بيسك دايت - Basic Diet",
    alternateName: ["Basic Diet", "بيسك دايت"],
    url: siteUrl + "/",
    logo: siteUrl + "/brand/logo-primary.png",
    address: {
      "@type": "PostalAddress",
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
    // Do not advertise 24/7 opening hours unless verified against the restaurant.
    hasMenu: siteUrl + "/menu",
    hasMap: "https://maps.app.goo.gl/CGEn7oQWiKEXJzgG7",
    sameAs: [
      "https://apps.apple.com/ar/app/basic-diet/id6775085745",
      "https://play.google.com/store/apps/details?id=com.app.basic_diet&hl=ar",
      "https://www.instagram.com/basicdiet.sa/",
      "https://www.tiktok.com/@basicdiet.sa",
      "https://www.snapchat.com/@basicdiet.sa",
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(restaurant) }}
      />
    </>
  );
}
