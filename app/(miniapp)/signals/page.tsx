import styles from "../layout.module.css";
import localStyles from "./page.module.css";

const signalDeck = [
  {
    pair: "ETH / USD",
    direction: "Long",
    entry: "$3,218",
    target: "$3,420",
    stop: "$3,120",
    confidence: 89,
    timeframe: "15m momentum",
  },
  {
    pair: "SOL / USD",
    direction: "Breakout",
    entry: "$165",
    target: "$182",
    stop: "$158",
    confidence: 83,
    timeframe: "1h channel",
  },
  {
    pair: "BTC / USD",
    direction: "Short",
    entry: "$89,450",
    target: "$86,900",
    stop: "$90,600",
    confidence: 72,
    timeframe: "4h exhaustion",
  },
];

const automation = [
  {
    label: "Auto Mirror",
    description: "Clone trades from your selected desks with custom sizing and slippage controls.",
  },
  {
    label: "Signal Alerts",
    description: "Push notifications when confidence exceeds your threshold or trend flips.",
  },
  {
    label: "Risk Guard",
    description: "Escanor auto-adjusts stops when volatility spikes or liquidity thins.",
  },
];

export default function SignalsPage() {
  return (
    <div className={`${styles.page} ${localStyles.page}`}>
      <header className={localStyles.header}>
        <span className={styles.badge}>Signal Hub</span>
        <h1 className={localStyles.title}>Live Strategies</h1>
        <p className={localStyles.subtitle}>
          Configure alerts, automate executions, and monitor actionable setups streaming from Base and beyond.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>High Confidence</h2>
          <span className={styles.caption}>Sorted by probability</span>
        </div>
        <div className={localStyles.signalList}>
          {signalDeck.map((signal) => (
            <article key={signal.pair} className={localStyles.signalCard}>
              <div className={localStyles.signalHeader}>
                <span className={localStyles.pair}>{signal.pair}</span>
                <span className={localStyles.direction}>{signal.direction}</span>
              </div>
              <div className={localStyles.signalGrid}>
                <div>
                  <span className={localStyles.label}>Entry</span>
                  <span className={localStyles.value}>{signal.entry}</span>
                </div>
                <div>
                  <span className={localStyles.label}>Target</span>
                  <span className={localStyles.value}>{signal.target}</span>
                </div>
                <div>
                  <span className={localStyles.label}>Stop</span>
                  <span className={localStyles.value}>{signal.stop}</span>
                </div>
                <div>
                  <span className={localStyles.label}>Confidence</span>
                  <span className={localStyles.confidence}>{signal.confidence}%</span>
                </div>
              </div>
              <span className={localStyles.timeframe}>{signal.timeframe}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Automation Suite</h2>
          <span className={styles.caption}>Planned integrations</span>
        </div>
        <div className={localStyles.automationGrid}>
          {automation.map((item) => (
            <div key={item.label} className={localStyles.automationCard}>
              <span className={localStyles.automationLabel}>{item.label}</span>
              <p className={localStyles.automationDescription}>{item.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
