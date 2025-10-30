"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import miniapp, * as MiniAppSDK from "@farcaster/miniapp-sdk";

type MiniAppState = {
  context: MiniAppSDK.Context.MiniAppContext | null;
  isReady: boolean;
};

const MiniAppContext = createContext<MiniAppState>({
  context: null,
  isReady: false,
});

export function MiniAppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MiniAppState>({ context: null, isReady: false });

  useEffect(() => {
    let active = true;

    miniapp.actions
      .ready({ disableNativeGestures: true })
      .catch((error) => console.error("MiniApp ready error", error));

    miniapp.context
      .then((miniAppContext) => {
        if (!active) return;
        setState({ context: miniAppContext, isReady: true });
      })
      .catch((error) => {
        console.error("Unable to resolve miniapp context", error);
        if (!active) return;
        setState((prev) => ({ ...prev, isReady: true }));
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => state, [state]);

  return <MiniAppContext.Provider value={value}>{children}</MiniAppContext.Provider>;
}

export function useMiniAppContext() {
  return useContext(MiniAppContext);
}
