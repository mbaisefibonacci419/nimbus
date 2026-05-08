import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import '@fontsource-variable/inter';
import App from './App';
import './styles/globals.css';

// Remove Syncfusion trial license banners injected into the DOM
function removeLicenseBanners() {
  document.querySelectorAll('div').forEach((el) => {
    if (el.textContent?.includes('Syncfusion') && el.textContent?.includes('license')) {
      el.remove();
    }
  });
}
const observer = new MutationObserver(removeLicenseBanners);
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(removeLicenseBanners, 100);
setTimeout(removeLicenseBanners, 1000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: '#1C1C1F',
            border: '1px solid #2C2C31',
            color: '#E2E8F0',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
