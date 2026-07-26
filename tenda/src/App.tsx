import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "@/router";
import { useEffect, type ReactNode } from "react";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Processes from "./pages/Processes";
import ProcessDetail from "./pages/ProcessDetail";
import ProcessUpload from "./pages/ProcessUpload";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { AuthProvider } from "./components/AuthProvider";
import { ThemeProvider } from "./components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated && location.pathname !== "/login") {
      navigate("/login", { replace: true, state: { from: location } });
    }
  }, [loading, isAuthenticated, location, navigate]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Signing you in...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
};

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<RequireAuth><Navigate to="/tasks" replace /></RequireAuth>} />
    <Route path="/tasks" element={<RequireAuth><Tasks /></RequireAuth>} />
    <Route path="/tasks/:id" element={<RequireAuth><TaskDetail /></RequireAuth>} />
    <Route path="/processes" element={<RequireAuth><Processes /></RequireAuth>} />
    <Route path="/processes/:id" element={<RequireAuth><ProcessDetail /></RequireAuth>} />
    <Route path="/processes/upload" element={<RequireAuth><ProcessUpload /></RequireAuth>} />
    <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
    <Route path="/history" element={<RequireAuth><Navigate to="/tasks" replace /></RequireAuth>} />
    <Route path="*" element={<RequireAuth><NotFound /></RequireAuth>} />
  </Routes>
);

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" storageKey="tenda-theme">
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
