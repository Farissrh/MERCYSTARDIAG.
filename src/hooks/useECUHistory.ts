import { useEffect, useState } from "react";
import { useLiveECU } from "./useLiveECU";

interface ECUHistoryItem {
  rpm: number;
  speed: number;
  t: number;
}

export function useECUHistory(limit = 60) {
  const { rpm, speed } = useLiveECU();
  const [history, setHistory] = useState<ECUHistoryItem[]>([]);

  useEffect(() => {
    setHistory(prev => {
      const next = [...prev, { rpm, speed, t: Date.now() }];
      return next.length > limit ? next.slice(-limit) : next;
    });
  }, [rpm, speed, limit]);

  return history;
}
