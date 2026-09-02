import { Nav, StickyCta } from "../components/site/nav";
import { Hero } from "../components/site/hero";
import { Gap } from "../components/site/gap";
import { Comparison } from "../components/site/comparison";
import { Quickstart } from "../components/site/quickstart";
import { Architecture } from "../components/site/architecture";
import { Insight } from "../components/site/insight";
import { Reliability } from "../components/site/reliability";
import { Market } from "../components/site/market";
import { Founder } from "../components/site/founder";
import { Cta } from "../components/site/cta";

function Index() {
  return (
    <div className="min-h-screen bg-ink">
      <Nav />
      <main>
        <Hero />
        <Gap />
        <Comparison />
        <Quickstart />
        <Architecture />
        <Insight />
        <Reliability />
        <Market />
        <Founder />
        <Cta />
      </main>
      <StickyCta />
    </div>
  );
}

export default Index;
