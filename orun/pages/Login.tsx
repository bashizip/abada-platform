import { useEffect } from "react";
import { useLocation, useNavigate } from "@/router";
import { ShieldCheck, Workflow } from "lucide-react";
import { Button, Card } from "@/components/ui/Common";
import { useAuth } from "@/hooks/useAuth";

type LocationState = {
  from?: { pathname: string };
  unauthorized?: boolean;
};

export default function Login() {
  const { isAuthenticated, loading, login, logout, isOrunAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const redirectPath = state?.from?.pathname || "/";
  const showUnauthorized =
    Boolean(state?.unauthorized) || (isAuthenticated && !isOrunAdmin);

  useEffect(() => {
    if (!loading && isAuthenticated && isOrunAdmin) {
      navigate(redirectPath, { replace: true });
    }
  }, [loading, isAuthenticated, isOrunAdmin, navigate, redirectPath]);

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="relative isolate min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.2),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(14,165,233,0.2),_transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(2,6,23,0.75),_rgba(15,23,42,0.35))]" />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
          <div className="w-full max-w-5xl grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-blue-400/40 bg-slate-900/60 px-4 py-2 text-sm text-slate-300 shadow-sm backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-blue-400" />
                Secure sign-in with Keycloak
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Workflow className="h-10 w-10 text-blue-400" />
                  <h1 className="text-4xl font-bold tracking-tight text-slate-100">
                    Orun
                  </h1>
                </div>
                <p className="text-lg text-slate-300">
                  Observe and operate live workflow instances with full control.
                </p>
              </div>
            </div>

            <Card className="border-slate-700 bg-slate-900/80 p-8 backdrop-blur">
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold text-slate-100">
                  Sign in to continue
                </h2>
                <p className="text-sm text-slate-400">
                  You will be redirected to Keycloak for authentication.
                </p>
                {showUnauthorized && (
                  <p className="text-sm text-amber-400">
                    Your account does not have access to Orun. The `orun-admin`
                    role is required.
                  </p>
                )}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => login()}
                  disabled={loading}
                >
                  {loading ? "Connecting..." : "Sign in with Keycloak"}
                </Button>
                {showUnauthorized && (
                  <Button
                    className="w-full"
                    size="lg"
                    variant="secondary"
                    onClick={() => logout()}
                  >
                    Sign out and switch account
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
