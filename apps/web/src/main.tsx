import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
// Fonte do tema (bundlada, sem CDN): Inter.
import '@fontsource-variable/inter';
import App from './App';
import './index.css';

// Aplica o tema persistido (default: dark, definido no index.html).
const storedTheme = localStorage.getItem('wamux_theme');
if (storedTheme) {
  document.documentElement.classList.toggle('dark', storedTheme === 'dark');
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
