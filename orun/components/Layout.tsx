import React from "react";
import { NavLink, useLocation } from "@/router";
import {
  LayoutDashboard,
  List,
  AlertTriangle,
  BarChart2,
  Bell,
  User,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const NavItem: React.FC<{
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ to, icon, children }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-blue-600/10 text-blue-400"
            : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
        }`
      }
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const location = useLocation();
  const { user, logout } = useAuth();

  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path === "/") return "Dashboard";
    if (path.startsWith("/instances")) {
      if (path.includes("/diagram")) return "Instances > Detail > Diagram";
      if (path.length > 11) return `Instances > ${path.split("/")[2]}`;
      return "Instances";
    }
    if (path.startsWith("/jobs")) return "Failed Jobs";
    if (path.startsWith("/metrics")) return "System Metrics";
    return "Home";
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-700 bg-slate-900/90 backdrop-blur supports-[backdrop-filter]:bg-slate-900/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <NavLink
              to="/"
              className="flex items-center gap-2 font-bold text-xl tracking-tight text-slate-100"
            >
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="w-5 h-5 text-white"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              Orun
            </NavLink>
            <nav className="hidden md:flex items-center gap-1">
              <NavItem to="/" icon={<LayoutDashboard size={18} />}>
                Dashboard
              </NavItem>
              <NavItem to="/instances" icon={<List size={18} />}>
                Instances
              </NavItem>
              <NavItem to="/jobs" icon={<AlertTriangle size={18} />}>
                Jobs
              </NavItem>
              <NavItem to="/metrics" icon={<BarChart2 size={18} />}>
                Metrics
              </NavItem>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-slate-400 hover:text-slate-100 relative">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse"></span>
            </button>
            <div className="w-px h-6 bg-slate-700 mx-1"></div>
            <button
              onClick={() => logout()}
              className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600">
                <User size={16} />
              </div>
              <span className="hidden sm:inline">
                {user?.username || "User"}
              </span>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Breadcrumbs */}
      <div className="border-b border-slate-800 bg-slate-900/50">
        <div className="container mx-auto px-4 py-2">
          <div className="text-xs text-slate-500 font-mono">
            Orun / <span className="text-slate-300">{getBreadcrumbs()}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>

      <footer className="border-t border-slate-800 py-6 mt-8">
        <div className="container mx-auto px-4 text-center text-slate-500 text-sm">
          &copy; {new Date().getFullYear()} Abada BPMN Engine Operations. All
          rights reserved.
        </div>
      </footer>
    </div>
  );
};
