import React, { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("❌ [ErrorBoundary] React error caught:", error, errorInfo);
  }

  handleReset = () => {
    // Clear any corrupted state
    chrome.storage.local.remove(["callStoreState"], () => {
      this.setState({ hasError: false, error: null });
      window.location.reload();
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-80 h-[500px] bg-[#EFF3F6] text-[#333333] flex flex-col items-center justify-center p-6">
          <div className="p-4 bg-[#D0021B]/10 rounded-full mb-4">
            <AlertTriangle className="w-12 h-12 text-[#D0021B]" />
          </div>

          <h2 className="text-xl font-bold mb-2">Something Went Wrong</h2>

          <p className="text-sm text-[#757575] text-center mb-6">
            The extension encountered an error. Don't worry, your data is safe.
          </p>

          <button
            onClick={this.handleReset}
            className="w-full py-3 px-4 bg-[#1B1F6B] hover:bg-[#14174f] text-white font-semibold rounded-lg transition-all duration-200"
          >
            Reset Extension
          </button>

          {this.state.error && (
            <details className="mt-4 w-full">
              <summary className="text-xs text-[#757575] cursor-pointer hover:text-[#333333]">
                Technical Details
              </summary>
              <pre className="mt-2 text-xs text-[#D0021B] bg-white p-3 rounded border border-[#dddddd] overflow-auto max-h-32">
                {this.state.error.toString()}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
