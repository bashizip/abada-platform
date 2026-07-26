import React, { useEffect, type ReactNode } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "./router";
import { Layout } from "./components/Layout.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { InstanceList } from "./components/InstanceList.tsx";
import { InstanceDetail } from "./components/InstanceDetail.tsx";
import { JobList } from "./components/JobList.tsx";
import { Metrics } from "./components/Metrics.tsx";
import { AuthProvider } from "./components/AuthProvider";
import { useAuth } from "./hooks/useAuth";
import Login from "./pages/Login";

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, loading, isOrunAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated && location.pathname !== "/login") {
      navigate("/login", { replace: true, state: { from: location } });
      return;
    }

    if (
      !loading &&
      isAuthenticated &&
      !isOrunAdmin &&
      location.pathname !== "/login"
    ) {
      navigate("/login", { replace: true, state: { unauthorized: true } });
    }
  }, [loading, isAuthenticated, isOrunAdmin, location, navigate]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Signing you in...</div>;
  }

  if (!isAuthenticated || !isOrunAdmin) {
    return null;
  }

  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout>
                  <Dashboard />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/instances"
            element={
              <RequireAuth>
                <Layout>
                  <InstanceList />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/instances/:id"
            element={
              <RequireAuth>
                <Layout>
                  <InstanceDetail />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/jobs"
            element={
              <RequireAuth>
                <Layout>
                  <JobList />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="/metrics"
            element={
              <RequireAuth>
                <Layout>
                  <Metrics />
                </Layout>
              </RequireAuth>
            }
          />
          <Route
            path="*"
            element={
              <RequireAuth>
                <Navigate to="/" replace />
              </RequireAuth>
            }
          />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
