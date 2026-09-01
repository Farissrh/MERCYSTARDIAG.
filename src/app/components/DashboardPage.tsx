import {
  Activity,
  AlertTriangle,
  Battery,
  ChevronRight,
  CircleCheck,
  Gauge,
  MapPin,
  Thermometer,
  WifiOff,
  Zap
} from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useECUConnection } from "../../context/ECUContext";
import { DTCResult } from "../../ecu/ECUTransport";
import { classifyDTC } from "../../ecu/dtcClassifier";
import { decodeDTC } from "../../ecu/dtcDecorder";
import { analyzeEngine } from "../../ecu/engineAnalyzer";
import { useLiveECU } from "../../hooks/useLiveECU";
import { GaugeIndicator } from "./GaugeIndicator";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "./ui/alert-dialog";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

/* =====================
   TYPES
===================== */
interface DashboardPageProps {
  onDisconnected?: () => void;
}

interface HealthInsight {
  level: "normal" | "warning" | "danger";
  messages: string[];
}

interface ECUHistoryItem {
  rpm: number;
  speed: number;
  t: number;
}

interface ECULogItem {
  time: string;
  rpm: number;
  speed: number;
  throttle: number;
  coolant: number;
  voltage: number;
}

/* =====================
   HEALTH SCORE — STRICT
   Baseline 100, deduct based on live data + DTC severity
===================== */
function calculateHealthScore(
  coolant: number,
  rpm: number,
  voltage: number,
  dtcList: DTCResult[]
): number {
  let score = 100;

  // Live data deductions
  if (coolant > 110) score -= 25;
  else if (coolant > 100) score -= 15;
  else if (coolant > 95) score -= 5;

  if (voltage < 11.5) score -= 20;
  else if (voltage < 12.0) score -= 10;
  else if (voltage < 12.3) score -= 5;

  if (rpm > 0 && rpm < 500) score -= 10;
  else if (rpm > 0 && rpm < 600) score -= 5;

  // DTC deductions — each code hits individually
  for (const dtc of dtcList) {
    const meta = classifyDTC(dtc.code);
    score -= meta.scoreDeduction;
  }

  return Math.max(score, 0);
}

function getHealthColor(score: number): string {
  if (score >= 80) return "#00ff88";
  if (score >= 60) return "#ffb300";
  if (score >= 40) return "#ff8800";
  return "#ff4444";
}

function getHealthLabel(score: number): string {
  if (score >= 80) return "Baik";
  if (score >= 60) return "Perhatian";
  if (score >= 40) return "Bermasalah";
  return "Kritis";
}

