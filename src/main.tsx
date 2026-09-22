import React from 'react';
import ReactDOM from 'react-dom/client';
import {App} from './App';

// Tailwind first, then the Red Moon layer — so the brand styles always win
// over utility defaults without needing !important.
import './index.css';
import './styles/tokens.css';
import './styles/editorial.css';
import './styles/hero.css';
import './styles/starfield.css';
import './styles/loader.css';
import './styles/chrome.css';
import './styles/premium.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>
);
