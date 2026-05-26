import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { registerLicense } from '@syncfusion/ej2-base';
import '@fontsource-variable/inter';
import App from './App';
import { useThemeStore } from './store/themeStore';
import './styles/globals.css';

const sfKey = import.meta.env.VITE_SYNCFUSION_LICENSE_KEY;
if (sfKey) registerLicense(sfKey);

function removeSyncfusionOverlays() {
  document.querySelectorAll('div, span, a, iframe').forEach((el) => {
    const text = el.textContent ?? '';
    const html = el instanceof HTMLElement ? el.innerHTML : '';
    const isLicensePopup =
      (text.includes('Syncfusion') && (text.includes('license') || text.includes('claim') || text.includes('trial'))) ||
      html.includes('syncfusion.com/account') ||
      html.includes('claim-license-key') ||
      el.classList?.contains('e-license') ||
      el.classList?.contains('e-license-banner') ||
      el.classList?.contains('e-dlg-container') ||
      el.classList?.contains('e-dlg-overlay');
    if (isLicensePopup) el.remove();
  });

  document.querySelectorAll<HTMLElement>('body > div').forEach((el) => {
    const style = el.getAttribute('style') ?? '';
    if (
      (style.includes('position: fixed') || style.includes('position:fixed')) &&
      (style.includes('z-index') || style.includes('background'))
    ) {
      const text = el.textContent ?? '';
      if (text.includes('Syncfusion') || text.includes('claim') || text.includes('license') || text.includes('FREE account')) {
        el.remove();
      }
    }
  });
}

const observer = new MutationObserver(removeSyncfusionOverlays);
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(removeSyncfusionOverlays, 0);
setTimeout(removeSyncfusionOverlays, 100);
setTimeout(removeSyncfusionOverlays, 500);
setTimeout(removeSyncfusionOverlays, 1000);
setTimeout(removeSyncfusionOverlays, 3000);

function ThemedToaster() {
  const mode = useThemeStore((s) => s.mode);
  const isDark = mode === 'dark';
  return (
    <Toaster
      position="top-right"
      theme={mode}
      toastOptions={{
        style: {
          background: isDark ? '#1C1C1F' : '#FAFBFC',
          border: `1px solid ${isDark ? '#2C2C31' : '#D8D9DE'}`,
          color: isDark ? '#E2E8F0' : '#18181B',
        },
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <ThemedToaster />
    </BrowserRouter>
  </React.StrictMode>,
);
