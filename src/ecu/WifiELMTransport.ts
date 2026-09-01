import { DTCResult, ECUDataCallback, ECUTransport, FreezeFrameData, LiveECUData } from "./ECUTransport";
import { decodeDTC } from "./dtcDecorder";
import { decodeVIN, parseVINFromHex, VehicleInfo } from "./vinDecoder";

const BRIDGE_URL = "http://127.0.0.1:5050";

export class WifiELMTransport implements ECUTransport {
  private callback: ECUDataCallback | null = null;
  private connected = false;
  private errorCount = 0;
  private readonly MAX_ERRORS = 5;
  private reconnecting = false;
  private reconnectTimeout: number | null = null;

  // Cache — persists slow PID values between ticks
  private lastKnownValues: Record<string, number> = {};

  // Freeze frame — snapshot live data saat DTC baru pertama terdeteksi
  private freezeFrames: Map<string, FreezeFrameData> = new Map();
  private knownDTCCodes: Set<string> = new Set();

  // Vehicle info dari VIN query Mode 09
  private vehicleInfo: VehicleInfo | null = null;

  // Background queue — untuk slow PIDs (coolant, voltage, dll)
  // Fast PIDs sekarang pakai batch endpoint, tidak perlu queue lagi
  private bgQueue: Promise<void> = Promise.resolve();

  private tick = 0;

  // ─── PID GROUPS ──────────────────────────────────────────────
  // Fast: dikirim via /wifi-batch (1 HTTP req = semua PID sekaligus)
  private readonly FAST_PIDS   = ["010C", "010D", "0111"]; // RPM, Speed, Throttle
  private readonly MEDIUM_PIDS = ["0104", "010B"];          // Load, MAP — tiap 3 tick

  // Slow: background, via /wifi-send satu-satu, tidak block main loop
  private readonly SLOW_PIDS = ["0105", "010F", "0106", "0110"]; // Coolant, intakeTemp, fuelTrim, MAF

  // ─── ADAPTIVE DELAY ──────────────────────────────────────────
  // Delay setelah dapat data — lebih rendah = lebih responsive
  private getDelay(rpm: number): number {
    if (rpm > 3000) return 30;
    if (rpm > 2000) return 40;
    if (rpm > 800)  return 55;
    return 70; // idle
  }

