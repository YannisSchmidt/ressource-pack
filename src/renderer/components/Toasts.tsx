import { useApp, useStore } from '../store';
import { IconCheck, IconClose, IconInfo, IconWarning } from '../icons';

export function Toasts() {
  const state = useApp();
  const store = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {state.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span className="toast-icon">
            {toast.type === 'success' ? (
              <IconCheck size={16} />
            ) : toast.type === 'error' || toast.type === 'warning' ? (
              <IconWarning size={16} />
            ) : (
              <IconInfo size={16} />
            )}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="icon-btn tiny" onClick={() => store.dismissToast(toast.id)} aria-label="Fermer">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
