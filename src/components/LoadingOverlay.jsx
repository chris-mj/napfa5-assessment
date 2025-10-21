import { motion } from "framer-motion";

export default function LoadingOverlay() {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="fixed inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 text-white z-50"
        >
            {/* Logo / title animation */}
            <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="text-5xl font-bold tracking-wide mb-2"
            >
                NAPFA<span className="text-yellow-300">5</span>
            </motion.div>

            {/* Subtitle */}
            <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="text-sm tracking-wider uppercase text-gray-200"
            >
                Preparing your dashboard...
            </motion.p>

            {/* Pulsing dot loader */}
            <div className="flex gap-2 mt-6">
                {[0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        animate={{
                            opacity: [0.2, 1, 0.2],
                            y: [0, -6, 0],
                        }}
                        transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: i * 0.2,
                            ease: "easeInOut",
                        }}
                        className="w-3 h-3 bg-white rounded-full"
                    />
                ))}
            </div>
        </motion.div>
    );
}
