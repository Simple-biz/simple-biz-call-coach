import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('❌ [ErrorBoundary] Caught error:', error.message, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <p className="font-semibold">AI Tips failed to load</p>
          <p className="mt-1 text-red-500">{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}