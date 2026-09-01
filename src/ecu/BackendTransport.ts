import { io, Socket } from "socket.io-client";
import { DTCResult, ECUDataCallback, ECUTransport, FreezeFrameData, VehicleInfo } from "./ECUTransport";

const BASE_URL = "http://localhost:5000";

export class BackendTransport implements ECUTransport {
  private socket: Socket | null = null;
  private connecting = false;
  private vehicleInfo: VehicleInfo | null = null;

  async connect(): Promise<void> {
    if (this.socket || this.connecting) return;
    this.connecting = true;

    try {
      const res  = await fetch(`${BASE_URL}/connect`, { method: "POST" });
      if (!res.ok) throw new Error("Backend connect gagal");

      const data = await res.json();

      // FIX: cek apakah ECU benar-benar terhubung, bukan hanya server-nya
      if (!data.connected) {
        throw new Error("ECU tidak merespon — pastikan kunci kontak ON");
      }

      this.socket = io(BASE_URL, { transports: ["websocket"] });
      this.fetchVehicleInfo();
    } finally {
      this.connecting = false;
    }
  }

  private async fetchVehicleInfo(): Promise<void> {
    try {
      const res  = await fetch(`${BASE_URL}/vehicle-info`);
      const data = await res.json();
      if (data) this.vehicleInfo = data as VehicleInfo;
    } catch {
      // Non-fatal
    }
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket      = null;
    this.vehicleInfo = null;
  }

  onData(cb: ECUDataCallback): void {
    if (!this.socket) return;
    this.socket.off("live_data");
    this.socket.on("live_data", cb);
  }

  async scanDTC(): Promise<DTCResult[]> {
    try {
      const res = await fetch(`${BASE_URL}/scan-dtc`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data as DTCResult[];
    } catch {
      return [];
    }
  }

  async clearDTC(): Promise<boolean> {
    try {
      const res  = await fetch(`${BASE_URL}/clear-dtc`, { method: "POST" });
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === "cleared";
    } catch {
      return false;
    }
  }

  getFreezeFrame(_code: string): FreezeFrameData | null {
    return null;
  }

  getVehicleInfo(): VehicleInfo | null {
    return this.vehicleInfo;
  }

  async connectWifi(): Promise<boolean> {
    try {
      const res  = await fetch(`${BASE_URL}/connect-wifi`, { method: "POST" });
      const data = await res.json();
      return data.connected;
    } catch {
      return false;
    }
  }
}