import { BackendTransport } from "./BackendTransport";
import { ECUTransport } from "./ECUTransport";
import { WifiELMTransport } from "./WifiELMTransport";

export type TransportMode = "backend" | "wifi";

export function createTransport(mode: TransportMode): ECUTransport {
  switch (mode) {
    case "backend":
      return new BackendTransport();
    case "wifi":
      return new WifiELMTransport();
    default:
      return new BackendTransport();
  }
}
