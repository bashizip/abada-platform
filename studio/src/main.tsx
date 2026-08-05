import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initKeycloak } from '@/auth/keycloakClient';

async function renderApp() {
  try {
    await initKeycloak();
  } catch (error) {
    console.error('Failed to initialize Keycloak:', error);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

renderApp();
