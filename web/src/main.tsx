/**
 * @file 网页端入口：MUI 主题 + CssBaseline + HashRouter。
 *
 * 用 HashRouter 而不是 BrowserRouter：GitHub Pages 是静态托管，
 * 刷新 `/#/tester` 这种深链不会 404。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { HashRouter } from 'react-router-dom';

import App from './App';
import { theme } from './theme';
import './index.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('找不到 #root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </StrictMode>,
);
