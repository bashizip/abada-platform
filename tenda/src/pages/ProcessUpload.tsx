import { useState, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, CheckCircle, Eye } from 'lucide-react';
import { Link, useNavigate } from "@/router";
import { apiClient } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { ApiErrorToast } from '@/components/ApiErrorToast';

export default function ProcessUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [deployedProcess, setDeployedProcess] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.name.endsWith('.bpmn') || selectedFile.name.endsWith('.xml')) {
        setFile(selectedFile);
        setUploaded(false);
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file type",
          description: "Please select a BPMN (.bpmn) or XML (.xml) file",
        });
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      if (droppedFile.name.endsWith('.bpmn') || droppedFile.name.endsWith('.xml')) {
        setFile(droppedFile);
        setUploaded(false);
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file type",
          description: "Please select a BPMN (.bpmn) or XML (.xml) file",
        });
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    try {
      const response = await apiClient.deployProcess(file);
      if (response.data?.status === 'Deployed') {
        setUploaded(true);
        setDeployedProcess(file.name);
        toast({
          title: "Process deployed successfully",
          description: `${file.name} has been deployed`,
        });
      } else {
        toast(ApiErrorToast({ error: response.error, defaultMessage: "Failed to deploy process" }));
      }
    } catch (error) {
      toast(ApiErrorToast({ error: error, defaultMessage: "Failed to upload the process file" }));
    } finally {
      setUploading(false);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-8">
          <div className="flex items-center space-x-4 mb-4">
            <Link to="/processes">
              <Button variant="ghost">← Back</Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-foreground">Upload New Process</h1>
          <p className="text-muted-foreground mt-1">
            Deploy a new process by uploading its BPMN 2.0 file.
          </p>
        </div>

        <div className="space-y-6">
          {/* Upload Area */}
          <Card>
            <CardContent className="p-8">
              <div
                className="border-2 border-dashed border-border rounded-lg p-12 text-center hover:border-primary/50 transition-colors"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-info/10">
                  <Upload className="h-8 w-8 text-info" />
                </div>
                
                <h3 className="text-lg font-semibold mb-2">
                  Drag and drop your BPMN file here
                </h3>
                <p className="text-muted-foreground mb-4">or</p>
                
                <Button variant="outline" className="cursor-pointer" onClick={handleBrowseClick}>
                  Browse Files
                </Button>
                <input
                  ref={fileInputRef}
                  id="file-upload"
                  type="file"
                  accept=".bpmn,.xml"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                {file && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <p className="font-medium">Selected file:</p>
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                    <Button
                      onClick={handleUpload}
                      disabled={uploading}
                      className="mt-3 bg-primary hover:bg-primary/90"
                    >
                      {uploading ? 'Uploading...' : 'Deploy Process'}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Success State */}
          {uploaded && deployedProcess && (
            <Card className="border-accent">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                    <CheckCircle className="h-6 w-6 text-accent-foreground" />
                  </div>
                  
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">Process Deployed Successfully</h3>
                    <p className="text-muted-foreground">
                      Your process '{deployedProcess}' has been successfully deployed.
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm" onClick={() => navigate('/processes')}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Processes
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upload Requirements</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• File must be in BPMN 2.0 format (.bpmn or .xml)</li>
                <li>• Maximum file size: 10MB</li>
                <li>• Process definition must include valid BPMN elements</li>
                <li>• Process key should be unique across all deployed processes</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
