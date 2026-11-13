import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Tajawal } from "next/font/google";
import { MotionRuntime } from "@/components/MotionRuntime";
import { MetaPixel } from "@/components/MetaPixel";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-tajawal",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://basicdietksa.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "بيسك دايت | Basic Diet - اشتراكات وجبات صحية في جدة",
  applicationName: "بيسك دايت - Basic Diet",
  description:
    "بيسك دايت (Basic Diet) مطعم وجبات صحية في جدة. اختر اشتراكك لمدة 7 أو 26 أو 30 يومًا، وحدد كمية الوجبات وعددها يوميًا ثم اطلب التواصل أو حمّل التطبيق.",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "facebook-domain-verification": "3b52rqmckolpiqw6r0dkqrnfuwgovn",
  },
  openGraph: {
    siteName: "بيسك دايت - Basic Diet",
    title: "بيسك دايت | Basic Diet - اشتراكات وجبات صحية في جدة",
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
        <style>{`
          body > a.skip-link[data-global-skip] ~ a.skip-link,
          body > a.skip-link[data-global-skip] ~ * .skip-link {
            display: none;
          }
        `}</style>
      </head>
      <body>
        <a className="skip-link" data-global-skip="true" href="#content-start">انتقل للمحتوى</a>
        <MotionRuntime />
        <MetaPixel />
        {children}
      </body>
    </html>
  );
}
