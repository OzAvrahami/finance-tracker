import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/tokens.css'
import './index.css'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './components/ui'

// This dev-only route has no AuthProvider, Supabase client or live API access.
// It uses the normal app's shared theme/UI while keeping preview IO isolated.
const shoppingPreview = import.meta.env.DEV && import.meta.env.VITE_SHOPPING_ADMIN_PREVIEW === '1'
  && window.location.pathname === '/__shopping-preview';
async function start() {
  let content;
  if (import.meta.env.DEV && import.meta.env.VITE_SHOPPING_ADMIN_INTEGRATION === '1' && window.location.pathname === '/__shopping-integration') {
    if (new URL(import.meta.env.VITE_SUPABASE_URL).origin !== window.location.origin || import.meta.env.VITE_API_URL !== '/api') {
      throw new Error('Isolated Shopping integration requires same-origin local authentication and API');
    }
    const { default: Integration } = await import('./features/shopping/settings/ShoppingIntegration');
    content = <Integration />;
  } else if (shoppingPreview) {
    const { default: Preview } = await import('./features/shopping/settings/ShoppingCatalogAdmin');
    content = <Preview />;
  } else {
    const [{ default: App }, { AuthProvider }] = await Promise.all([import('./App.jsx'), import('./context/AuthContext')]);
    content = <AuthProvider><App /></AuthProvider>;
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        {content}
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
}
start();
