import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "./LogoMark";
import { useAuth } from "@/contexts/AuthContext";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutGrid,
  UsersRound,
  MapPin,
  Inbox,
  Shield,
  Building,
  LogOut,
  User,
  Database,
  Menu,
  X,
  ChevronDown,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/roleLabels";

const REQUEST_ROLES = ["superadmin", "admin", "boa"];

function useUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/notifications/count", {
          credentials: "include",
        });
        if (res.ok && alive) {
          const data = (await res.json()) as { unread?: number };
          setCount(data.unread ?? 0);
        }
      } catch {
        /* ignore */
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);
  return count;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const mainNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { label: "Student Directory", href: "/dashboard/students", icon: UsersRound },
  { label: "Student Attendance Stats", href: "/dashboard/attendance-stats", icon: BarChart3 },
  { label: "Campus Analytics", href: "/dashboard/campuses", icon: MapPin },
];

const adminNav: NavItem[] = [
  { label: "User Access", href: "/admin/users", icon: Shield },
  { label: "Campus Setup", href: "/admin/campuses", icon: Building },
];

function NavItemLink({
  item,
  active,
  onNavigate,
  badge,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  badge?: number;
}) {
  return (
    <Link href={item.href} onClick={onNavigate}>
      <div
        className={cn(
          "group flex items-center gap-3 border-l-2 py-2.5 pl-3 pr-2 text-[13px] font-medium transition-colors cursor-pointer",
          active
            ? "border-brand-500 bg-slate-800/80 text-white"
            : "border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0 opacity-90" />
        <span className="flex-1 truncate">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </div>
    </Link>
  );
}

function ProfileMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const isSuperadmin = user?.role === "superadmin";

  const handleLogout = () => {
    setOpen(false);
    logout.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/staff-login";
      },
    });
  };

  return (
    <div className="relative border-t border-slate-700/80 p-3">
      {open && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      {open && (
        <div className="absolute bottom-full left-3 right-3 z-40 mb-2 rounded-md border border-slate-600 bg-slate-800 py-1 md:bottom-0 md:left-full md:right-auto md:mb-0 md:ml-2 md:w-52">
          <Link
            href="/dashboard/profile"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
          >
            <div className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">
              <User className="h-4 w-4" /> My Profile
            </div>
          </Link>
          {isSuperadmin && (
            <Link
              href="/dashboard/bigquery"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              <div className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">
                <Database className="h-4 w-4" /> Data Explorer
              </div>
            </Link>
          )}
          <div className="my-1 border-t border-slate-600" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-slate-700"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-800/60"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-700 text-sm font-semibold text-white">
          {user?.name?.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{user?.name}</p>
          <p className="truncate text-xs text-slate-400">{roleLabel(user?.role)}</p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const canManage = user?.role === "superadmin" || user?.role === "admin";
  const canRequests = REQUEST_ROLES.includes(user?.role ?? "");
  const unread = useUnreadCount(canRequests);
  const visibleMainNav = mainNav.filter(
    (item) => !(user?.role === "boa" && item.href === "/dashboard/campuses"),
  );

  return (
    <div className="flex h-full flex-col bg-slate-900">
      <div className="border-b border-slate-700/80 px-4 py-4">
        <Logo inverted className="gap-3" />
      </div>

      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Main
        </p>
        {visibleMainNav.map((item) => (
          <NavItemLink
            key={item.href}
            item={item}
            active={
              location === item.href ||
              (item.href !== "/dashboard" &&
                location.startsWith(`${item.href}/`))
            }
            onNavigate={onNavigate}
          />
        ))}

        {canRequests && (
          <>
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Operations
            </p>
            <NavItemLink
              item={{
                label: "Request Inbox",
                href: "/dashboard/requests",
                icon: Inbox,
              }}
              active={location === "/dashboard/requests"}
              onNavigate={onNavigate}
              badge={unread}
            />
          </>
        )}

        {canManage && (
          <>
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Administration
            </p>
            {adminNav.map((item) => (
              <NavItemLink
                key={item.href}
                item={item}
                active={location === item.href}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </nav>

      <ProfileMenu onNavigate={onNavigate} />
    </div>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-slate-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[240px] md:flex">
        <SidebarInner />
      </aside>

      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <Logo className="scale-90 origin-left" />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[240px]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3 z-50 rounded-md p-1.5 text-slate-400 hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarInner onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex min-h-[100dvh] flex-col overflow-y-auto bg-white pt-14 md:h-[100dvh] md:pl-[240px] md:pt-0">
        <div className="flex min-h-0 w-full flex-1 flex-col pl-2 pr-8 sm:pl-3 sm:pr-10 lg:pr-12">
          {children}
        </div>
      </main>
    </div>
  );
}
