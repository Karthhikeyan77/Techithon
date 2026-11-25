import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Unexpected application error' };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#111E31] border border-[#FF6B78]/30 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#FF6B78]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Something went wrong</h2>
            </div>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
