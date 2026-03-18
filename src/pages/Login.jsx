import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useRef } from "react";

export default function Login({ onLogin }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [useMagic, setUseMagic] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [scannerOpen, setScannerOpen] = useState(false);
    const [pendingQrToken, setPendingQrToken] = useState("");
    const [qrPin, setQrPin] = useState("");
    const [qrPinOpen, setQrPinOpen] = useState(false);
    const [qrPinBusy, setQrPinBusy] = useState(false);
    const navigate = useNavigate();

    // Detect magic-link sessions automatically
    useEffect(() => {
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                onLogin?.(session.user);
                navigate("/dashboard", { replace: true });
            }
        });
        return () => listener.subscription.unsubscribe();
    }, [navigate, onLogin]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);

        try {
            if (useMagic) {
                const { error } = await supabase.auth.signInWithOtp({
                    email,
                    options: {
                        // Redirect back to this app (works for dev and prod)
                        emailRedirectTo: `${window.location.origin}/login`,
                    },
                });
                if (error) throw error;
                setMessage("Magic link sent! Check your email.");
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error?.message?.includes("Invalid login credentials please contact admin")) {
                    // handled by admin
                } else if (error) {
                    throw error;
                } else if (data?.user) {
                    setMessage("Signed in successfully!");
                    onLogin?.(data.user);
                    navigate("/dashboard", { replace: true });
                }
            }
        } catch (err) {
            setMessage("Error: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const redeemQrToken = async (token, pin = "") => {
        setQrPinBusy(true);
        try {
            const response = await fetch('/api/redeemQrLogin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    pin,
                    origin: window.location.origin,
                }),
            });
            const parsed = await readApiResponse(response);
            const result = parsed.data || { rawText: parsed.text };
            if (!response.ok) {
                if (result?.code === 'PIN_REQUIRED') {
                    setPendingQrToken(token);
                    setQrPin("");
                    setQrPinOpen(true);
                    setMessage("PIN required for this score_taker QR login.");
                    return;
                }
                if (result?.code === 'INVALID_PIN') {
                    setPendingQrToken(token);
                    setQrPinOpen(true);
                    setMessage("Incorrect PIN. Try again.");
                    return;
                }
                throw new Error(getApiErrorMessage(result, 'Failed to redeem QR login.'));
            }
            setMessage("Opening QR login link...");
            setQrPinOpen(false);
            setPendingQrToken("");
            window.location.assign(result.actionLink);
        } catch (err) {
            setMessage("Error: " + (err?.message || 'Failed to redeem QR login.'));
        } finally {
            setQrPinBusy(false);
        }
    };

    const handleQrDetected = (rawCode) => {
        const payload = parseQrLoginPayload(rawCode);
        if (!payload) {
            setMessage("Error: Invalid QR login code.");
            setScannerOpen(false);
            return;
        }
        setScannerOpen(false);
        if (payload.kind === 'action_link') {
            setMessage("Opening QR login link...");
            window.location.assign(payload.value);
            return;
        }
        setMessage("Checking QR login...");
        redeemQrToken(payload.value);
    };

    return (
        <>
            <div className="flex justify-center items-center h-[80vh]">
                <form
                    onSubmit={handleSubmit}
                    className="p-6 w-[360px] bg-white border rounded shadow space-y-4"
                >
                    <div className="flex flex-col items-center gap-2 mb-1">
                        <img src="/iconsmall.png" alt="NAPFA5" className="w-10 h-10" />
                        <h1 className="text-xl font-bold text-center">NAPFA5 Login</h1>
                    </div>

                    <input
                        type="email"
                        required
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="border rounded w-full p-2"
                    />

                    {!useMagic && (
                        <input
                            type="password"
                            required
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="border rounded w-full p-2"
                        />
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-blue-600 text-white rounded w-full py-2 hover:bg-blue-700"
                    >
                        {loading
                            ? "Please wait..."
                            : useMagic
                                ? "Send Magic Link"
                                : "Sign In"}
                    </button>

                    <button
                        type="button"
                        onClick={() => setScannerOpen(true)}
                        className="border rounded w-full py-2 hover:bg-slate-50"
                    >
                        Scan QR Login
                    </button>

                    <div className="text-xs text-center text-gray-500">
                        QR login is intended for score_taker and viewer accounts generated by an admin.
                    </div>

                    <button
                        type="button"
                        onClick={() => setUseMagic(!useMagic)}
                        className="text-sm text-blue-700 underline w-full"
                    >
                        {useMagic ? "Use password login" : "Use magic link instead"}
                    </button>

                    <button
                        type="button"
                        onClick={async () => {
                            if (!email) return setMessage("Please enter your email first.");
                            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                                redirectTo: `${window.location.origin}/change-password`,
                            });
                            if (error) setMessage("Error: " + error.message);
                            else setMessage("Password reset link sent to your email.");
                        }}
                        className="text-sm text-blue-700 underline w-full"
                    >
                        Forgot password?
                    </button>

                    {message && (
                        <p className="text-sm text-center text-gray-700 whitespace-pre-wrap">
                            {message}
                        </p>
                    )}
                </form>
            </div>

            {scannerOpen && (
                <ScannerModal
                    onClose={() => setScannerOpen(false)}
                    onDetected={handleQrDetected}
                />
            )}

            {qrPinOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
                    <div className="bg-white rounded shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-2 border-b flex items-center justify-between">
                            <div className="font-medium">Enter PIN</div>
                            <button className="px-2 py-1 border rounded" onClick={() => { setQrPinOpen(false); setPendingQrToken(""); setQrPin(""); }}>Close</button>
                        </div>
                        <form
                            className="p-4 space-y-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                redeemQrToken(pendingQrToken, qrPin);
                            }}
                        >
                            <div className="text-sm text-gray-700">This reusable QR belongs to a score_taker account. Enter the 6-digit PIN to continue.</div>
                            <input
                                type="password"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                value={qrPin}
                                onChange={(e) => setQrPin(String(e.target.value || "").replace(/\D/g, "").slice(0, 6))}
                                className="border rounded w-full p-2 tracking-[0.35em] text-center"
                                placeholder="6-digit PIN"
                                autoFocus
                            />
                            <div className="flex items-center justify-end gap-2">
                                <button type="button" onClick={() => { setQrPinOpen(false); setPendingQrToken(""); setQrPin(""); }} className="px-3 py-2 border rounded hover:bg-gray-50">Cancel</button>
                                <button type="submit" disabled={qrPinBusy || qrPin.length !== 6} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                                    {qrPinBusy ? 'Checking...' : 'Continue'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}

