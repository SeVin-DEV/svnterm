import { Link, useLocation } from "wouter";
import { Terminal, Server, Code2, Settings, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Terminal, label: "Terminal" },
  { href: "/connections", icon: Server, label: "Servers" },
  { href: "/files", icon: FolderOpen, label: "Files" },
  { href: "/snippets", icon: Code2, label: "Snippets" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* ── Desktop left sidebar (md+) ── */}
      <nav
        className="hidden md:flex flex-col w-14 border-r border-border bg-sidebar shrink-0"
        data-testid="sidebar"
      >
        <div className="flex items-center justify-center h-12 border-b border-sidebar-border">
          <Terminal className="w-5 h-5 text-primary" />
        </div>
        <div className="flex flex-col gap-1 p-2 flex-1">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}>
              <button
                className={cn(
                  "w-full flex items-center justify-center h-10 rounded-md transition-colors group relative",
                  location === href
                    ? "bg-sidebar-accent text-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary"
                )}
                title={label}
                data-testid={`nav-${label.toLowerCase()}`}
              >
                <Icon className="w-4 h-4" />
                <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded border border-popover-border whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  {label}
                </span>
              </button>
            </Link>
          ))}
        </div>
      </nav>

      {/* ── Content + mobile bottom nav column ── */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0 min-w-0">
        {/* Main content */}
        <main className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {children}
        </main>

        {/* ── Mobile bottom tab bar (< md) ── */}
        <nav
          className="md:hidden shrink-0 border-t border-sidebar-border bg-sidebar"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          data-testid="mobile-tab-bar"
        >
          <div className="flex h-14">
            {navItems.map(({ href, icon: Icon, label }) => {
              const active = location === href;
              return (
                <Link key={href} href={href} className="flex-1">
                  <button
                    className={cn(
                      "w-full h-full flex flex-col items-center justify-center gap-0.5 transition-colors",
                      active
                        ? "text-primary"
                        : "text-sidebar-foreground"
                    )}
                    data-testid={`mobile-nav-${label.toLowerCase()}`}
                  >
                    <Icon className={cn("w-5 h-5", active && "drop-shadow-[0_0_6px_hsl(var(--primary))]")} />
                    <span className={cn("text-[10px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                      {label}
                    </span>
                  </button>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
