import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppBootstrap } from './components/AppBootstrap';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TitleBar } from './components/TitleBar';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="app-root">
      <TitleBar />
      <div className="app-root-body">
        <ErrorBoundary>
          <AppBootstrap>
            <App />
          </AppBootstrap>
        </ErrorBoundary>
      </div>
    </div>
  </StrictMode>,
);
