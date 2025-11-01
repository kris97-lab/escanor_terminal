"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomNav.module.css";

const tabs = [
  { href: "/feed", label: "Feed", icon: "📰" },
  { href: "/trade", label: "Trade", icon: "⚡" },
  { href: "/signals", label: "Signals", icon: "📡" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        const className = isActive ? `${styles.item} ${styles.active}` : styles.item;

        return (
          <Link key={tab.href} href={tab.href} className={className}>
            <span className={styles.icon}>{tab.icon}</span>
            <span className={styles.label}>{tab.label}</span>
            {isActive && <span className={styles.indicator} aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
