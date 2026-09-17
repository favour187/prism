import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import OverlayApp from './OverlayApp.jsx';
import WriteBarApp from './WriteBarApp.jsx';
import 'highlight.js/styles/github-dark.css';
import './styles.css';

const stored = localStorage.getItem('prism.theme');
const theme = stored ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.dataset.theme = theme;

const params = new URLSearchParams(window.location.search);
const writebarMode = params.has('writebar');
const overlayMode = !writebarMode && (params.has('overlay') || Boolean(window.prismDesktop?.isDesktop));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {writebarMode ? <WriteBarApp /> : overlayMode ? <OverlayApp /> : <App />}
  </React.StrictMode>,
);
