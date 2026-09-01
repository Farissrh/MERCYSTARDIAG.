import type { VehicleInfo } from "./vinDecoder";

export interface LiveECUData {
  rpm: number;
  speed: number;
  throttle: number;
  coolant: number;
  voltage: number;

  load?: number;
  intakeTemp?: number;
  maf?: number;
  fuelTrim?: number;
  map?: number;

  heartbeat?: number;
}

export interface DTCResult {
  code: string;
  description: string;
  severity?: "warning" | "info" | "pending";
}

export interface FreezeFrameData {
  time: string;
  rpm: number;
  speed: number;
  throttle: number;
  coolant: number;
  voltage: number;
  load?: number;
  map?: number;
  fuelTrim?: number;
  intakeTemp?: number;
}

export type ECUDataCallback = (data: LiveECUData) => void;

export interface ECUTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(cb: ECUDataCallback): void;
  scanDTC(): Promise<DTCResult[]>;
  clearDTC(): Promise<boolean>;
  getFreezeFrame(code: string): FreezeFrameData | null;
  getVehicleInfo(): VehicleInfo | null;
}

export type { VehicleInfo };
