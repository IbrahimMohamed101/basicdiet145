import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Tajawal } from "next/font/google";
import { MotionRuntime } from "@/components/MotionRuntime";
import { HERO_POSTER_URL } from "@/lib/app-links";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-tajawal",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdiet-landing-production.up.railway.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "اشتراكات وجبات صحية في جدة | Basic Diet",
  description:
    "اشتراكات وجبات صحية في جدة من Basic Diet. اختر باقة 7 أو 26 أو 30 يومًا، وحدد حجم الوجبة وعدد الوجبات اليومية، ثم اطلب التواصل أو حمّل التطبيق.",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
  },
  applicationName: "Basic Diet",
  keywords: ["اشتراكات وجبات صحية جدة", "وجبات صحية جدة", "اشتراك وجبات دايت", "Basic Diet"],
  openGraph: {
    title: "Basic Diet | وجبات تحبها، بكميات محسوبة",
    description:
      "اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في اشتراكك من تطبيق Basic Diet.",
    locale: "ar_SA",
    type: "website",
    url: siteUrl,
    images: [{ url: "/media/hero-poster.webp", alt: "Basic Diet - وجبات صحية" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Basic Diet | اشتراكات وجبات صحية في جدة",
    description: "حمّل تطبيق Basic Diet لاختيار اشتراكك ووجباتك، أو تواصل مع المطعم للمساعدة.",
    images: ["/media/hero-poster.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <head>
        <link rel="icon" href="/brand/logo-primary.png" />
        <link rel="preload" as="image" href={HERO_POSTER_URL} fetchPriority="high" />
      </head>
      <body>
        <MotionRuntime />
        {children}
      </body>
    </html>
  );
}
