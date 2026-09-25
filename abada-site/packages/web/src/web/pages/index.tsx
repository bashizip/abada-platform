import { Nav, StickyCta } from "../components/site/nav";
import { Hero } from "../components/site/hero";
import { Boundary } from "../components/site/boundary";
import { Open } from "../components/site/open";
import { Governed } from "../components/site/governed";
import { Proof } from "../components/site/proof";
import { Comparison } from "../components/site/comparison";
import { Market } from "../components/site/market";
import { Pilot } from "../components/site/pilot";
import { Quickstart } from "../components/site/quickstart";
import { Limits } from "../components/site/limits";
import { Cta } from "../components/site/cta";

function Index() {
  return (
    <div className="min-h-screen bg-ink">
      <Nav />
      <main>
        <Hero />
        <Boundary />
        <Open />
        <Governed />
        <Proof />
        <Comparison />
        <Market />
        <Pilot />
        <Quickstart />
        <Limits />
        <Cta />
      </main>
      <StickyCta />
    </div>
  );
}

export default Index;
