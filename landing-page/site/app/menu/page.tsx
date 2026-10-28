import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MenuExperience } from "@/components/MenuExperience";
import { LeadDialog } from "@/components/LeadDialog";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import "./menu.css";
import "./menu-refinement.css";

export const metadata: Metadata = {
  title: "منيو بيسك دايت | الوجبات والاشتراكات واصنع بنفسك",
  description: "استكشف وجبات بيسك دايت، اشتراكات 7 و26 و30 يومًا، وتجربة تكوين وجبتك أو سلطتك.",
  alternates: { canonical: "/menu" },
  // Pricing and asset approval are incomplete. Keep this preview out of search.
  robots: { index: false, follow: false },
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
