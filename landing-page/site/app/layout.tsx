import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Tajawal } from "next/font/google";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-tajawal",
});

export const metadata: Metadata = {
  title: "Basic Diet | اشتراكات وجبات صحية في جدة",
  description:
    "وجبات متنوعة بكميات محسوبة وخيارات اشتراك مرنة. اختر مدة الباقة، كمية الوجبة وعدد وجباتك اليومية وابدأ اشتراكك مع Basic Diet في جدة.",
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
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={tajawal.variable}>
      <body>{children}</body>
    </html>
  );
}
