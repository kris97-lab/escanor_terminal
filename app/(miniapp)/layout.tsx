import type { ReactNode } from "react";
import { MiniAppProvider } from "./MiniAppProvider";
import { BottomNav } from "./components/BottomNav";
import styles from "./layout.module.css";

export default function MiniAppLayout({ children }: { children: ReactNode }) {
  return (
    <MiniAppProvider>
      <div className={styles.shell}>
        <main className={styles.main}>{children}</main>
        <BottomNav />
      </div>
    </MiniAppProvider>
  );
}
