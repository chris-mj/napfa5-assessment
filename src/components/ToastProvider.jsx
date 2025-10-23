import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
    const [toast, setToast] = useState(null);
    const timeoutRef = useRef(null);

    const dismissToast = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setToast(null);
    }, []);

    const showToast = useCallback((type, message, options = {}) => {
        const duration = options.duration ?? 4000;
        dismissToast();
        setToast({ type, message });
        timeoutRef.current = setTimeout(() => {
            dismissToast();
        }, duration);
    }, [dismissToast]);

    const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            {toast && (
                <div
                    className={`fixed bottom-6 right-6 px-4 py-2 rounded shadow-lg text-white ${
                        toast.type === "error"
                            ? "bg-red-600"
                            : toast.type === "success"
                            ? "bg-green-600"
                            : "bg-gray-800"
                    }`}
                    style={{ zIndex: 60 }}
                >
                    {toast.message}
                </div>
            )}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}
