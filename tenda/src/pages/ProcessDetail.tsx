import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "@/router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { apiClient, ProcessDefinition } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ApiErrorToast } from "@/components/ApiErrorToast";
import { BpmnViewer } from "@/components/BpmnViewer";

interface ProcessDetailData extends ProcessDefinition {
  bpmnXml: string;
}

export default function ProcessDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [process, setProcess] = useState<ProcessDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProcess = useCallback(
    async (processId: string) => {
      setLoading(true);
      try {
        // We need a new API method to get the full definition with XML
        // For now, we'll assume it exists and is called getProcessDefinition
        const response = await apiClient.getProcessDefinition(processId);
        if (response.data) {
          setProcess(response.data as ProcessDetailData);
        } else {
          toast(
            ApiErrorToast({
              error: response.error,
              defaultMessage: "Failed to fetch process details",
            }),
          );
        }
      } catch (error) {
        toast(
          ApiErrorToast({
            error: error,
            defaultMessage: "Failed to fetch process details",
          }),
        );
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (id) {
      fetchProcess(id);
    }
  }, [id, fetchProcess]);

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <p className="text-muted-foreground">Loading process diagram...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!process) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <p className="text-muted-foreground">Process not found</p>
            <Button onClick={() => navigate("/processes")} className="mt-4">
              Back to Processes
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-screen">
        <header className="flex-shrink-0 border-b border-border bg-card">
          <div className="flex h-16 items-center justify-between px-6">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" onClick={() => navigate("/processes")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Processes
              </Button>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {process.name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {process.documentation || "No documentation available."}
                </p>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 bg-background">
          <BpmnViewer xml={process.bpmnXml} />
        </main>
      </div>
    </Layout>
  );
}
