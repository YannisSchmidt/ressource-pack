import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppStore, StoreProvider } from './store';

const container = document.getElementById('root');
if (!container) throw new Error('Élément racine introuvable.');

const store = new AppStore();

createRoot(container).render(
  <StoreProvider store={store}>
    <App />
  </StoreProvider>,
);
