import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Cancel01Icon, Globe02Icon, ComputerIcon } from "@hugeicons/core-free-icons";
import { I, IS_MAC, Spark } from "./Panel";
import "./panel.css";


const ease = [0.23, 1, 0.32, 1] as const;
const HEIGHT = 404;

const POINTS = (mac: boolean) => [
  { icon: ComputerIcon, title: mac ? "Lives in your menu bar" : "Lives in your system tray", text: "Click its icon any time to see what is running." },
  { icon: Cancel01Icon, title: "Stop any server", text: "One click on a row, or ⌫ on the selected one." },
  { icon: Globe02Icon, title: "Share a public link", text: "Through a Cloudflare Tunnel, with no account." },
];

export function Onboarding({ onDone, resize }: { onDone: () => void; resize: (height: number) => void }) {
  const reduce = useReducedMotion();
  useEffect(() => resize(HEIGHT), [resize]);

  const item = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 8, filter: "blur(3px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.4, ease, delay: 0.06 + i * 0.07 },
  });

  return (
    <div className={`sp-panel sp-welcome ${IS_MAC ? "is-mac" : ""}`}>
      <motion.span className="sp-welcome-mark" {...item(0)}>
        <Spark size={26} />
      </motion.span>
      <motion.h1 className="sp-welcome-title" {...item(1)}>
        Welcome to Roulette
      </motion.h1>
      <motion.p className="sp-welcome-sub" {...item(2)}>
        Every dev server running on this computer, in one small panel.
      </motion.p>
      <ul className="sp-welcome-list">
        {POINTS(IS_MAC).map((p, i) => (
          <motion.li key={p.title} className="sp-welcome-point" {...item(3 + i)}>
            <span className="sp-welcome-icon">
              <I icon={p.icon} size={15} />
            </span>
            <span className="sp-welcome-copy">
              <span className="sp-welcome-point-title">{p.title}</span>
              <span className="sp-welcome-point-text">{p.text}</span>
            </span>
          </motion.li>
        ))}
      </ul>
      <motion.button type="button" className="sp-welcome-go" onClick={onDone} {...item(6)}>
        Get started
      </motion.button>
    </div>
  );
}
