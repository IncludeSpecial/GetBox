import { Component, type ErrorInfo, type ReactNode } from 'react';
import logoUrl from '../../data/logo.svg';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[GetBox] render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-screen boot-error">
          <img className="boot-logo" src={logoUrl} alt="" width={64} height={64} />
          <h1>GetBox</h1>
          <p className="boot-error-title">Ошибка интерфейса</p>
          <p className="boot-error-detail">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
