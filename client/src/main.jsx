import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import 'highlight.js/styles/github-dark.css';
import './styles.css';

const stored = localStorage.getItem('prism.theme');
const theme = stored ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.dataset.theme = theme;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