async function readApiResponse(response) {
    const text = await response.text();
    try {
        return { data: JSON.parse(text), text };
    } catch {
        return { data: null, text };
    }
}

function getApiErrorMessage(payload, fallback) {
    const apiMessage = payload?.error || payload?.message;
    if (apiMessage) return apiMessage;
    const text = String(payload?.rawText || "").trim();
    if (text) return `${fallback} Server returned non-JSON content.`;
    return fallback;
}

function parseQrLoginPayload(rawCode) {
    const value = String(rawCode || "").trim();
    if (!value) return null;

    try {
        const url = new URL(value);
        if (url.protocol === "http:" || url.protocol === "https:") return { kind: "action_link", value: url.toString() };
        if (url.protocol === "napfa5-login:") {
            const token = url.searchParams.get("token");
            if (token) return { kind: "token", value: token };
            const nested = url.searchParams.get("link");
            if (!nested) return null;
            const nestedUrl = new URL(nested);
            if (nestedUrl.protocol === "http:" || nestedUrl.protocol === "https:") return { kind: "action_link", value: nestedUrl.toString() };
        }
    } catch {}

    if (/^napfa5qr_[a-f0-9]+$/i.test(value)) return { kind: "token", value };
    return null;
}

function ScannerModal({ onClose, onDetected }) {
    const CAMERA_PREF_KEY = "scanner_camera_pref_login";
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const controlsRef = useRef(null);
    const onDetectedRef = useRef(onDetected);
    const [supported, setSupported] = useState(true);
    const [err, setErr] = useState("");
    const [facingMode, setFacingMode] = useState(() => {
        try {
            const raw = localStorage.getItem(CAMERA_PREF_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            if (saved?.mode === "user" || saved?.mode === "environment") return saved.mode;
        } catch {}
        const ua = String(navigator?.userAgent || "").toLowerCase();
        const coarse = typeof window?.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
        return (coarse || /android|iphone|ipad|ipod|mobile/.test(ua)) ? "environment" : "user";
    });
    const [preferredDeviceId, setPreferredDeviceId] = useState(() => {
        try {
            const raw = localStorage.getItem(CAMERA_PREF_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            return saved?.deviceId || "";
        } catch {}
        return "";
    });
    const [activeCameraId, setActiveCameraId] = useState("");

    useEffect(() => {
        onDetectedRef.current = onDetected;
    }, [onDetected]);

    useEffect(() => {
        try {
            localStorage.setItem(CAMERA_PREF_KEY, JSON.stringify({ mode: facingMode, deviceId: preferredDeviceId || "" }));
        } catch {}
    }, [facingMode]);

    const stopActiveMedia = () => {
        if (controlsRef.current) {
            try { controlsRef.current.stop(); } catch {}
            controlsRef.current = null;
        }
        if (streamRef.current) {
            try { streamRef.current.getTracks().forEach((track) => track.stop()); } catch {}
            streamRef.current = null;
        }
        if (videoRef.current) {
            try { videoRef.current.pause(); videoRef.current.srcObject = null; } catch {}
        }
    };

    const pickDeviceForMode = (devices, mode, currentId) => {
        if (!Array.isArray(devices) || devices.length === 0) return null;
        const list = devices.filter((device) => device && device.kind === "videoinput");
        if (!list.length) return null;
        const norm = (text) => String(text || "").toLowerCase();
        const backWords = ["back", "rear", "environment", "world"];
        const frontWords = ["front", "user", "facetime"];
        const wanted = mode === "user" ? frontWords : backWords;
        const match = list.find((device) => wanted.some((word) => norm(device.label).includes(word)));
        if (match) return match;
        const other = list.find((device) => device.deviceId && device.deviceId !== currentId);
        if (other) return other;
        return list[0];
    };

    useEffect(() => {
        let cleanupFn = null;
        let cancelled = false;
        const hasBarcode = "BarcodeDetector" in window;

        const start = async () => {
            try {
                setErr("");
                stopActiveMedia();
                await new Promise((resolve) => setTimeout(resolve, 120));

                const candidates = [];
                if (preferredDeviceId) candidates.push({ deviceId: { exact: preferredDeviceId } });
                candidates.push({ facingMode: { exact: facingMode } });
                candidates.push({ facingMode });
                candidates.push(true);

                let stream = null;
                let resolvedDeviceId = preferredDeviceId || "";
                const candidateErrors = [];
                for (const video of candidates) {
                    try {
                        stream = await navigator.mediaDevices.getUserMedia({ video });
                        break;
                    } catch (openErr) {
                        const hint = typeof video === "boolean"
                            ? "default"
                            : (video?.deviceId ? "deviceId" : (video?.facingMode ? "facingMode" : "video"));
                        candidateErrors.push(`${hint}: ${openErr?.name || "Error"} ${openErr?.message || ""}`.trim());
                    }
                }

                if (!stream) throw new Error(candidateErrors.join(" | ") || "Camera unavailable.");
                if (cancelled) {
                    try { stream.getTracks().forEach((track) => track.stop()); } catch {}
                    return;
                }

                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }

                try {
                    const track = stream.getVideoTracks?.()[0];
                    const activeId = track?.getSettings?.()?.deviceId;
                    setActiveCameraId(activeId || "");
                    if (activeId) {
                        setPreferredDeviceId(activeId);
                        resolvedDeviceId = activeId;
                        try {
                            localStorage.setItem(CAMERA_PREF_KEY, JSON.stringify({ mode: facingMode, deviceId: activeId }));
                        } catch {}
                    }
                } catch {}

                if (hasBarcode) {
                    setSupported(true);
                    const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39"] });
                    const tick = async () => {
                        if (cancelled) return;
                        try {
                            const frame = await detector.detect(videoRef.current);
                            if (frame && frame.length > 0) {
                                const value = frame[0].rawValue;
                                if (value) onDetectedRef.current?.(value);
                                return;
                            }
                        } catch {}
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                    cleanupFn = () => { cancelled = true; };
                } else {
                    try {
                        const { BrowserMultiFormatReader } = await import("@zxing/browser");
                        setSupported(true);
                        const codeReader = new BrowserMultiFormatReader();
                        const controls = await codeReader.decodeFromVideoDevice(resolvedDeviceId || null, videoRef.current, (result, _err, ctrl) => {
                            if (result) {
                                const value = result.getText();
                                if (value) {
                                    ctrl.stop();
                                    onDetectedRef.current?.(value);
                                }
                            }
                        });
                        controlsRef.current = controls;
                        cleanupFn = () => { try { controls.stop(); codeReader.reset(); } catch {} };
                    } catch {
                        setSupported(false);
                    }
                }
            } catch (e) {
                setErr(e?.message || "Camera unavailable.");
            }
        };

        start();
        return () => {
            cancelled = true;
            stopActiveMedia();
            if (typeof cleanupFn === "function") cleanupFn();
        };
    }, [facingMode]);

    const handleSwitchCamera = async () => {
        const nextMode = facingMode === "environment" ? "user" : "environment";
        try {
            if (navigator.mediaDevices?.enumerateDevices) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const target = pickDeviceForMode(devices, nextMode, activeCameraId || preferredDeviceId);
                if (target?.deviceId) setPreferredDeviceId(target.deviceId);
            }
        } catch {}
        setFacingMode(nextMode);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                    <div className="text-sm font-medium">Scan QR Login</div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close scanner">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="p-3 space-y-2">
                    {supported ? (
                        <div className="aspect-video bg-black rounded overflow-hidden">
                            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                        </div>
                    ) : (
                        <div className="text-sm text-gray-600">This browser does not support in-page barcode scanning. Please use Chrome or Edge.</div>
                    )}
                    {err && <div className="text-sm text-red-600">{err}</div>}
                    <div className="text-xs text-gray-500">Tip: Point the camera at the QR login code from Manage Users.</div>
                </div>
                <div className="px-3 py-2 border-t flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={handleSwitchCamera}
                        className="px-3 py-1.5 border rounded hover:bg-gray-50"
                    >
                        Switch Camera
                    </button>
                    <button onClick={onClose} className="px-3 py-1.5 border rounded hover:bg-gray-50">Close</button>
                </div>
            </div>
        </div>
    );
}

function IconBase({ children, className, ...rest }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            {...rest}
        >
            {children}
        </svg>
    );
}

function X(props) {
    return (
        <IconBase {...props}>
            <path d="M18 6L6 18M6 6l12 12" />
        </IconBase>
    );
}