  // ─── CONNECT ─────────────────────────────────────────────────
  async connect(): Promise<void> {
    if (this.connected) return;

    // Reset bridge dulu — paksa TCP reconnect ke ELM327
    // Ini yang fix BUS INIT ERROR akibat koneksi TCP zombie dari session sebelumnya
    try {
      await fetch(`${BRIDGE_URL}/wifi-reset`, { method: "POST" });
      await this.sleep(800); // tunggu bridge selesai reconnect
    } catch {
      // Kalau endpoint tidak ada (versi bridge lama), lanjut aja
    }

    const sendRaw = async (cmd: string): Promise<string> => {
      const res = await fetch(`${BRIDGE_URL}/wifi-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd })
      });
      const json = await res.json();
      const response = (json.response || "").trim();
      console.log(`CMD ${cmd} →`, response);
      return response;
    };

    await sendRaw("AT Z");
    await this.sleep(1000); // tunggu ELM reset penuh setelah AT Z

    await sendRaw("AT E0");
    await sendRaw("AT L0");
    await sendRaw("AT S0");
    await sendRaw("AT H0");

    // AT ST C8 (timeout 200ms) HARUS sebelum AT SP 5
    await sendRaw("AT ST C8");
    await sendRaw("AT SP 5");

    // Retry BUS INIT sampai 5x dengan jeda makin panjang
    let ecu   = "";
    let clean = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      ecu   = await sendRaw("0100");
      clean = ecu.replace(/\s/g, "").toUpperCase();

      if (clean.includes("4100")) break;

      console.warn(`BUS INIT attempt ${attempt} gagal (${ecu}), retrying...`);
      await this.sleep(800 * attempt); // 800ms, 1600ms, 2400ms, 3200ms
    }

    if (!clean.includes("4100")) {
      throw new Error(`ECU tidak merespon setelah 5x percobaan. Response terakhir: ${ecu}`);
    }

    // BUS INIT berhasil — sekarang set timeout agresif untuk polling
    await sendRaw("AT ST 19"); // 25ms untuk PID polling normal

    console.log("WiFi ECU Connected ✔");
    this.connected       = true;
    this.lastKnownValues = {};
    this.tick            = 0;
    this.vehicleInfo     = null;

    // Query VIN sebelum warmup — tidak blocking kalau gagal
    await this.queryVIN();

    // Warmup: isi cache slow PIDs sebelum loop mulai
    await this.warmupSlowPIDs();

    this.startPolling();
  }

  // Fetch slow PIDs + voltage sekali sebelum main loop
  private async warmupSlowPIDs(): Promise<void> {
    console.log("Warming up slow PIDs...");

    // Batch warmup untuk semua slow PIDs sekaligus
    const warmupPIDs = [...this.SLOW_PIDS];
    try {
      const results = await this.batchSend(warmupPIDs);
      warmupPIDs.forEach((pid, i) => {
        const value = this.parsePID(pid, this.cleanELMResponse(results[i] ?? ""));
        if (value !== 0 || results[i]?.includes("41")) {
          this.lastKnownValues[pid] = value;
        }
      });
    } catch { /* ignore */ }

    // Voltage
    try {
      const v = await this.rawQueryVoltage();
      if (v > 0) this.lastKnownValues["__voltage"] = v;
    } catch { /* ignore */ }

    console.log("Warmup done:", this.lastKnownValues);
  }

  // ─── MAIN POLLING LOOP ───────────────────────────────────────
  private startPolling(): void {
    const poll = async () => {
      while (this.connected) {
        try {
          this.tick++;

          // Build PID list untuk tick ini
          const batchPIDs = [...this.FAST_PIDS];
          if (this.tick % 3 === 0) batchPIDs.push(...this.MEDIUM_PIDS);

          // KEY OPTIMIZATION: semua fast + medium PID dalam 1 HTTP request
          // Sebelumnya: 3 request × (HTTP overhead + ELM response time)
          // Sekarang:   1 request × (HTTP overhead + semua ELM response time)
          const responses = await this.batchSend(batchPIDs);

          // Parse semua response
          const result: Record<string, number> = {};
          let allNull = true;

          batchPIDs.forEach((pid, i) => {
            const raw = responses[i] ?? "";
            if (raw && !raw.includes("NO DATA") && !raw.includes("ERROR")) {
              const cleaned = this.cleanELMResponse(raw);
              const value   = this.parsePID(pid, cleaned);
              // Cek ada response "41xx" yang valid
              if (cleaned.includes("41")) {
                result[pid] = value;
                allNull = false;
              }
            }
          });

          // Engine off detection
          if (allNull) {
            this.lastKnownValues = {};
          } else {
            Object.assign(this.lastKnownValues, result);
          }

          // Fire slow PIDs di background — tidak block tick ini
          if (this.tick % 3 === 0) {
            this.runBackgroundPIDs(this.SLOW_PIDS);
          }

          // Voltage di background tiap 5 tick
          if (this.tick % 5 === 0) {
            this.runBackgroundVoltage();
          }

          const rpm      = this.lastKnownValues["010C"]      ?? 0;
          const speed    = this.lastKnownValues["010D"]      ?? 0;
          const throttle = this.lastKnownValues["0111"]      ?? 0;
          const coolant  = this.lastKnownValues["0105"]      ?? 0;
          const voltage  = this.lastKnownValues["__voltage"] ?? 0;

          const data: LiveECUData = {
            rpm,
            speed,
            throttle,
            coolant,
            voltage,
            load:       this.lastKnownValues["0104"],
            intakeTemp: this.lastKnownValues["010F"],
            maf:        this.lastKnownValues["0110"],
            fuelTrim:   this.lastKnownValues["0106"],
            map:        this.lastKnownValues["010B"],
            heartbeat:  Date.now()
          };

          this.errorCount = 0;
          this.callback?.(data);

          await this.sleep(this.getDelay(rpm));

        } catch (err) {
          this.errorCount++;
          console.error("WiFi polling error", err);

          if (this.errorCount >= this.MAX_ERRORS) {
            console.error("WiFi lost connection ❌");
            await this.disconnect();
            this.attemptReconnect();
            break;
          }

          await this.sleep(300);
        }
      }
    };

    poll();
  }

  // ─── BATCH SEND ──────────────────────────────────────────────
  // 1 HTTP round-trip untuk banyak PID sekaligus
  private async batchSend(commands: string[]): Promise<string[]> {
    const res = await fetch(`${BRIDGE_URL}/wifi-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands })
    });
    const json = await res.json();
    return (json.responses ?? []) as string[];
  }

  // ─── BACKGROUND HELPERS ───────────────────────────────────────
  private enqueueBg<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (v: T) => void;
    let reject!:  (e: unknown) => void;
    const p = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    this.bgQueue = this.bgQueue.then(() => fn().then(resolve).catch(reject));
    return p;
  }

  private runBackgroundPIDs(pids: string[]): void {
    // Background juga pakai batch untuk efisiensi
    this.enqueueBg(async () => {
      try {
        const results = await this.batchSend(pids);
        pids.forEach((pid, i) => {
          const raw = results[i] ?? "";
          if (raw && !raw.includes("NO DATA") && !raw.includes("ERROR")) {
            const cleaned = this.cleanELMResponse(raw);
            if (cleaned.includes("41")) {
              this.lastKnownValues[pid] = this.parsePID(pid, cleaned);
            }
          }
        });
      } catch { /* ignore bg errors */ }
    }).catch(() => {});
  }

  private runBackgroundVoltage(): void {
    this.enqueueBg(async () => {
      const v = await this.rawQueryVoltage();
      if (v > 0) this.lastKnownValues["__voltage"] = v;
    }).catch(() => {});
  }

  // ─── DISCONNECT ───────────────────────────────────────────────
  async disconnect(): Promise<void> {
    this.connected       = false;
    this.lastKnownValues = {};
    this.freezeFrames.clear();
    this.knownDTCCodes.clear();
    this.vehicleInfo     = null;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.errorCount = 0;
  }

  onData(cb: ECUDataCallback): void {
    this.callback = cb;
  }

  // ─── DTC SCAN ─────────────────────────────────────────────────
  async scanDTC(): Promise<DTCResult[]> {
    if (!this.connected) return [];

    const allCodes = new Set<string>();

    for (const mode of ["03", "07"]) {
      try {
        const responses = await this.batchSend([mode]);
        const raw = responses[0] ?? "";
        if (!raw || raw.includes("NO DATA") || raw.includes("ERROR")) continue;
        this.parseDTC(raw, mode).forEach(c => allCodes.add(c));
      } catch (err) {
        console.warn(`DTC mode ${mode} failed:`, err);
      }
    }

    // FIX: hapus kode dari knownDTCCodes yang sudah tidak ada di scan terbaru
    // Supaya kalau kode muncul lagi (misal koil dilepas lagi), bisa ter-detect ulang
    for (const known of this.knownDTCCodes) {
      if (!allCodes.has(known)) {
        this.knownDTCCodes.delete(known);
        // Pertahankan freeze frame — masih berguna untuk referensi
      }
    }

    // Snapshot freeze frame untuk kode baru yang belum pernah terdeteksi
    for (const code of allCodes) {
      if (!this.knownDTCCodes.has(code)) {
        this.knownDTCCodes.add(code);
        this.freezeFrames.set(code, this.snapshotNow());
        console.log(`[FreezeFrame] Captured for ${code}:`, this.freezeFrames.get(code));
      }
    }

    return Array.from(allCodes).sort().map(code => ({
      code,
      description: decodeDTC(code),
      severity: "warning" as const
    }));
  }

  // ─── FREEZE FRAME ─────────────────────────────────────────────
  getFreezeFrame(code: string): FreezeFrameData | null {
    return this.freezeFrames.get(code) ?? null;
  }

  // ─── VEHICLE INFO (VIN) ───────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null {
    return this.vehicleInfo;
  }

  private async queryVIN(): Promise<void> {
    console.log("[VIN] Querying Mode 09 PID 02...");

    // VIN query pakai /wifi-send langsung — bukan batchSend
    // karena AT commands dan multi-frame tidak cocok lewat /wifi-batch
    const sendSingle = async (cmd: string): Promise<string> => {
      try {
        const res = await fetch(`${BRIDGE_URL}/wifi-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd })
        });
        const json = await res.json();
        return (json.response || "").trim();
      } catch {
        return "";
      }
    };

    try {
      await sendSingle("AT H1");    // headers ON untuk multi-frame
      await sendSingle("AT ST FF"); // timeout max 1020ms

      const raw = await sendSingle("0902");
      console.log("[VIN] Raw response:", raw);

      // Selalu restore settings dulu sebelum apapun
      await sendSingle("AT H0");
      await sendSingle("AT ST 19");

      if (!raw || raw.includes("NO DATA") || raw.includes("ERROR")) {
        console.warn("[VIN] VIN tidak tersedia, pakai hardcode");
        this.vehicleInfo = this.hardcodedVehicleInfo();
        return;
      }

      const vin = parseVINFromHex(raw);
      if (!vin) {
        console.warn("[VIN] Gagal parse VIN:", raw);
        this.vehicleInfo = this.hardcodedVehicleInfo();
        return;
      }

      this.vehicleInfo = decodeVIN(vin);
      console.log("[VIN] Detected:", this.vehicleInfo);

    } catch (err) {
      console.warn("[VIN] Query failed:", err);
      // Restore settings walau error — pakai fetch langsung supaya tidak deadlock
      await fetch(`${BRIDGE_URL}/wifi-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "AT H0" })
      }).catch(() => {});
      await fetch(`${BRIDGE_URL}/wifi-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "AT ST 19" })
      }).catch(() => {});
      this.vehicleInfo = this.hardcodedVehicleInfo();
    }
  }

  // Fallback hardcode dari nomor rangka + mesin yang sudah dikonfirmasi owner
  private hardcodedVehicleInfo(): VehicleInfo {
    return {
      vin:       "WDB2030616A794557",
      make:      "Mercedes-Benz (Germany)",
      model:     "W203 (C-Class 2000–2007)",
      engine:    "C240 (M112 E26 V6 2.6L)",
      modelYear: 2006,
      plant:     "Sindelfingen, Germany",
      isValid:   false
    };
  }

  // Buat snapshot dari lastKnownValues saat ini
  private snapshotNow(): FreezeFrameData {
    return {
      time:       new Date().toLocaleString("id-ID"),
      rpm:        this.lastKnownValues["010C"] ?? 0,
      speed:      this.lastKnownValues["010D"] ?? 0,
      throttle:   this.lastKnownValues["0111"] ?? 0,
      coolant:    this.lastKnownValues["0105"] ?? 0,
      voltage:    this.lastKnownValues["__voltage"] ?? 0,
      load:       this.lastKnownValues["0104"],
      map:        this.lastKnownValues["010B"],
      fuelTrim:   this.lastKnownValues["0106"],
      intakeTemp: this.lastKnownValues["010F"],
    };
  }

  async clearDTC(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      const responses = await this.batchSend(["04"]);
      const resp = responses[0] ?? "";

      console.log("[DTC] Clear response:", resp);

      // ECU W203 KWP2000 response untuk Mode 04:
      // - "44" atau "44 00" = success
      // - "NO DATA" = tidak ada DTC yang perlu dihapus (juga ok)
      // - "ERROR" = gagal
      // - "" kosong = bisa jadi sukses (KWP2000 kadang tidak kirim response)
      const isFailed = resp.includes("ERROR") || resp.includes("UNABLE");
      const ok = !isFailed;

      if (ok) {
        // Tunggu ECU selesai proses clear — penting!
        // Tanpa delay ini, scan berikutnya mungkin masih dapat kode lama
        await this.sleep(2000);

        this.freezeFrames.clear();
        this.knownDTCCodes.clear();
        console.log("[DTC] Cleared successfully");
      }

      return ok;
    } catch {
      return false;
    }
  }

  // ─── DTC PARSER ───────────────────────────────────────────────
  private parseDTC(raw: string, mode: string): string[] {
    const codes: string[]    = [];
    const expectedPrefix = mode === "03" ? "43" : "47";

    const cleaned = raw
      .toUpperCase()
      .replace(/\s/g, "")
      .replace(/SEARCHING\.\.\./g, "")
      .replace(/BUSINITIOK/g, "")
      .replace(/>/g, "");

    const startIdx = cleaned.indexOf(expectedPrefix);
    if (startIdx === -1) return codes;

    const payload = cleaned.slice(startIdx + 2);

    for (let i = 0; i + 3 < payload.length; i += 4) {
      const chunk = payload.slice(i, i + 4);
      if (chunk === "0000") continue;

      const A = parseInt(chunk.slice(0, 2), 16);
      const B = parseInt(chunk.slice(2, 4), 16);
      if (isNaN(A) || isNaN(B)) continue;

      const typeCode = (A & 0xC0) >> 6;
      const prefix   = ["P", "C", "B", "U"][typeCode];
      const digit2   = (A & 0x30) >> 4;
      const digit3   = A & 0x0F;
      const digits45 = chunk.slice(2, 4);

      codes.push(`${prefix}${digit2}${digit3}${digits45}`);
    }

    return codes;
  }

  // ─── ELM RESPONSE HELPERS ────────────────────────────────────
  private cleanELMResponse(raw: string): string {
    if (!raw) return "";
    return raw
      .toUpperCase()
      .replace(/>/g, "")
      .replace(/SEARCHING\.\.\./g, "")
      .replace(/BUS\s*INIT[^]*/g, "")
      .replace(/^01[0-9A-F]{2}/gm, "")
      .replace(/[^A-F0-9]/g, "")
      .trim();
  }

  private parsePID(pid: string, clean: string): number {
    const index = clean.indexOf("41");
    if (index === -1) return 0;

    const response = clean.slice(index);
    if (response.length < 6) return 0;

    const A = parseInt(response.slice(4, 6), 16);
    const B = parseInt(response.slice(6, 8), 16) || 0;
    if (isNaN(A)) return 0;

    switch (pid) {
      case "010C": return (A * 256 + B) / 4;       // RPM
      case "010D": return A;                         // Speed km/h
      case "0105": return A - 40;                   // Coolant °C
      case "0111": return (A * 100) / 255;          // Throttle %
      case "0104": return (A * 100) / 255;          // Engine load %
      case "010F": return A - 40;                   // Intake temp °C
      case "0110": return (A * 256 + B) / 100;     // MAF g/s
      case "0106": return ((A - 128) * 100) / 128; // Short fuel trim %
      case "010B": return A;                        // MAP kPa
      default:     return 0;
    }
  }

  private async rawQueryVoltage(): Promise<number> {
    try {
      const responses = await this.batchSend(["ATRV"]);
      const raw       = responses[0] ?? "";
      const match     = raw.toUpperCase().match(/([0-9]+\.[0-9]+)V?/);
      return match ? parseFloat(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  // ─── RECONNECT ───────────────────────────────────────────────
  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    try {
      await this.connect();
      this.errorCount   = 0;
      this.reconnecting = false;
    } catch {
      this.reconnectTimeout = window.setTimeout(() => {
        this.reconnecting = false;
        this.attemptReconnect();
      }, 3000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(res => setTimeout(res, ms));
  }
}
