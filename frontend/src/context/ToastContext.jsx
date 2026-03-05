import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext({
  showSuccess: () => {},
  showError: () => {},
  showInfo: () => {},
});

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((toast) => {
    const id = ++idCounter;
    setToasts((list) => [...list, { id, ...toast }]);
    const timeout = toast.timeout ?? 4000;
    if (timeout > 0) {
      setTimeout(() => remove(id), timeout);
    }
  }, [remove]);

  const showSuccess = useCallback((message) => add({ message, type: 'success' }), [add]);
  const showError = useCallback((message) => add({ message, type: 'error' }), [add]);
  const showInfo = useCallback((message) => add({ message, type: 'info' }), [add]);

  const value = useMemo(
    () => ({ showSuccess, showError, showInfo }),
    [showSuccess, showError, showInfo]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-3 max-w-sm w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm text-sm ${
              t.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : t.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex-1">{t.message}</div>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="ml-2 text-xs text-slate-500 hover:text-slate-700"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

