import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/style.css'; // HLAVNÍ CSS
import './styles/responsive.css'; // <--- ZDE JE NOVÝ IMPORT PRO RESPONZIVNÍ STYLY

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
