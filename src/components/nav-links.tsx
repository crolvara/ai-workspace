"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Chat" },
  { href: "/compare", label: "Compare" },
  { href: "/prompts", label: "Prompts" },
  { href: "/ocr", label: "OCR" },
  { href: "/audio", label: "Audio" },
  { href: "/images", label: "Images" },
  { href: "/usage", label: "Usage" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    /* Scrolls horizontally on narrow screens instead of clipping */
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm [scrollbar-width:none]">
      {NAV_LINKS.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
