import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { AppReveal } from "@/components/AppReveal";
import { MealGallery } from "@/components/MealGallery";
import { PlanCalculator } from "@/components/PlanCalculator";
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
        <PlanCalculator sectionId="plans" context="home" />
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
