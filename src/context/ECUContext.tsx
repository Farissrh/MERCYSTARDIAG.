import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { BackendTransport } from "../ecu/BackendTransport";
import { ECUTransport } from "../ecu/ECUTransport";
import { MockTransport } from "../ecu/MockTransport";
import { WifiELMTransport } from "../ecu/WifiELMTransport";

export type TransportMode = "backend" | "wifi" | "mock";
export type ECUStatus = "connected" | "reconnecting" | "disconnected";

interface ECUContextType {
  transport: ECUTransport;
  mode: TransportMode;
  setMode: (mode: TransportMode) => void;
  ecuConnected: boolean;
  setEcuConnected: (v: boolean) => void;
  status: ECUStatus;
  setStatus: (s: ECUStatus) => void;
}

const ECUContext = createContext<ECUContextType | null>(null);

export function ECUProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<TransportMode>("backend");
  const [ecuConnected, setEcuConnected] = useState(false);
  const [transport, setTransport] = useState<ECUTransport>(
    new BackendTransport()
  );
  const [status, setStatus] = useState<ECUStatus>("disconnected");

  // FIX: track previous transport so we can disconnect it before switching
  const prevTransportRef = useRef<ECUTransport | null>(null);

  useEffect(() => {
    // Disconnect old transport before creating new one
    const prev = prevTransportRef.current;
    if (prev) {
      prev.disconnect().catch(console.error);
    }

    let next: ECUTransport;
    if (mode === "backend") {
      next = new BackendTransport();
    } else if (mode === "wifi") {
      next = new WifiELMTransport();
    } else {
      next = new MockTransport();
    }

    prevTransportRef.current = next;
    setTransport(next);
    setEcuConnected(false); // reset connection state on mode switch
  }, [mode]);

  const value = useMemo(
    () => ({
      transport,
      mode,
      setMode,
      ecuConnected,
      setEcuConnected,
      status,
      setStatus
    }),
    [transport, mode, ecuConnected, status]
  );

  return <ECUContext.Provider value={value}>{children}</ECUContext.Provider>;
}

export function useECUConnection() {
  const ctx = useContext(ECUContext);
  if (!ctx) throw new Error("ECUProvider not mounted");
  return ctx;
}
