import {
  DTCResult,
  ECUDataCallback,
  ECUTransport,
  FreezeFrameData,
  LiveECUData,
  VehicleInfo
} from "./ECUTransport";

export class MockTransport implements ECUTransport {
  private callback: ECUDataCallback | null = null;
  private interval: number | null = null;
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;

    this.interval = window.setInterval(() => {
      if (!this.connected) return;

      const data: LiveECUData = {
        rpm: this.randomBetween(700, 3500),
        speed: this.randomBetween(0, 120),
        throttle: this.randomBetween(0, 80),
        coolant: this.randomBetween(80, 100),
        voltage: this.randomBetween(12.2, 14.2),
        heartbeat: Date.now()
      };

      this.callback?.(data);
    }, 500);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  onData(cb: ECUDataCallback): void {
    this.callback = cb;
  }

  async scanDTC(): Promise<DTCResult[]> {
    return [];
  }

  async clearDTC(): Promise<boolean> {
    return true;
  }

  getFreezeFrame(_code: string): FreezeFrameData | null {
    return null;
  }

  getVehicleInfo(): VehicleInfo | null {
    return null;
  }

  private randomBetween(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }
}
