import { useEffect } from "react";
import { useLocation, useNavigate } from "@/router";
import { CheckSquare, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

type LocationState = {
  from?: { pathname: string };
};

export default function Login() {
  const { isAuthenticated, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const redirectPath = state?.from?.pathname || "/tasks";

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate(redirectPath, { replace: true });
    }
  }, [loading, isAuthenticated, navigate, redirectPath]);

  return (
    <div className="min-h-screen bg-background">
      <div className="relative isolate min-h-screen overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(14,116,144,0.25),_transparent_50%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(15,23,42,0.7),_rgba(15,23,42,0.2))]" />

        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
          <div className="w-full max-w-5xl grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-primary/30 bg-card/60 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Secure sign-in with Keycloak
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CheckSquare className="h-10 w-10 text-primary" />
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">Tenda</h1>
                </div>
                <p className="text-lg text-muted-foreground">
                  Manage tasks, track processes, and advance workflows with full auditability.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-card/60 p-4 backdrop-blur">
                  <p className="text-sm font-medium text-foreground">SSO + PKCE</p>
                  <p className="text-sm text-muted-foreground">Modern OAuth flow for secure browser auth.</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-card/60 p-4 backdrop-blur">
                  <p className="text-sm font-medium text-foreground">Bearer API</p>
                  <p className="text-sm text-muted-foreground">All requests signed with refreshed JWTs.</p>
                </div>
              </div>
            </div>

            <Card className="border-border/70 bg-card/80 shadow-xl backdrop-blur">
              <CardHeader>
                <CardTitle>Sign in to continue</CardTitle>
                <CardDescription>
                  You will be redirected to Keycloak to authenticate.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => login()}
                  disabled={loading}
                >
                  {loading ? "Connecting..." : "Sign in with Keycloak"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  By signing in, you agree to your organization’s access policies.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
