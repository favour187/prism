import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import OverlayApp from './OverlayApp.jsx';
import 'highlight.js/styles/github-dark.css';
import './styles.css';

const stored = localStorage.getItem('prism.theme');
const theme = stored ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.dataset.theme = theme;

// The Electron shell loads ?overlay=1: a compact always-on-top assistant panel.
const overlayMode =
  new URLSearchParams(window.location.search).has('overlay') || Boolean(window.prismDesktop?.isDesktop);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{overlayMode ? <OverlayApp /> : <App />}</React.StrictMode>,
);
