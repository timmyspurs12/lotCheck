import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LotCheck render error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="fatal-error-shell" role="alert">
        <div className="fatal-error-icon"><AlertTriangle size={22} /></div>
        <div className="eyebrow">APPLICATION ERROR</div>
        <h1>LotCheck could not render this view.</h1>
        <p>No review outcome has been inferred. Reload the application to continue.</p>
        <button className="button button-secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={14} />Reload application</button>
      </main>
    );
  }
}
