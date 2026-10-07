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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: "Basic Diet | اشتراكات وجبات صحية في جدة",
  description:
    "وجبات متنوعة بكميات محسوبة وخيارات اشتراك مرنة. اختر مدة الباقة، كمية الوجبة وعدد وجباتك اليومية وابدأ اشتراكك مع Basic Diet في جدة.",
  alternates: siteUrl
    ? {
        canonical: "/",
      }
    : undefined,
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "Basic Diet | وجبات تحبها، بكميات محسوبة",
    description:
      "اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في اشتراكك من تطبيق Basic Diet.",
    locale: "ar_SA",
    type: "website",
    url: siteUrl || undefined,
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
