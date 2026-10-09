import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { AppReveal } from "@/components/AppReveal";
import { MealGallery } from "@/components/MealGallery";
import { Benefits } from "@/components/Benefits";
import { HowItWorks } from "@/components/HowItWorks";
import { InstagramReels } from "@/components/InstagramReels";
import { Plans } from "@/components/Plans";
import { FAQ } from "@/components/FAQ";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import { LeadDialog } from "@/components/LeadDialog";
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
      <main id="main">
        <div id="top" />
        <Hero />
        <AppReveal />
        <MealGallery />
        <Benefits />
        <HowItWorks />
        <InstagramReels />
        <Plans />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
