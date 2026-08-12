import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled Studio UI error:', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-[#1A1614] text-[#EAE3D9] p-6">
          <div className="max-w-md rounded-2xl border border-[#E76F51]/40 bg-[#25201D] p-6 shadow-2xl text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#E76F51]/30 bg-[#E76F51]/10 text-[#E76F51]">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-[#EAE3D9] mb-2">Unexpected UI Error</h2>
            <p className="text-xs text-[#A89F91] mb-4">
              {this.state.error?.message || 'An unhandled rendering exception occurred in Abada Studio.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-xl bg-[#F4A261] px-4 py-2 text-sm font-semibold text-[#1A1614] hover:bg-[#e7924f] transition-all"
            >
              <RefreshCw className="h-4 w-4" /> Reload Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
