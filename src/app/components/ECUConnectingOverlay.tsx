import { Loader2 } from "lucide-react";

export function ECUConnectingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-[#0a0a0f] border border-gray-800 rounded-xl p-6 flex items-center gap-4">
        <Loader2 className="w-6 h-6 animate-spin text-[#00BFFF]" />
        <div>
          <div className="font-semibold">Menghubungkan ke ECU</div>
          <div className="text-sm text-gray-400">
            Menunggu respon kendaraan…
          </div>
        </div>
      </div>
    </div>
  );
}
