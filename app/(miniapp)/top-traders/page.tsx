import styles from "../layout.module.css";
import localStyles from "./page.module.css";

const traders = [
  {
    name: "0xFury",
    winRate: 74,
    avgRoi: "+18.4%",
    followers: "3.2k",
    streak: 6,
  },
  {
    name: "NeonNakamoto",
    winRate: 69,
    avgRoi: "+22.1%",
    followers: "2.7k",
    streak: 4,
  },
  {
    name: "Aria",
    winRate: 63,
    avgRoi: "+11.3%",
    followers: "1.9k",
    streak: 3,
  },
];

const leaderboards = [
  { label: "24h PnL", value: "+$186k" },
  { label: "7d Hit Rate", value: "72%" },
  { label: "Copied Trades", value: "1,284" },
];

export default function TopTradersPage() {
  return (
    <div className={`${styles.page} ${localStyles.page}`}>
      <header className={localStyles.header}>
        <span className={styles.badge}>Top Desk</span>
        <h1 className={localStyles.title}>Leaderboard</h1>
        <p className={localStyles.subtitle}>
          Discover the most consistent traders across Base. Stats refresh in real time with every execution.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Momentum Board</h2>
          <span className={styles.caption}>Performance snapshot</span>
        </div>
        <div className={styles.grid}>
          {leaderboards.map((item) => (
            <div key={item.label} className={localStyles.statTile}>
              <span className={localStyles.statLabel}>{item.label}</span>
              <span className={localStyles.statValue}>{item.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Signal Callers</h2>
          <span className={styles.caption}>Ranked by live hit rate</span>
        </div>
        <div className={localStyles.table}>
          <div className={localStyles.tableHeader}>
            <span>Trader</span>
            <span>Win%</span>
            <span>Avg ROI</span>
            <span>Followers</span>
            <span>Streak</span>
          </div>
          {traders.map((trader) => (
            <div key={trader.name} className={localStyles.tableRow}>
              <span className={localStyles.primary}>{trader.name}</span>
              <span>{trader.winRate}%</span>
              <span className={styles.accent}>{trader.avgRoi}</span>
              <span>{trader.followers}</span>
              <span>{trader.streak}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
