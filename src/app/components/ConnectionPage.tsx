import {
  Bluetooth,
  Car,
  CheckCircle,
  Loader,
  Wifi,
  XCircle,
  Zap
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useECUConnection } from "../../context/ECUContext";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

/* =====================
   TYPES
===================== */
type ConnectionState =
  | "idle"
  | "connecting"
  | "pinging"
  | "connected"
  | "failed";

/* =====================
   COMPONENT
===================== */
export function ConnectionPage() {
  const navigate = useNavigate();
  const { transport, mode, setMode, setEcuConnected } = useECUConnection();
  const [state, setState] = useState<ConnectionState>("idle");

  /* =====================
     CONNECT HANDLER
  ===================== */
  const handleConnect = async () => {
    try {
      setState("connecting");

      await transport.connect();

      setEcuConnected(true);
      setState("connected");

      toast.success("ECU Terhubung");

      setTimeout(() => {
        navigate("/dashboard");
      }, 800);
    } catch (err) {
      console.error(err);
      setEcuConnected(false);
      setState("failed");
      toast.error("Gagal terhubung");
    }
  };

  /* =====================
     RENDER
  ===================== */
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Siluet W203 — background dekoratif */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <img
          src="/public/mb logo.png"
          alt=""
          className="w-full max-w-4xl object-contain opacity-[0.06] select-none"
          draggable={false}
        />
      </div>

      <div className="max-w-3xl w-full relative z-10">
        {/* ================= HEADER ================= */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Langkah 1: Hubungkan Perangkat OBD-II Anda
          </h1>

          <p className="text-gray-400 text-lg">
            Ikuti langkah mudah berikut untuk memulai diagnosa
          </p>
        </div>

        {/* ================= STEPS ================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* STEP 1 */}
          <Card className="bg-[#12121a] border-gray-800 p-6 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-[#00BFFF]/10 rounded-full flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-[#00BFFF]" />
              </div>
              <div className="w-8 h-8 bg-[#00BFFF] rounded-full flex items-center justify-center mb-3">
                <span className="text-black font-bold">1</span>
              </div>
              <h3 className="font-semibold mb-2 text-white">Colokkan OBD-II</h3>
              <p className="text-sm text-gray-400">
                Sambungkan perangkat OBD-II ke port di bawah dashboard
              </p>
            </div>
          </Card>

          {/* STEP 2 */}
          <Card className="bg-[#12121a] border-gray-800 p-6 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-[#00BFFF]/10 rounded-full flex items-center justify-center mb-4">
                <Car className="w-6 h-6 text-[#00BFFF]" />
              </div>
              <div className="w-8 h-8 bg-[#00BFFF] rounded-full flex items-center justify-center mb-3">
                <span className="text-black font-bold">2</span>
              </div>
              <h3 className="font-semibold mb-2 text-white">Nyalakan Mesin</h3>
              <p className="text-sm text-gray-400">
                Start mesin atau putar kunci ke posisi ON
              </p>
            </div>
          </Card>

          {/* STEP 3 */}
          <Card className="bg-[#12121a] border-gray-800 p-6 text-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-[#00BFFF]/10 rounded-full flex items-center justify-center mb-4">
                <div className="flex gap-1">
                  <Bluetooth className="w-5 h-5 text-[#00BFFF]" />
                  <Wifi className="w-5 h-5 text-[#00BFFF]" />
                </div>
              </div>
              <div className="w-8 h-8 bg-[#00BFFF] rounded-full flex items-center justify-center mb-3">
                <span className="text-black font-bold">3</span>
              </div>
              <h3 className="font-semibold mb-2 text-white">
                Sambungkan Bluetooth
              </h3>
              <p className="text-sm text-gray-400">
                Aktifkan Bluetooth / WiFi lalu tekan tombol di bawah
              </p>
            </div>
          </Card>
        </div>

        {/* ================= ACTION ================= */}
        <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-8 text-center">
          {/* MODE SELECTOR */}
          <div className="flex justify-center gap-4 mb-1">
            <button
              onClick={() => setMode("backend")}
              className={`px-4 py-2 rounded-lg border text-sm ${
                mode === "backend"
                  ? "bg-[#00BFFF] text-black border-[#00BFFF]"
                  : "bg-transparent border-gray-600 text-gray-400"
              }`}
            >
              Backend Mode
            </button>

            <button
              onClick={() => setMode("wifi")}
              className={`px-4 py-2 rounded-lg border text-sm ${
                mode === "wifi"
                  ? "bg-[#00BFFF] text-black border-[#00BFFF]"
                  : "bg-transparent border-gray-600 text-gray-400"
              }`}
            >
              WiFi Mode
            </button>
          </div>

          <button
            onClick={() => setMode("mock")}
            className={`px-4 py-2 rounded-lg border text-sm ${
              mode === "mock"
                ? "bg-[#00BFFF] text-black border-[#00BFFF]"
                : "bg-transparent border-gray-600 text-gray-400"
            }`}
          >
            Mock Mode
          </button>

          {state === "idle" && (
            <>
              <Button
                onClick={handleConnect}
                className="bg-[#00BFFF] hover:bg-[#00a8e6] text-black px-12 py-6 text-lg rounded-xl"
              >
                <Bluetooth className="w-5 h-5 mr-2" />
                Hubungkan dengan OBD-II
              </Button>
              <p className="text-sm text-gray-500 mt-1">
                Pastikan OBD-II terpasang dan mesin menyala
              </p>
            </>
          )}

          {(state === "connecting" || state === "pinging") && (
            <div className="py-8">
              <Loader className="w-12 h-12 text-[#00BFFF] animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2 text-white">
                {state === "connecting"
                  ? "Menghubungkan perangkat..."
                  : "Ping ECU..."}
              </h3>
              <p className="text-gray-400">Mohon tunggu sebentar</p>
            </div>
          )}

          {state === "connected" && (
            <div className="py-8">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-green-500">
                ECU Terhubung
              </h3>
            </div>
          )}

          {state === "failed" && (
            <div className="py-8">
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-red-500 mb-4">
                Gagal Terhubung
              </h3>
              <Button onClick={handleConnect} variant="outline">
                Coba Lagi
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
