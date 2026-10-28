import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MenuExperience } from "@/components/MenuExperience";
import { LeadDialog } from "@/components/LeadDialog";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import "./menu.css";
import "./menu-refinement.css";

const isMenuPreview = process.env.NEXT_PUBLIC_MENU_PREVIEW_MODE === "true";

export const metadata: Metadata = {
  title: "منيو بيسك دايت | الوجبات والاشتراكات واصنع بنفسك",
  description: "تصفح منيو بيسك دايت في جدة: وجبات صحية، سلطات، فطور وساندويتشات بالصور والأسعار، واختار باقة اشتراكك أو حمّل التطبيق.",
  alternates: { canonical: "/menu" },
  // Staging stays outside search; only the customer-facing production build is indexable.
  robots: isMenuPreview ? { index: false, follow: false } : { index: true, follow: true },
};

export default function MenuPage() {
  return (
    <>
      <a className="skip-link" href="#menu-main">انتقل لمنيو بيسك دايت</a>
      <AnalyticsTracker />
      <LeadDialog />
      <Header />
      <MenuExperience />
      <Footer />
    </>
  );
}
