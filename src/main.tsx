import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { loadUserData } from './services/userData';
import './styles/global.css';

// merge imports saved in this browser into the catalog before the first render
loadUserData();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
