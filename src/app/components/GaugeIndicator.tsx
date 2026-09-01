import { TriangleAlert } from "lucide-react";
import { ReactNode } from "react";
import { Card } from "./ui/card";

interface GaugeIndicatorProps {
  label: string;
  value: number;
  unit: string;
  max: number;
  icon: ReactNode;
  color?: string;
  warning?: boolean;
  warningText?: string;
  decimalPlaces?: number;
}

export function GaugeIndicator({
  label,
  value,
  unit,
  max,
  icon,
  color = "#00BFFF",
  warning = false,
  warningText,
  decimalPlaces = 0
}: GaugeIndicatorProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const displayColor = warning ? "#ff4444" : color;

  return (
    <Card className="bg-gradient-to-br from-[#1a1a24] to-[#12121a] border-gray-800 p-6 hover:border-[#00BFFF]/50 transition-all relative overflow-hidden">
      {/* Background Glow Effect */}
      <div
        className="absolute inset-0 opacity-5 blur-3xl"
        style={{ backgroundColor: displayColor }}
      ></div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-gray-400">
            <div style={{ color: displayColor }}>{icon}</div>
            <span className="text-sm">{label}</span>
          </div>
          {warning && (
            <TriangleAlert className="w-4 h-4 text-red-500" />
          )}
        </div>

        {/* Value Display */}
        <div className="mb-4">
          <div className="flex items-baseline gap-2">
            <span
              className="text-3xl md:text-4xl font-bold transition-all duration-300"
              style={{ color: displayColor }}
            >
              {decimalPlaces > 0 ? value.toFixed(decimalPlaces) : Math.round(value)}
            </span>
            <span className="text-lg text-gray-500">{unit}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative">
          <div className="h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${percentage}%`,
                backgroundColor: displayColor,
                boxShadow: `0 0 10px ${displayColor}40`
              }}
            ></div>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-600">0</span>
            <span className="text-xs text-gray-600">{max}</span>
          </div>
        </div>

        {/* Warning Text */}
        {warning && (
          <div className="mt-3 text-xs text-red-400 flex items-center gap-1">
            <TriangleAlert className="w-3 h-3" />
            <span>{warningText || "Tegangan rendah terdeteksi"}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
