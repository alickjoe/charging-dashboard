import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration: number = 5) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, message }]);
    const timer = setTimeout(() => removeToast(id), duration * 1000);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  const success = useCallback((message: string, duration?: number) => {
    addToast('success', message, duration);
  }, [addToast]);

  const error = useCallback((message: string, duration?: number) => {
    addToast('error', message, duration);
  }, [addToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
    };
  }, []);

  const toastContainer = toasts.length > 0 ? createPortal(
    <div style={{
      position: 'fixed',
      top: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1010,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: 'center',
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            padding: '10px 24px',
            borderRadius: 6,
            background: toast.type === 'success' ? '#52c41a' : '#ff4d4f',
            color: '#fff',
            fontSize: 14,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            pointerEvents: 'auto',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onClick={() => removeToast(toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      {toastContainer}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}
