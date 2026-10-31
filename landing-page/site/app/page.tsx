import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { AppReveal } from "@/components/AppReveal";
import { MealGallery } from "@/components/MealGallery";
import { DeferredPlanCalculator } from "@/components/DeferredPlanCalculator";
import { PlanPriceHighlights } from "@/components/PlanPriceHighlights";
import { HowItWorks } from "@/components/HowItWorks";
import { ServiceClarity } from "@/components/ServiceClarity";
import { InstagramReels } from "@/components/InstagramReels";
import { FAQ } from "@/components/FAQ";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { LeadDialog } from "@/components/LeadDialog";
import { PromoMobileBar } from "@/components/PromoExperience";
import { StructuredData } from "@/components/StructuredData";

// Keep prices fresh in server HTML instead of freezing a build-time fallback.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <StructuredData />
      <AnalyticsTracker />
      <LeadDialog />
      <a className="skip-link" href="#main">
        انتقل للمحتوى
      </a>
      <Header />
      <PromoMobileBar />
      <main id="main">
        <div id="top" />
        <Hero />
        <MealGallery />
        <DeferredPlanCalculator />
        <Suspense fallback={<section aria-label="أسعار الاشتراكات" className="py-12"><div className="page-shell">الأسعار تتحدد حسب الباقة. شاهد تفاصيل أسعار الاشتراكات في جدة.</div></section>}>
          <PlanPriceHighlights />
        </Suspense>
        <HowItWorks />
        <ServiceClarity />
        <AppReveal />
        <InstagramReels />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
