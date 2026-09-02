import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, Terminal, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { GITHUB_URL, DOCS_URL } from "../../lib/links";

const LINKS = [
  { label: "The gap", href: "#gap" },
  { label: "Comparison", href: "#comparison" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "Architecture", href: "#architecture" },
  { label: "Insight", href: "#insight" },
  { label: "Founder", href: "#founder" },
];

export function Nav({ anchorBase = "" }: { anchorBase?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled ? "border-b border-hairline bg-ink/85 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
        <a href={anchorBase || "#top"} className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-md bg-signal font-semibold text-[13px] text-[#04150f]">
            A
          </span>
          <span className="font-semibold tracking-tight">Abada</span>
        </a>

        <nav className="hidden items-center gap-7 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={`${anchorBase}${link.href}`}
              className="text-[13.5px] text-t2 transition-colors hover:text-t1"
            >
              {link.label}
            </a>
          ))}
          <a
            href={DOCS_URL}
            className="text-[13.5px] text-t2 transition-colors hover:text-t1"
          >
            Docs
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13.5px] text-t2 transition-colors hover:text-t1"
          >
            GitHub <ArrowUpRight className="size-3.5" />
          </a>
          <a
            href={`${anchorBase}#quickstart`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3.5 py-2 text-[13.5px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
          >
            <Terminal className="size-3.5" />
            Quickstart
          </a>
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          className="flex size-9 items-center justify-center rounded-lg border border-hairline text-t2 lg:hidden"
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-hairline bg-ink/95 px-6 py-4 backdrop-blur-xl lg:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={`${anchorBase}${link.href}`}
                onClick={() => setOpen(false)}
                className="py-2 text-sm text-t2"
              >
                {link.label}
              </a>
            ))}
            <a href={DOCS_URL} className="py-2 text-sm text-t2">
              Docs
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="py-2 text-sm text-t2">
              GitHub
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function StickyCta({ anchorBase = "" }: { anchorBase?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-ink/95 px-4 py-3 backdrop-blur-xl transition-transform duration-300 lg:hidden",
        show ? "translate-y-0" : "translate-y-full",
      )}
    >
      <a
        href={`${anchorBase}#quickstart`}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-signal py-3 text-sm font-medium text-[#04150f]"
      >
        <Terminal className="size-4" />
        Quickstart
      </a>
    </div>
  );
}
