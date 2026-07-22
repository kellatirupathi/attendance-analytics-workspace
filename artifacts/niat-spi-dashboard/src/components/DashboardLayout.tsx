import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LogoMark } from "./LogoMark";
import { useAuth } from "@/contexts/AuthContext";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  GraduationCap,
  Building2,
  UserCog,
  User,
  Database,
  LogOut,
  ChevronRight,
  Menu,
  X,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roleLabel } from "@/lib/roleLabels";

const REQUEST_ROLES = ["superadmin", "admin", "boa"];

// Polls the unread attendance-request notification count for the badge.
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

const primaryNav: NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/dashboard/students", icon: GraduationCap },
  { label: "Campuses", href: "/dashboard/campuses", icon: Building2 },
];

const adminNav: NavItem[] = [
  { label: "Manage Users", href: "/admin/users", icon: UserCog },
  { label: "Manage Campuses", href: "/admin/campuses", icon: Building2 },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link href={item.href} onClick={onNavigate}>
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer",
          active
            ? "bg-brand-600 text-white shadow-sm"
            : "text-gray-700 hover:bg-gray-100",
        )}
      >
        <item.icon className="h-[18px] w-[18px]" />
        {item.label}
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
    <div className="relative">
      {open && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-40 mb-2 w-auto rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl md:bottom-0 md:left-full md:right-auto md:mb-0 md:ml-3 md:w-56">
          <Link
            href="/dashboard/profile"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
          >
            <div className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <User className="h-4 w-4" /> Edit Profile
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
              <div className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <Database className="h-4 w-4" /> BigQuery Check
              </div>
            </Link>
          )}
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-gray-50"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600">
          {user?.name?.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-800">
            {user?.name}
          </p>
          <p className="text-[11px] text-gray-400">{roleLabel(user?.role)}</p>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-gray-400 transition-transform",
            open && "rotate-90",
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <LogoMark className="h-9 w-9" />
        <div>
          <p className="text-lg font-extrabold leading-none text-gray-900">
            NIAT <span className="text-[#F25C05]">SPI</span>
          </p>
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {primaryNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={location === item.href}
            onNavigate={onNavigate}
          />
        ))}
        {canRequests && (
          <Link href="/dashboard/requests" onClick={onNavigate}>
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                location === "/dashboard/requests"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-gray-700 hover:bg-gray-100",
              )}
            >
              <Bell className="h-[18px] w-[18px]" />
              <span className="flex-1">Requests</span>
              {unread > 0 && (
                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold",
                    location === "/dashboard/requests"
                      ? "bg-white text-brand-600"
                      : "bg-brand-600 text-white",
                  )}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
          </Link>
        )}
        {canManage && (
          <>
            <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Administration
            </p>
            {adminNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={location === item.href}
                onNavigate={onNavigate}
              />
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-gray-200 p-3">
        <ProfileMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-[#f5f6fa]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 shrink-0 border-r border-gray-200 bg-white shadow-[1px_0_0_rgba(0,0,0,0.03)] md:flex">
        <SidebarInner />
      </aside>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
        <div className="flex items-center gap-2">
          <LogoMark className="h-8 w-8" />
          <span className="font-extrabold text-gray-900">
            NIAT <span className="text-[#F25C05]">SPI</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 z-50 rounded-md p-1 text-gray-400 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarInner onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="pt-14 md:pl-64 md:pt-0">
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
