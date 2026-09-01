import { Activity, Car, Shield, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      {/* ================= HEADER ================= */}
      <header className="border-b border-gray-800 bg-[#0a0a0f]/90 backdrop-blur-sm fixed top-0 left-0 right-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-0">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
              <img
                src="/public/mb logo.png"
                alt="Mercedes-Benz"
                className="w-10 h-10 object-contain"
              />
            </div>
            <span className="font-semibold text-lg">MERCYSTARDIAG</span>
          </div>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <main className="pt-20">
        <div className="relative container mx-auto px-4 py-16 md:py-24">
          {/* Siluet W203 — background dekoratif */}
          <div className="absolute inset-0 flex items-end justify-center pointer-events-none overflow-hidden">
            <img
              src="/public/mb logo.png"
              alt=""
              className="w-full max-w-4xl object-contain opacity-[0.06] select-none"
              draggable={false}
            />
          </div>

          <div className="max-w-4xl mx-auto text-center relative z-10">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-[#00BFFF]/10 border border-[#00BFFF]/20">
              <Activity className="w-4 h-4 text-[#00BFFF]" />
              <span className="text-sm text-[#00BFFF]">
                Teknologi OBD-II Real-Time
              </span>
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
              Deteksi Kerusakan Mobil Lebih Cepat dari Mekanik
            </h1>

            {/* Subtitle */}
            <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
              Analisis Real-Time, Hindari Kerusakan Mahal, Selalu Aman di Jalan
            </p>

            {/* CTA */}
            <Button
              onClick={() => navigate("/connect")}
              className="bg-[#00BFFF] hover:bg-[#00a8e6] text-black px-8 py-6 text-lg rounded-xl shadow-lg shadow-[#00BFFF]/20 hover:shadow-[#00BFFF]/40 transition-all"
            >
              Mulai Diagnosa Sekarang
            </Button>

            {/* ================= VISUAL ================= */}
            <div className="relative mt-16">
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-transparent z-10" />
              <div className="bg-gradient-to-br from-[#00BFFF]/20 to-purple-500/20 rounded-3xl p-1">
                <div className="bg-[#12121a] rounded-3xl p-8 md:p-12">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Feature
                      icon={<Activity className="w-8 h-8 text-[#00BFFF]" />}
                      title="Real-Time"
                      subtitle="Monitoring"
                    />
                    <Feature
                      icon={<Shield className="w-8 h-8 text-[#00BFFF]" />}
                      title="100%"
                      subtitle="Akurat"
                    />
                    <Feature
                      icon={<Car className="w-8 h-8 text-[#00BFFF]" />}
                      title="OBD-II"
                      subtitle="Compatible"
                    />
                    <Feature
                      icon={<Star className="w-8 h-8 text-[#00BFFF]" />}
                      title="User"
                      subtitle="Friendly"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================= FOOTER ================= */}
        <div className="border-t border-gray-800 py-12">
          <div className="container mx-auto px-4 text-center">
            <p className="text-gray-500">Build with passion by Faris Rayhan</p>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ================= FEATURE CARD ================= */
function Feature({
  icon,
  title,
  subtitle
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] p-6 rounded-xl border border-gray-800">
      {icon}
      <div className="text-2xl font-bold text-white mt-3">{title}</div>
      <div className="text-sm text-gray-400 mt-1">{subtitle}</div>
    </div>
  );
}
