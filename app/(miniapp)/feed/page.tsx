"use client";

import styles from "../layout.module.css";
import localStyles from "./page.module.css";
import { useMiniAppContext } from "../MiniAppProvider";

const activityFeed = [
  {
    trader: "0xFury",
    action: "Longed ETH",
    size: "$42,500",
    timestamp: "2m ago",
    confidence: 92,
  },
  {
    trader: "Aria",
    action: "Opened SOL signal",
    size: "$18,200",
    timestamp: "6m ago",
    confidence: 88,
  },
  {
    trader: "DeltaOne",
    action: "Exited BTC short",
    size: "$95,300",
    timestamp: "12m ago",
    confidence: 76,
  },
];

const pulseMetrics = [
  { label: "Live Signals", value: "12", trend: "+3" },
  { label: "Volume", value: "$1.8M", trend: "+12%" },
  { label: "Hit Rate", value: "68%", trend: "+5%" },
];

export default function FeedPage() {
  const { context } = useMiniAppContext();
  const displayName = context?.user.displayName || context?.user.username || "Operator";

  return (
    <div className={`${styles.page} ${localStyles.page}`}>
      <header className={localStyles.hero}>
        <span className={styles.badge}>Live Terminal</span>
        <h1 className={localStyles.title}>
          Welcome back, <span className={styles.accent}>{displayName}</span>
        </h1>
        <p className={localStyles.subtitle}>
          Track real-time positions, copy elite traders, and never miss a high-confidence signal again.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Market Pulse</h2>
          <span className={styles.caption}>Synchronized with Farcaster data stream</span>
        </div>
        <div className={styles.grid}>
          {pulseMetrics.map((metric) => (
            <div key={metric.label} className={localStyles.metricTile}>
              <span className={localStyles.metricLabel}>{metric.label}</span>
              <div className={styles.metric}>
                <span className={styles.metricValue}>{metric.value}</span>
                <span className={styles.metricLabel}>{metric.trend}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Escanor Feed</h2>
          <span className={styles.caption}>Latest fills and signal drops</span>
        </div>
        <div className={styles.list}>
          {activityFeed.map((item) => (
            <article key={item.trader + item.timestamp} className={styles.listItem}>
              <div className={styles.listItemPrimary}>
                <span>
                  <span className={styles.accent}>{item.trader}</span> {item.action}
                </span>
                <span className={styles.listItemSecondary}>{item.timestamp}</span>
              </div>
              <div className={localStyles.listMetrics}>
                <span className={localStyles.size}>{item.size}</span>
                <span className={localStyles.confidence}>Conf. {item.confidence}%</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
