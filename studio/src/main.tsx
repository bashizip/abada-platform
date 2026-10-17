import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter is bundled instead of loaded from Google Fonts, so opening Studio
// makes no request outside the deployment.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'
import App from './App.tsx'
import { initKeycloak } from '@/auth/keycloakClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ToastContext';
import { MotionProvider } from '@/components/ui';
import { initSound } from '@/lib/sound';

async function renderApp() {
  initSound();
  try {
    await initKeycloak();
  } catch (error) {
    console.error('Failed to initialize Keycloak:', error);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <MotionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </MotionProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}

renderApp();
