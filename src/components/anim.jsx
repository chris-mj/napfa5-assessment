import React from "react";
import { AnimatePresence, motion } from "framer-motion";

export function FadeSlideDown({ show, className = "", children, duration = 0.24 }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="fsd"
          initial={{ opacity: 0, height: 0, y: -12, scaleY: 0.98, originY: 0 }}
          animate={{ opacity: 1, height: "auto", y: 0, scaleY: 1 }}
          exit={{ opacity: 0, height: 0, y: -12, scaleY: 0.98 }}
          transition={{ duration, ease: "easeOut" }}
          className={(className || "") + " overflow-hidden"}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CollapseDown({ open, className = "", children, duration = 0.22 }) {
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0, y: open ? 0 : -8, scaleY: open ? 1 : 0.98 }}
      transition={{ duration, ease: "easeOut" }}
      className={(className || "") + " overflow-hidden"}
    >
      {children}
    </motion.div>
  );
}

export function MotionSection({ children, className = "", duration = 0.22 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