/* =====================
   LIVE DATA HEALTH INSIGHT (for recommendation section)
===================== */
function evaluateHealthInsight(
  coolant: number,
  voltage: number,
  rpm: number
): HealthInsight {
  const messages: string[] = [];
  let level: HealthInsight["level"] = "normal";

  if (coolant > 105) {
    messages.push("Suhu coolant terlalu tinggi — matikan AC, segera berhenti");
    level = "danger";
  } else if (coolant > 95) {
    messages.push("Suhu coolant mulai tinggi — pantau terus");
    if (level === "normal") level = "warning";
  }

  if (voltage < 11.8) {
    messages.push(
      "Tegangan aki sangat rendah — kemungkinan aki drop atau alternator mati"
    );
    level = "danger";
  } else if (voltage < 12.2) {
    messages.push("Tegangan aki kurang optimal — cek kondisi aki");
    if (level === "normal") level = "warning";
  }

  if (rpm > 0 && rpm < 600) {
    messages.push("RPM idle sangat rendah — risiko mati mesin");
    if (level === "normal") level = "warning";
  }

  return { level, messages };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/* =====================
   COMPONENT
===================== */

export function DashboardPage({ onDisconnected }: DashboardPageProps) {
  const {
    throttle,
    rpm,
    speed,
    coolant,
    voltage: batteryVoltage,
    heartbeat,
    load,
    map,
    fuelTrim,
    intakeTemp // extended parameters
  } = useLiveECU();
  const { transport, ecuConnected, setEcuConnected } = useECUConnection();
  // FIX: vehicleInfo sebagai state — VIN query async, jadi perlu polling
  // sampai nilainya tersedia dari transport
  const [vehicleInfo, setVehicleInfo] = useState(transport.getVehicleInfo());

  useEffect(() => {
    // Poll setiap 500ms sampai vehicleInfo tersedia (max 10 detik)
    if (vehicleInfo) return; // sudah ada, stop

    const interval = setInterval(() => {
      const info = transport.getVehicleInfo();
      if (info) {
        setVehicleInfo(info);
        clearInterval(interval);
      }
    }, 500);

    const timeout = setTimeout(() => clearInterval(interval), 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [transport, vehicleInfo]);

  const safeRPM = clamp(rpm, 0, 7000);
  const safeSpeed = clamp(speed, 0, 220);
  const safeCoolant = clamp(coolant, -20, 130);
  const safeVoltage = clamp(batteryVoltage, 0, 16);

  const lastSpeedRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  const insights = analyzeEngine({
    rpm: safeRPM,
    speed: safeSpeed,
    throttle,
    coolant: safeCoolant,
    voltage: safeVoltage,
    load,
    map,
    fuelTrim,
    intakeTemp
  });

  /* =====================
     ECU WATCHDOG
  ===================== */
  const lastDataRef = useRef<number>(Date.now());
  const hasEverReceivedData = useRef(false);
  const missedRef = useRef(0);
  const [showConnectingOverlay, setShowConnectingOverlay] = useState(false);

  useEffect(() => {
    if (heartbeat) {
      lastDataRef.current = heartbeat;
      hasEverReceivedData.current = true;
    }
  }, [heartbeat]);

  useEffect(() => {
    const DISCONNECT_TIMEOUT = 12000;

    const interval = setInterval(() => {
      const now = Date.now();

      if (
        hasEverReceivedData.current &&
        ecuConnected &&
        now - lastDataRef.current > DISCONNECT_TIMEOUT
      ) {
        missedRef.current++;
        if (missedRef.current >= 4) {
          setEcuConnected(false);
          setShowConnectingOverlay(true);
          toast.error("Koneksi ECU terputus");
          onDisconnected?.();
        }
      } else {
        missedRef.current = 0;
      }

      if (
        !ecuConnected &&
        hasEverReceivedData.current &&
        now - lastDataRef.current <= DISCONNECT_TIMEOUT
      ) {
        missedRef.current = 0;
        setEcuConnected(true);
        setShowConnectingOverlay(false);
        toast.success("Koneksi ECU tersambung kembali");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [ecuConnected, setEcuConnected, onDisconnected]);

  /* =====================
     DTC
  ===================== */
  const [dtcCodes, setDtcCodes] = useState<DTCResult[] | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const fetchDTC = useCallback(async () => {
    setIsScanning(true);
    try {
      const data = await transport.scanDTC();
      setDtcCodes(data);
      if (data.length > 0) {
        console.log(`[DTC] Found ${data.length} code(s):`, data.map(d => d.code));
      }
    } catch (err) {
      console.warn("DTC scan failed", err);
      setDtcCodes([]);
    } finally {
      setIsScanning(false);
    }
  }, [transport]);

  useEffect(() => {
    const timer = setTimeout(fetchDTC, 3000);
    return () => clearTimeout(timer);
  }, [fetchDTC]);

  // FIX: kurangi interval dari 60s ke 15s supaya DTC baru cepat terdeteksi
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await transport.scanDTC();
        if (dtcCodes !== null && data.length > dtcCodes.length) {
          toast.error("⚠ Kode kerusakan baru terdeteksi!");
        }
        setDtcCodes(data);
      } catch (err) {
        console.error("Auto DTC scan error", err);
      }
    }, 15000); // 15 detik — jauh lebih responsif dari 60 detik

    return () => clearInterval(interval);
  }, [transport, dtcCodes]);

  async function clearDTC() {
    try {
      const ok = await transport.clearDTC();
      if (!ok) throw new Error();

      // Clear UI dulu
      setDtcCodes([]);
      toast.success("DTC berhasil dihapus — scan ulang sedang berjalan...");

      // Scan ulang setelah delay 3 detik — beri waktu ECU settle
      // (transport.clearDTC() sudah ada internal 2s delay, ini tambahan dari UI side)
      setTimeout(async () => {
        try {
          const fresh = await transport.scanDTC();
          setDtcCodes(fresh);
          if (fresh.length === 0) {
            toast.success("✓ Semua DTC berhasil dihapus");
          } else {
            toast.warning(`⚠ ${fresh.length} kode masih aktif — masalah belum sepenuhnya teratasi`);
          }
        } catch {
          // Scan gagal, biarkan user scan manual
        }
      }, 3000);

    } catch {
      toast.error("Gagal menghapus DTC");
    } finally {
      setClearOpen(false);
    }
  }

  /* =====================
     FREEZE FRAME
  ===================== */
  const [selectedDTC, setSelectedDTC] = useState<string | null>(null);
  const [freezeFrame, setFreezeFrame] = useState<
    import("../../ecu/ECUTransport").FreezeFrameData | null
  >(null);
  const [freezeOpen, setFreezeOpen] = useState(false);

  async function fetchFreezeFrame(code: string) {
    setFreezeFrame(null);
    setSelectedDTC(code);

    // WiFi/Mock mode: ambil dari cache transport — sync, langsung dari snapshot
    const cached = transport.getFreezeFrame(code);
    if (cached) {
      setFreezeFrame(cached);
      setFreezeOpen(true);
      return;
    }

    // Backend mode: fetch dari server
    try {
      const res = await fetch(`http://localhost:5000/freeze-frame/${code}`);
      const data = await res.json();
      if (!data.error) setFreezeFrame(data);
    } catch {
      // Tetap buka dialog meski gagal — minimal tampilkan info DTC
    }

    setFreezeOpen(true);
  }

  /* =====================
     HEALTH — now DTC-aware
  ===================== */
  const healthScore = calculateHealthScore(
    safeCoolant,
    safeRPM,
    safeVoltage,
    dtcCodes ?? []
  );
  const healthColor = getHealthColor(healthScore);
  const healthLabel = getHealthLabel(healthScore);
  const healthInsight = evaluateHealthInsight(
    safeCoolant,
    safeVoltage,
    safeRPM
  );

  // Build DTC-based recommendations
  const dtcRecommendations = (dtcCodes ?? []).map(dtc => ({
    dtc,
    meta: classifyDTC(dtc.code)
  }));

  /* =====================
     CHART
  ===================== */
  const [showChart, setShowChart] = useState(false);
  const [history, setHistory] = useState<ECUHistoryItem[]>([]);

  useEffect(() => {
    if (!heartbeat) return;
    setHistory(prev => {
      const next = [...prev, { rpm: safeRPM, speed: safeSpeed, t: Date.now() }];
      return next.length > 60 ? next.slice(-60) : next;
    });

    /* safeRPM & safeSpeed intentionally omitted — heartbeat adalah sinyal
       "data baru tiba", jadi cukup heartbeat sebagai trigger.
       Kalau safeRPM/safeSpeed ikut di deps, effect bisa run 2x per data event
       karena state rpm dan speed update secara terpisah di useLiveECU. */
  }, [heartbeat]);

  /* =====================
     DRIVE SESSION
  ===================== */
  const [tripActive, setTripActive] = useState(false);
  const [tripStartTime, setTripStartTime] = useState<number | null>(null);
  const [tripStats, setTripStats] = useState({
    maxSpeed: 0,
    maxRPM: 0,
    speedSum: 0,
    samples: 0
  });
  const stopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (speed > 5 && !tripActive && tripStartTime === null) {
      setTripActive(true);
      setTripStartTime(Date.now());
      setTripStats({
        maxSpeed: speed,
        maxRPM: rpm,
        speedSum: speed,
        samples: 1
      });
      toast.success("Trip dimulai");
    }
  }, [speed, rpm, tripActive, tripStartTime]);

  useEffect(() => {
    if (!tripActive) return;
    setTripStats(prev => ({
      maxSpeed: Math.max(prev.maxSpeed, speed),
      maxRPM: Math.max(prev.maxRPM, rpm),
      speedSum: prev.speedSum + speed,
      samples: prev.samples + 1
    }));
  }, [speed, rpm, tripActive]);

  useEffect(() => {
    if (!tripActive) return;

    if (speed <= 5) {
      if (stopTimerRef.current === null) {
        stopTimerRef.current = window.setTimeout(() => {
          setTripActive(false);
          const duration = tripStartTime ? Date.now() - tripStartTime : 0;
          const avgSpeed =
            tripStats.samples > 0 ? tripStats.speedSum / tripStats.samples : 0;
          toast.success(
            `Trip selesai • Durasi ${(duration / 60000).toFixed(
              1
            )} menit • Avg ${avgSpeed.toFixed(1)} km/h`
          );
          stopTimerRef.current = null;
        }, 10000);
      }
    } else {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
    }

    return () => {
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
    };
  }, [speed, tripActive, tripStartTime, tripStats]);

  /* =====================
     LOGGING + REPORT
  ===================== */
  const navigate = useNavigate();
  const [isLogging, setIsLogging] = useState(false);
  const [logBuffer, setLogBuffer] = useState<ECULogItem[]>([]);
  const [tripHistory, setTripHistory] = useState<any[]>([]);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const MAX_LOG_BUFFER = 2000;

  // Catat waktu mulai logging
  const logStartTimeRef = useRef<string>("");

  // Snapshot DTC dan insights saat logging berjalan
  // (diambil dari state yang sudah ada, bukan fetch ulang)
  const logDTCRef = useRef<typeof dtcCodes>([]);
  const logInsightsRef = useRef<typeof insights>([]);

  // Update snapshot setiap kali berubah selama logging aktif
  useEffect(() => {
    if (!isLogging) return;
    logDTCRef.current = dtcCodes ?? [];
    logInsightsRef.current = insights;
  }, [isLogging, dtcCodes, insights]);

  useEffect(() => {
    setTripHistory(JSON.parse(localStorage.getItem("tripHistory") || "[]"));
  }, []);

  function startLogging() {
    logStartTimeRef.current = new Date().toLocaleString("id-ID");
    logDTCRef.current = dtcCodes ?? [];
    logInsightsRef.current = insights;
    setLogBuffer([]);
    setIsLogging(true);
  }

  function saveTripSummary() {
    if (!logBuffer.length) return;
    const summary = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      duration: logBuffer.length * 0.5,
      maxRPM: Math.max(...logBuffer.map(r => r.rpm)),
      maxSpeed: Math.max(...logBuffer.map(r => r.speed)),
      avgVoltage: Number(
        (
          logBuffer.reduce((s, r) => s + r.voltage, 0) / logBuffer.length
        ).toFixed(2)
      )
    };
    const existing = JSON.parse(localStorage.getItem("tripHistory") || "[]");
    const updated = [summary, ...existing].slice(0, 20);
    localStorage.setItem("tripHistory", JSON.stringify(updated));
    setTripHistory(updated);
  }

  useEffect(() => {
    if (!isLogging || !ecuConnected) return;
    setLogBuffer(prev => {
      const next = [
        ...prev,
        {
          time: new Date().toLocaleString("id-ID"),
          rpm: safeRPM,
          speed: safeSpeed,
          throttle,
          coolant: safeCoolant,
          voltage: safeVoltage
        }
      ];
      return next.length > MAX_LOG_BUFFER ? next.slice(-MAX_LOG_BUFFER) : next;
    });
  }, [
    safeRPM,
    safeSpeed,
    throttle,
    safeCoolant,
    safeVoltage,
    isLogging,
    ecuConnected
  ]);

  function buildReport(): import("../../ecu/reportGenerator").TripReport {
    return {
      startTime: logStartTimeRef.current,
      endTime: new Date().toLocaleString("id-ID"),
      durationSec: logBuffer.length * 0.5,
      logData: logBuffer,
      dtcList: logDTCRef.current ?? [],
      insights: logInsightsRef.current ?? []
    };
  }

  <div className="mb-8">
    <div className="flex items-center justify-between mb-2">
      <h1 className="text-3xl font-bold">Dashboard Real-Time</h1>
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
          ecuConnected
            ? "bg-green-500/10 border-green-500/30"
            : "bg-red-500/10 border-red-500/30"
        }`}
      >
        <div
          className={`w-2 h-2 rounded-full ${
            ecuConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
          }`}
        />
        <span
          className={`text-sm ${
            ecuConnected ? "text-green-500" : "text-red-500"
          }`}
        >
          {ecuConnected ? "OBD-II Terhubung" : "OBD-II Terputus"}
        </span>
      </div>
    </div>

    <p className="text-gray-400 mt-3">
      Monitor kondisi kendaraan Anda secara real-time
    </p>
  </div>;

  async function handleExportCSV() {
    if (!logBuffer.length) return;
    const { exportCSV } = await import("../../ecu/reportGenerator");
    exportCSV(buildReport());
  }

  async function handleExportPDF() {
    if (!logBuffer.length) return;
    setIsExportingPDF(true);
    try {
      const { exportPDF } = await import("../../ecu/reportGenerator");
      await exportPDF(buildReport());
    } finally {
      setIsExportingPDF(false);
    }
  }

  async function handleEndSession() {
    // Stop logging kalau masih jalan
    if (isLogging) {
      saveTripSummary();
      setIsLogging(false);
    }

    // Disconnect transport
    try {
      await transport.disconnect();
    } catch { /* ignore */ }

    setEcuConnected(false);
    setShowEndModal(false);
    navigate("/connect");
  }

  function exportTripHistory() {
    if (!tripHistory.length) return;
    const header = "Date,Duration(sec),MaxRPM,MaxSpeed,AvgVoltage\n";
    const rows = tripHistory
      .map(
        (t: any) =>
          `${t.date},${t.duration},${t.maxRPM},${t.maxSpeed},${t.avgVoltage}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trip-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* =====================
     RENDER
  ===================== */
  return (
    <div className="relative min-h-screen bg-[#0a0a0f] p-4 md:p-8 overflow-hidden">

      {/* Siluet W203 — background dekoratif */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none overflow-hidden opacity-[0.04] select-none">
        <img
          src="/w203_silhouette.png"
          alt=""
          className="w-full max-w-5xl object-contain"
          draggable={false}
        />
      </div>

      {showConnectingOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <WifiOff className="w-12 h-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">
              Menghubungkan ulang ECU
            </h3>
            <p className="text-gray-400">
              Pastikan kontak ON dan perangkat terhubung
            </p>
          </div>
        </div>
      )}

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-2">
            {/* Logo + Title */}
            <div className="flex items-center gap-2">
              <img
                src="/public/mb logo.png"
                alt="Mercedes-Benz"
                className="w-10 h-10 object-contain opacity-80"
              />
              <h1 className="text-3xl font-bold">Dashboard Real-Time</h1>
            </div>
            <div
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
                ecuConnected
                  ? "bg-green-500/10 border-green-500/30"
                  : "bg-red-500/10 border-red-500/30"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  ecuConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
                }`}
              />
              <span
                className={`text-sm ${
                  ecuConnected ? "text-green-500" : "text-red-500"
                }`}
              >
                {ecuConnected ? "OBD-II Terhubung" : "OBD-II Terputus"}
              </span>
            </div>
          </div>
          <p className="text-gray-400">
            Monitor kondisi kendaraan Anda secara real-time
          </p>

          {/* Vehicle Info Card — muncul kalau VIN berhasil dibaca */}
          {vehicleInfo && (
            <div className="mt-4 bg-gradient-to-r from-[#1a1a24] to-[#12121a] border border-[#00BFFF]/20 rounded-xl overflow-hidden">
              <div className="flex items-stretch">

                {/* Gambar mobil */}
                <div className="relative w-48 flex-shrink-0 bg-[#0a0a0f] flex items-center justify-center overflow-hidden">
                  <img
                    src="/203.png"
                    alt="W203"
                    className="w-full h-full object-cover opacity-80"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#1a1a24]" />
                </div>

                {/* Info */}
                <div className="flex flex-1 items-center justify-between gap-6 px-6 py-4">

                  {/* Kiri: identitas */}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-white font-bold text-base">
                        {vehicleInfo.model}
                      </span>
                      {vehicleInfo.modelYear > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#00BFFF]/10 border border-[#00BFFF]/30 text-[#00BFFF] font-semibold">
                          {vehicleInfo.modelYear}
                        </span>
                      )}
                      {vehicleInfo.isValid ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                          ✓ VIN Valid
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                          ⚠ Checksum Invalid
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-300 mb-0.5">{vehicleInfo.engine}</div>
                    <div className="text-xs text-gray-500">{vehicleInfo.plant}</div>
                  </div>

                  {/* Kanan: VIN */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">VIN</div>
                    <div className="font-mono text-sm tracking-[0.15em] font-semibold">
                      <span className="text-gray-400">{vehicleInfo.vin.slice(0, 3)}</span>
                      <span className="text-gray-600 mx-1">·</span>
                      <span className="text-gray-300">{vehicleInfo.vin.slice(3, 9)}</span>
                      <span className="text-gray-600 mx-1">·</span>
                      <span className="text-[#00BFFF]">{vehicleInfo.vin.slice(9)}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{vehicleInfo.make}</div>
                  </div>

                </div>
              </div>
            </div>
          )}
        </div>

        {/* GAUGES */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-4">
          <GaugeIndicator
            label="Bukaan Throttle"
            value={throttle}
            unit="%"
            max={100}
            icon={<Zap />}
            color="#00BFFF"
          />
          <GaugeIndicator
            label="RPM"
            value={safeRPM}
            unit="RPM"
            max={6000}
            icon={<Activity />}
            color="#00BFFF"
          />
          <GaugeIndicator
            label="Kecepatan"
            value={safeSpeed}
            unit="Km/Jam"
            max={180}
            icon={<Gauge />}
            color="#00BFFF"
          />
          <GaugeIndicator
            label="Suhu Coolant"
            value={safeCoolant}
            unit="°C"
            max={120}
            icon={<Thermometer />}
            color={safeCoolant > 100 ? "#ff4444" : "#00BFFF"}
            warning={safeCoolant > 100}
            warningText="Suhu mesin terlalu tinggi"
          />
          <GaugeIndicator
            label="Tegangan Aki"
            value={safeVoltage}
            unit="V"
            max={15}
            icon={<Battery />}
            color={safeVoltage < 12 ? "#ff4444" : "#00ff88"}
            warning={safeVoltage < 12}
            warningText="Tegangan rendah terdeteksi"
            decimalPlaces={1}
          />
        </div>

        {/* CONTROLS */}
        <div className="flex justify-end gap-2 mb-6 flex-wrap">
          <Button
            variant="ghost"
            className="text-[#00BFFF]"
            onClick={() => setShowChart(!showChart)}
          >
            {showChart ? "Sembunyikan Grafik" : "Tampilkan Grafik"}
          </Button>
          <Button
            variant="ghost"
            className={isLogging ? "text-red-500" : "text-[#00BFFF]"}
            onClick={() => {
              if (isLogging) {
                saveTripSummary();
                setIsLogging(false);
              } else {
                startLogging();
              }
            }}
          >
            {isLogging
              ? `● Stop Logging (${logBuffer.length} data)`
              : "Mulai Logging"}
          </Button>

          {/* Export buttons — muncul setelah stop logging */}
          {!isLogging && logBuffer.length > 0 && (
            <>
              <Button
                variant="ghost"
                className="text-green-500"
                onClick={handleExportCSV}
              >
                ↓ Export CSV
              </Button>
              <Button
                variant="ghost"
                className="text-orange-400"
                onClick={handleExportPDF}
                disabled={isExportingPDF}
              >
                {isExportingPDF ? "Generating PDF..." : "↓ Export PDF Laporan"}
              </Button>
            </>
          )}

          {/* Akhiri Sesi */}
          <Button
            variant="ghost"
            className="text-red-400 border border-red-500/30 hover:bg-red-500/10"
            onClick={() => setShowEndModal(true)}
          >
            Akhiri Sesi
          </Button>
        </div>

        {/* CHART */}
        {showChart && (
          <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 mb-8">
            <h2 className="text-lg font-semibold mb-4 text-white">
              Grafik RPM & Kecepatan
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <XAxis dataKey="t" hide />
                  <YAxis stroke="#444" tick={{ fill: "#888" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1a1a24",
                      border: "1px solid #333"
                    }}
                    labelFormatter={() => ""}
                  />
                  <Line
                    type="monotone"
                    dataKey="rpm"
                    stroke="#00BFFF"
                    dot={false}
                    strokeWidth={2}
                    name="RPM"
                  />
                  <Line
                    type="monotone"
                    dataKey="speed"
                    stroke="#00ff88"
                    dot={false}
                    strokeWidth={2}
                    name="Speed (km/h)"
                    opacity={0.8}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* HEALTH SCORE */}
        <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 md:p-8">
          <h2 className="text-xl font-semibold mb-6 text-white">
            Status Kesehatan Mobil
          </h2>
          <div className="flex items-center gap-8">
            <div className="relative w-40 h-40 flex-shrink-0">
              <svg className="w-40 h-40 transform -rotate-90">
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  stroke="#1a1a24"
                  strokeWidth="12"
                  fill="none"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  stroke={healthColor}
                  strokeWidth="12"
                  fill="none"
                  strokeDasharray={`${(healthScore / 100) * 440} 440`}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dasharray 0.5s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-4xl font-bold"
                  style={{ color: healthColor }}
                >
                  {healthScore}
                </span>
                <span className="text-sm text-gray-400">/ 100</span>
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold" style={{ color: healthColor }}>
                {healthLabel}
              </h3>
              <p className="text-gray-400 mb-3">
                Kondisi keseluruhan kendaraan
              </p>
              {dtcCodes && dtcCodes.length > 0 && (
                <div className="text-sm text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>
                    {dtcCodes.length} kode kerusakan aktif mempengaruhi skor
                  </span>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* DTC LIST */}
        <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 md:p-8 mt-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              Daftar Kode Masalah (DTC)
            </h2>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                className="text-[#00BFFF]"
                onClick={fetchDTC}
                disabled={isScanning}
              >
                {isScanning ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Scanning...
                  </span>
                ) : "Scan Ulang"}
              </Button>
              {dtcCodes && dtcCodes.length > 0 && (
                <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
                  <AlertDialogTrigger asChild>
                    <button className="text-sm text-red-500 hover:text-red-400 px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-colors">
                      Hapus
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Hapus semua DTC?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Semua kode kesalahan akan dihapus dari ECU. Kode akan
                        muncul kembali jika masalah belum diperbaiki.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <button
                        onClick={() => setClearOpen(false)}
                        className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
                      >
                        Batal
                      </button>
                      <button
                        onClick={clearDTC}
                        className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors text-sm font-semibold"
                      >
                        Hapus
                      </button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {dtcCodes === null && (
            <div className="text-gray-400">Scanning ECU...</div>
          )}
          {dtcCodes && dtcCodes.length === 0 && (
            <div className="flex items-center gap-2 text-green-400">
              <CircleCheck className="w-4 h-4" />
              <span>Tidak ada kode kerusakan terdeteksi</span>
            </div>
          )}

          <div className="space-y-3">
            {dtcCodes?.map((dtc, i) => {
              const meta = classifyDTC(dtc.code);
              const severityColor =
                meta.severity === "critical"
                  ? "text-red-400 border-red-500/30"
                  : meta.severity === "major"
                  ? "text-yellow-400 border-yellow-500/30"
                  : "text-blue-400 border-blue-500/30";
              const severityLabel =
                meta.severity === "critical"
                  ? "KRITIS"
                  : meta.severity === "major"
                  ? "MAJOR"
                  : "MINOR";

              return (
                <Card
                  key={i}
                  className={`bg-[#0a0a0f] border p-4 cursor-pointer hover:border-[#00BFFF]/50 transition-colors ${severityColor}`}
                  onClick={() => fetchFreezeFrame(dtc.code)}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-white">{dtc.code}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded border font-semibold ${severityColor}`}
                        >
                          {severityLabel}
                        </span>
                        <span className="text-xs text-gray-500">
                          -{meta.scoreDeduction} poin
                        </span>
                      </div>
                      <div className="text-sm text-gray-400">
                        {dtc.description || decodeDTC(dtc.code)}
                      </div>
                    </div>
                    <ChevronRight className="text-[#00BFFF] ml-4 flex-shrink-0" />
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>

        {/* FREEZE FRAME */}
        <AlertDialog open={freezeOpen} onOpenChange={setFreezeOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Detail Kode — {selectedDTC}</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedDTC && decodeDTC(selectedDTC)}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {freezeFrame ? (
              <div className="space-y-2 text-sm">
                <p className="text-gray-400 text-xs mb-3">
                  Kondisi kendaraan saat error terjadi:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0a0a0f] p-2 rounded col-span-2">
                    🕒 {freezeFrame.time}
                  </div>
                  <div className="bg-[#0a0a0f] p-2 rounded">
                    RPM:{" "}
                    <span className="text-[#00BFFF]">
                      {Math.round(freezeFrame.rpm)}
                    </span>
                  </div>
                  <div className="bg-[#0a0a0f] p-2 rounded">
                    Speed:{" "}
                    <span className="text-[#00BFFF]">
                      {Math.round(freezeFrame.speed)} km/h
                    </span>
                  </div>
                  <div className="bg-[#0a0a0f] p-2 rounded">
                    Coolant:{" "}
                    <span className="text-[#00BFFF]">
                      {freezeFrame.coolant}°C
                    </span>
                  </div>
                  <div className="bg-[#0a0a0f] p-2 rounded">
                    Voltage:{" "}
                    <span className="text-[#00BFFF]">
                      {freezeFrame.voltage}V
                    </span>
                  </div>
                  <div className="bg-[#0a0a0f] p-2 rounded">
                    Throttle:{" "}
                    <span className="text-[#00BFFF]">
                      {freezeFrame.throttle?.toFixed(1)}%
                    </span>
                  </div>
                  {freezeFrame.load !== undefined && (
                    <div className="bg-[#0a0a0f] p-2 rounded">
                      Load:{" "}
                      <span className="text-[#00BFFF]">
                        {freezeFrame.load.toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {freezeFrame.map !== undefined && (
                    <div className="bg-[#0a0a0f] p-2 rounded">
                      MAP:{" "}
                      <span className="text-[#00BFFF]">
                        {freezeFrame.map} kPa
                      </span>
                    </div>
                  )}
                  {freezeFrame.fuelTrim !== undefined && (
                    <div className="bg-[#0a0a0f] p-2 rounded">
                      Fuel Trim:{" "}
                      <span className="text-[#00BFFF]">
                        {freezeFrame.fuelTrim?.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {freezeFrame.intakeTemp !== undefined && (
                    <div className="bg-[#0a0a0f] p-2 rounded">
                      Intake Temp:{" "}
                      <span className="text-[#00BFFF]">
                        {freezeFrame.intakeTemp}°C
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-400">
                Freeze frame belum tersedia — klik "Scan Ulang" untuk capture
                data terbaru.
              </div>
            )}

            {selectedDTC && (
              <div
                className={`p-3 rounded-lg text-sm mt-2 ${
                  classifyDTC(selectedDTC).severity === "critical"
                    ? "bg-red-500/10 border border-red-500/30 text-red-300"
                    : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-300"
                }`}
              >
                💡 {classifyDTC(selectedDTC).recommendation}
              </div>
            )}

            <AlertDialogFooter>
              <button
                onClick={() => setFreezeOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors text-sm"
              >
                Tutup
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ENGINE ANALYZE */}
        <Card className="p-6 border-gray-800 bg-[#1a1a24] mt-6">
          <h2 className="text-lg font-semibold mb-4 text-white">
            Analisis Mesin (Live)
          </h2>
          {insights.length === 0 && (
            <div className="flex items-center gap-2 text-green-400">
              <CircleCheck className="w-4 h-4" />
              <span>Mesin dalam kondisi normal</span>
            </div>
          )}
          {insights.map((insight, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-3 mb-3 p-3 rounded-lg border ${
                insight.level === "danger"
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : insight.level === "warning"
                  ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"
              }`}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold uppercase opacity-60 mb-0.5">
                  {insight.parameter}
                </div>
                <div className="text-sm">{insight.message}</div>
              </div>
            </div>
          ))}
        </Card>

        {/* RECOMMENDATION — now DTC-aware */}
        <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 md:p-8 mt-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Rekomendasi</h2>

          {/* DTC-based recommendations — shown first */}
          {dtcRecommendations.map(({ dtc, meta }, i) => (
            <div
              key={i}
              className={`flex gap-4 p-4 rounded-lg border mb-3 ${
                meta.severity === "critical"
                  ? "bg-red-500/10 border-red-500/30"
                  : meta.severity === "major"
                  ? "bg-yellow-500/10 border-yellow-500/30"
                  : "bg-blue-500/10 border-blue-500/30"
              }`}
            >
              <AlertTriangle
                className={`flex-shrink-0 ${
                  meta.severity === "critical"
                    ? "text-red-500"
                    : meta.severity === "major"
                    ? "text-yellow-400"
                    : "text-blue-400"
                }`}
              />
              <div className="flex-1">
                <h4 className="font-semibold text-white mb-1">
                  {dtc.code} —{" "}
                  {meta.severity === "critical"
                    ? "⚠ Perlu Perhatian Segera"
                    : "Perlu Diperiksa"}
                </h4>
                <p className="text-sm text-gray-300">{meta.recommendation}</p>
                <Button
                  size="sm"
                  className="mt-3 bg-[#00BFFF]/10 text-[#00BFFF] border border-[#00BFFF]/30"
                  onClick={() => {
                    const q = encodeURIComponent(
                      "Bengkel spesialis eropa terdekat"
                    );
                    window.open(
                      `https://www.google.com/maps/search/?api=1&query=${q}`,
                      "_blank"
                    );
                  }}
                >
                  <MapPin className="w-4 h-4 mr-2" />
                  Bengkel Terdekat
                </Button>
              </div>
            </div>
          ))}

          {/* Live data warnings */}
          {healthInsight.messages.map((msg, i) => (
            <div
              key={i}
              className="flex gap-4 p-4 bg-[#0a0a0f] rounded-lg border border-gray-800 mb-2"
            >
              <AlertTriangle
                className={
                  healthInsight.level === "danger"
                    ? "text-red-500"
                    : "text-yellow-400"
                }
              />
              <div>
                <h4 className="font-semibold text-white">{msg}</h4>
                <p className="text-sm text-gray-400">
                  Segera lakukan pengecekan untuk mencegah kerusakan lebih
                  lanjut
                </p>
              </div>
            </div>
          ))}

          {/* All clear */}
          {dtcRecommendations.length === 0 &&
            healthInsight.messages.length === 0 && (
              <div className="flex gap-4 p-4 bg-[#0a0a0f] rounded-lg border border-gray-800">
                <CircleCheck className="text-green-400" />
                <div>
                  <h4 className="font-semibold text-white">Kondisi Normal</h4>
                  <p className="text-sm text-gray-400">
                    Tidak ada masalah terdeteksi pada kendaraan
                  </p>
                </div>
              </div>
            )}
        </Card>

        {/* TRIP HISTORY */}
        <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 md:p-8 mt-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-white">
              Riwayat Trip Terakhir
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={exportTripHistory}
                className="text-[#00BFFF]"
              >
                Export
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500"
                onClick={() => {
                  localStorage.removeItem("tripHistory");
                  setTripHistory([]);
                }}
              >
                Clear
              </Button>
            </div>
          </div>

          {tripHistory.length === 0 && (
            <p className="text-gray-400 text-sm">Belum ada trip tersimpan</p>
          )}

          <div className="space-y-3">
            {tripHistory.slice(0, 3).map((trip, idx) => (
              <div
                key={trip.id}
                className="bg-[#0a0a0f] rounded-xl border border-gray-800 p-4 hover:border-[#00BFFF]/30 transition-colors"
              >
                {/* Header: tanggal + durasi */}
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#00BFFF]" />
                    <span className="text-xs text-gray-400">
                      {new Date(trip.date).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric"
                      })}
                      {" • "}
                      {new Date(trip.date).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 bg-[#1a1a24] px-2 py-1 rounded-full">
                    {trip.duration < 60
                      ? `${Math.round(trip.duration)} detik`
                      : `${(trip.duration / 60).toFixed(0)} menit`}
                  </span>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1">Max RPM</div>
                    <div className="text-sm font-bold text-[#00BFFF]">
                      {Math.round(trip.maxRPM).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1">Max Speed</div>
                    <div className="text-sm font-bold text-[#00ff88]">
                      {Math.round(trip.maxSpeed)} km/h
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1">Avg Voltage</div>
                    <div className={`text-sm font-bold ${
                      trip.avgVoltage < 13.2 ? "text-yellow-400" : "text-white"
                    }`}>
                      {Number(trip.avgVoltage).toFixed(1)} V
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-1">Trip ke</div>
                    <div className="text-sm font-bold text-gray-300">
                      #{tripHistory.length - idx}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* =====================
          END SESSION MODAL
      ===================== */}
      {showEndModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop blur */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowEndModal(false)}
          />

          {/* Modal container */}
          <div className="relative z-10 bg-[#0a0a0f] border border-gray-800 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">

            {/* Icon */}
            <div className="flex justify-center mb-5">
              <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <WifiOff className="w-7 h-7 text-red-400" />
              </div>
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-white text-center mb-2">
              Akhiri Sesi Diagnosa?
            </h2>
            <p className="text-gray-400 text-sm text-center mb-8">
              {logBuffer.length > 0
                ? `Terdapat ${logBuffer.length} data log. Unduh laporan sebelum mengakhiri sesi?`
                : "Koneksi OBD-II akan diputus dan kembali ke halaman koneksi."}
            </p>

            {/* Buttons */}
            <div className="flex flex-col gap-3">
              {/* Download PDF */}
              {logBuffer.length > 0 && (
                <button
                  onClick={async () => {
                    await handleExportPDF();
                  }}
                  disabled={isExportingPDF}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 transition-all font-medium disabled:opacity-50"
                >
                  {isExportingPDF ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Generating PDF...
                    </>
                  ) : (
                    <>↓ Unduh PDF Laporan</>
                  )}
                </button>
              )}

              {/* Download CSV */}
              {logBuffer.length > 0 && (
                <button
                  onClick={handleExportCSV}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 transition-all font-medium"
                >
                  ↓ Unduh CSV Data
                </button>
              )}

              {/* End session */}
              <button
                onClick={handleEndSession}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all font-medium"
              >
                Akhiri Sesi Sekarang
              </button>

              {/* Cancel */}
              <button
                onClick={() => setShowEndModal(false)}
                className="w-full px-4 py-3 rounded-xl text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-all text-sm"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
