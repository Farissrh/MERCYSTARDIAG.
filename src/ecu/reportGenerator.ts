/**
 * reportGenerator.ts
 *
 * Generate CSV (raw data) dan PDF (laporan lengkap) dari trip log.
 * PDF dibuat di browser menggunakan jsPDF — tidak perlu backend.
 *
 * Dependencies yang perlu diinstall:
 *   npm install jspdf
 */

import { DTCResult } from "./ECUTransport";
import { classifyDTC } from "./dtcClassifier";
import { EngineInsight } from "./engineAnalyzer";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface LogItem {
  time: string;
  rpm: number;
  speed: number;
  throttle: number;
  coolant: number;
  voltage: number;
}

export interface TripReport {
  startTime: string;
  endTime: string;
  durationSec: number;
  logData: LogItem[];
  dtcList: DTCResult[];
  insights: EngineInsight[];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function computeSummary(log: LogItem[]) {
  if (!log.length)
    return {
      maxRPM: 0,
      maxSpeed: 0,
      avgVoltage: 0,
      avgCoolant: 0,
      avgThrottle: 0
    };

  return {
    maxRPM: Math.max(...log.map(r => r.rpm)),
    maxSpeed: Math.max(...log.map(r => r.speed)),
    avgVoltage: +(log.reduce((s, r) => s + r.voltage, 0) / log.length).toFixed(
      2
    ),
    avgCoolant: +(log.reduce((s, r) => s + r.coolant, 0) / log.length).toFixed(
      1
    ),
    avgThrottle: +(
      log.reduce((s, r) => s + r.throttle, 0) / log.length
    ).toFixed(1)
  };
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} menit ${s} detik`;
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

export function exportCSV(report: TripReport): void {
  const { logData, dtcList, insights, startTime, endTime, durationSec } =
    report;
  const summary = computeSummary(logData);

  const sections: string[] = [];

  // Section 1: Trip Summary
  sections.push("=== RINGKASAN TRIP ===");
  sections.push(`Waktu Mulai,${startTime}`);
  sections.push(`Waktu Selesai,${endTime}`);
  sections.push(`Durasi,${formatDuration(durationSec)}`);
  sections.push(`Max RPM,${Math.round(summary.maxRPM)}`);
  sections.push(`Max Speed,${Math.round(summary.maxSpeed)} km/h`);
  sections.push(`Avg Voltage,${summary.avgVoltage} V`);
  sections.push(`Avg Coolant,${summary.avgCoolant} °C`);
  sections.push(`Avg Throttle,${summary.avgThrottle} %`);
  sections.push("");

  // Section 2: DTC List
  sections.push("=== KODE KERUSAKAN (DTC) ===");
  if (dtcList.length === 0) {
    sections.push("Tidak ada DTC terdeteksi");
  } else {
    sections.push("Kode,Severity,Deskripsi,Rekomendasi");
    dtcList.forEach(dtc => {
      const meta = classifyDTC(dtc.code);
      // Escape comma dalam rekomendasi
      const rec = `"${meta.recommendation.replace(/"/g, '""')}"`;
      const desc = `"${(dtc.description || "").replace(/"/g, '""')}"`;
      sections.push(
        `${dtc.code},${meta.severity.toUpperCase()},${desc},${rec}`
      );
    });
  }
  sections.push("");

  // Section 3: Engine Analysis
  sections.push("=== ANALISIS MESIN (AKTIF SELAMA TRIP) ===");
  if (insights.length === 0) {
    sections.push("Tidak ada anomali terdeteksi selama trip");
  } else {
    sections.push("Level,Parameter,Pesan");
    insights.forEach(i => {
      const msg = `"${i.message.replace(/"/g, '""')}"`;
      sections.push(`${i.level.toUpperCase()},${i.parameter},${msg}`);
    });
  }
  sections.push("");

  // Section 4: Raw Data
  sections.push("=== DATA LOG PER DETIK ===");
  sections.push("Waktu,RPM,Speed (km/h),Throttle (%),Coolant (°C),Voltage (V)");
  logData.forEach(r => {
    sections.push(
      `${r.time},${Math.round(r.rpm)},${Math.round(
        r.speed
      )},${r.throttle.toFixed(1)},${r.coolant.toFixed(1)},${r.voltage.toFixed(
        2
      )}`
    );
  });

  const csv = sections.join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mercydiag-trip-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PDF EXPORT ───────────────────────────────────────────────────────────────

export async function exportPDF(report: TripReport): Promise<void> {
  // Dynamic import — hanya load jsPDF saat dibutuhkan
  const { jsPDF } = await import("jspdf");

  const { logData, dtcList, insights, startTime, endTime, durationSec } =
    report;
  const summary = computeSummary(logData);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth(); // 210mm
  const H = doc.internal.pageSize.getHeight(); // 297mm
  const ML = 15; // margin left
  const MR = 15; // margin right
  const CW = W - ML - MR; // content width
  let y = 20;

  // ── COLOR PALETTE ──
  const C = {
    dark: [10, 10, 15] as [number, number, number],
    blue: [0, 191, 255] as [number, number, number],
    green: [0, 255, 136] as [number, number, number],
    yellow: [255, 179, 0] as [number, number, number],
    red: [255, 68, 68] as [number, number, number],
    gray: [100, 100, 120] as [number, number, number],
    white: [255, 255, 255] as [number, number, number],
    surface: [26, 26, 36] as [number, number, number]
  };

  // ── HELPERS ──
  const newPageIfNeeded = (needed: number) => {
    if (y + needed > H - 20) {
      doc.addPage();
      y = 20;
      drawPageHeader();
    }
  };

  const drawPageHeader = () => {
    doc.setFillColor(...C.dark);
    doc.rect(0, 0, W, 14, "F");
    doc.setTextColor(...C.blue);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("MERCYSTARDIAG — Laporan Trip", ML, 9);
    doc.setTextColor(...C.gray);
    doc.text(`Mercedes-Benz W203 C240`, W - MR, 9, { align: "right" });
  };

  const sectionTitle = (title: string) => {
    newPageIfNeeded(14);
    doc.setFillColor(...C.surface);
    doc.roundedRect(ML, y, CW, 10, 2, 2, "F");
    doc.setTextColor(...C.blue);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(title, ML + 4, y + 6.5);
    y += 14;
  };

  const labelValue = (
    label: string,
    value: string,
    color?: [number, number, number]
  ) => {
    newPageIfNeeded(8);
    doc.setTextColor(...C.gray);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(label, ML + 2, y);
    doc.setTextColor(...(color ?? C.white));
    doc.setFont("helvetica", "bold");
    doc.text(value, ML + 60, y);
    y += 7;
  };

  const divider = () => {
    doc.setDrawColor(...C.surface);
    doc.setLineWidth(0.3);
    doc.line(ML, y, W - MR, y);
    y += 4;
  };

  // ══════════════════════════════════════════════════════════════
  // PAGE 1 — HEADER + SUMMARY + DTC
  // ══════════════════════════════════════════════════════════════

  // Cover header
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, W, H, "F");

  // Title block
  doc.setFillColor(...C.surface);
  doc.roundedRect(ML, y, CW, 28, 3, 3, "F");

  doc.setTextColor(...C.blue);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("LAPORAN DIAGNOSA KENDARAAN", ML + CW / 2, y + 10, {
    align: "center"
  });

  doc.setTextColor(...C.gray);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Mercedes-Benz W203 C240  •  MERCYSTARDIAG", ML + CW / 2, y + 18, {
    align: "center"
  });
  doc.text(
    `Digenerate: ${new Date().toLocaleString("id-ID")}`,
    ML + CW / 2,
    y + 24,
    { align: "center" }
  );
  y += 36;

  // ── SECTION: RINGKASAN TRIP ──
  sectionTitle("RINGKASAN TRIP");

  labelValue("Waktu Mulai", startTime);
  labelValue("Waktu Selesai", endTime);
  labelValue("Durasi Total", formatDuration(durationSec), C.blue);
  labelValue("Total Data Point", `${logData.length} sampel`);
  divider();

  // Stats 2-column
  const statBoxW = (CW - 4) / 2;
  const statBoxH = 22;
  const stats = [
    {
      label: "Max RPM",
      value: `${Math.round(summary.maxRPM)} RPM`,
      color: C.blue
    },
    {
      label: "Max Speed",
      value: `${Math.round(summary.maxSpeed)} km/h`,
      color: C.green
    },
    {
      label: "Avg Voltage",
      value: `${summary.avgVoltage} V`,
      color: summary.avgVoltage < 13.2 ? C.red : C.green
    },
    {
      label: "Avg Coolant",
      value: `${summary.avgCoolant} °C`,
      color: summary.avgCoolant > 100 ? C.red : C.white
    }
  ];

  newPageIfNeeded(statBoxH + 6);
  stats.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = ML + col * (statBoxW + 4);
    const by = y + row * (statBoxH + 4);

    doc.setFillColor(...C.surface);
    doc.roundedRect(bx, by, statBoxW, statBoxH, 2, 2, "F");

    doc.setTextColor(...C.gray);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(s.label.toUpperCase(), bx + 4, by + 8);

    doc.setTextColor(...s.color);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(s.value, bx + 4, by + 18);
  });
  y += statBoxH * 2 + 12;

  // ── SECTION: KODE KERUSAKAN (DTC) ──
  sectionTitle("KODE KERUSAKAN (DTC)");

  if (dtcList.length === 0) {
    newPageIfNeeded(12);
    doc.setFillColor(0, 60, 30);
    doc.roundedRect(ML, y, CW, 10, 2, 2, "F");
    doc.setTextColor(...C.green);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      "✓  Tidak ada kode kerusakan terdeteksi selama trip",
      ML + 4,
      y + 6.5
    );
    y += 16;
  } else {
    dtcList.forEach(dtc => {
      const meta = classifyDTC(dtc.code);
      const color =
        meta.severity === "critical"
          ? C.red
          : meta.severity === "major"
          ? C.yellow
          : C.blue;
      const bgColor: [number, number, number] =
        meta.severity === "critical"
          ? [40, 10, 10]
          : meta.severity === "major"
          ? [40, 30, 0]
          : [10, 20, 40];

      // Hitung tinggi box berdasar panjang teks rekomendasi
      const recLines = doc.splitTextToSize(meta.recommendation, CW - 30);
      const boxH = 10 + recLines.length * 5 + 6;

      newPageIfNeeded(boxH + 4);

      doc.setFillColor(...bgColor);
      doc.roundedRect(ML, y, CW, boxH, 2, 2, "F");

      // Left accent bar
      doc.setFillColor(...color);
      doc.roundedRect(ML, y, 3, boxH, 1, 1, "F");

      // DTC code
      doc.setTextColor(...color);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(dtc.code, ML + 7, y + 8);

      // Severity badge
      doc.setFontSize(7);
      doc.text(`[${meta.severity.toUpperCase()}]`, ML + 30, y + 8);

      // Score deduction
      doc.setTextColor(...C.gray);
      doc.setFontSize(7);
      doc.text(`-${meta.scoreDeduction} poin`, W - MR, y + 8, {
        align: "right"
      });

      // Description
      doc.setTextColor(...C.white);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const descLines = doc.splitTextToSize(dtc.description || "", CW - 30);
      doc.text(descLines, ML + 7, y + 14);

      // Recommendation
      doc.setTextColor(...C.gray);
      doc.setFontSize(7.5);
      doc.text(recLines, ML + 7, y + 14 + descLines.length * 4.5);

      y += boxH + 4;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // PAGE 2 — ENGINE INSIGHTS + GRAFIK
  // ══════════════════════════════════════════════════════════════
  doc.addPage();
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, W, H, "F");
  drawPageHeader();
  y = 20;

  // ── SECTION: ANALISIS MESIN ──
  sectionTitle("ANALISIS MESIN (AKTIF SELAMA TRIP)");

  if (insights.length === 0) {
    newPageIfNeeded(12);
    doc.setFillColor(0, 60, 30);
    doc.roundedRect(ML, y, CW, 10, 2, 2, "F");
    doc.setTextColor(...C.green);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(
      "✓  Tidak ada anomali mesin terdeteksi selama trip",
      ML + 4,
      y + 6.5
    );
    y += 16;
  } else {
    insights.forEach(insight => {
      const color: [number, number, number] =
        insight.level === "danger"
          ? C.red
          : insight.level === "warning"
          ? C.yellow
          : C.blue;
      const bgColor: [number, number, number] =
        insight.level === "danger"
          ? [40, 10, 10]
          : insight.level === "warning"
          ? [40, 30, 0]
          : [10, 20, 40];

      const msgLines = doc.splitTextToSize(insight.message, CW - 30);
      const boxH = 8 + msgLines.length * 5 + 2;

      newPageIfNeeded(boxH + 4);

      doc.setFillColor(...bgColor);
      doc.roundedRect(ML, y, CW, boxH, 2, 2, "F");

      doc.setFillColor(...color);
      doc.roundedRect(ML, y, 3, boxH, 1, 1, "F");

      doc.setTextColor(...color);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(insight.parameter.toUpperCase(), ML + 7, y + 6);

      doc.setTextColor(...C.white);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(msgLines, ML + 7, y + 12);

      y += boxH + 4;
    });
  }

  y += 6;

  // ── SECTION: GRAFIK RPM & SPEED ──
  sectionTitle("GRAFIK RPM & KECEPATAN");

  newPageIfNeeded(90);

  const GX = ML;
  const GY = y;
  const GW = CW;
  const GH = 75;
  const padX = 14; // lebih lebar untuk label Y-axis
  const padY = 8;
  const plotW = GW - padX * 2;
  const plotH = GH - padY * 2 - 10; // -10 untuk legend di atas

  // Background grafik
  doc.setFillColor(...C.surface);
  doc.roundedRect(GX, GY, GW, GH, 2, 2, "F");

  // Legend di atas — sebelum gambar garis
  const legendY = GY + 6;
  doc.setFillColor(...C.blue);
  doc.rect(GX + padX, legendY - 1.5, 8, 2, "F");
  doc.setTextColor(...C.blue);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.text("RPM", GX + padX + 10, legendY + 0.5);

  doc.setFillColor(...C.green);
  doc.rect(GX + padX + 30, legendY - 1.5, 8, 2, "F");
  doc.setTextColor(...C.green);
  doc.text("Speed (km/h)", GX + padX + 40, legendY + 0.5);
  doc.setFont("helvetica", "normal");

  // Sample data — ambil max 120 titik supaya grafik tidak terlalu padat
  const sample =
    logData.length > 120
      ? logData.filter((_, i) => i % Math.ceil(logData.length / 120) === 0)
      : logData;

  if (sample.length > 1) {
    const maxRPM = Math.max(...sample.map(r => r.rpm), 1000);
    const maxSpeed = Math.max(...sample.map(r => r.speed), 10);

    // Plot area origin
    const plotOriginX = GX + padX;
    const plotOriginY = GY + padY + 8; // +8 untuk legend di atas

    // Grid lines
    doc.setDrawColor(20, 20, 30);
    doc.setLineWidth(0.2);
    [0.25, 0.5, 0.75, 1.0].forEach(f => {
      const gy = plotOriginY + plotH * (1 - f);
      doc.line(plotOriginX, gy, plotOriginX + plotW, gy);
    });

    // Y-axis labels kiri (RPM) — biru
    doc.setTextColor(...C.blue);
    doc.setFontSize(5);
    [0, 0.5, 1.0].forEach(f => {
      const val = Math.round(maxRPM * f);
      const gy = plotOriginY + plotH * (1 - f);
      doc.text(`${val}`, plotOriginX - 2, gy + 1, { align: "right" });
    });

    // Y-axis labels kanan (Speed) — hijau
    doc.setTextColor(...C.green);
    [0, 0.5, 1.0].forEach(f => {
      const val = Math.round(maxSpeed * f);
      const gy = plotOriginY + plotH * (1 - f);
      doc.text(`${val}`, plotOriginX + plotW + 2, gy + 1, { align: "left" });
    });

    // RPM line (biru) — pakai skala kiri
    doc.setDrawColor(...C.blue);
    doc.setLineWidth(0.7);
    sample.forEach((r, i) => {
      if (i === 0) return;
      const x1 = plotOriginX + ((i - 1) / (sample.length - 1)) * plotW;
      const y1 = plotOriginY + plotH * (1 - sample[i - 1].rpm / maxRPM);
      const x2 = plotOriginX + (i / (sample.length - 1)) * plotW;
      const y2 = plotOriginY + plotH * (1 - r.rpm / maxRPM);
      doc.line(x1, y1, x2, y2);
    });

    // Speed line (hijau) — pakai skala KANAN (terpisah dari RPM)
    doc.setDrawColor(...C.green);
    doc.setLineWidth(0.7);
    sample.forEach((r, i) => {
      if (i === 0) return;
      const x1 = plotOriginX + ((i - 1) / (sample.length - 1)) * plotW;
      const y1 = plotOriginY + plotH * (1 - sample[i - 1].speed / maxSpeed);
      const x2 = plotOriginX + (i / (sample.length - 1)) * plotW;
      const y2 = plotOriginY + plotH * (1 - r.speed / maxSpeed);
      doc.line(x1, y1, x2, y2);
    });
  }

  y += GH + 10;

  // ── FOOTER ──
  newPageIfNeeded(16);
  doc.setFillColor(...C.surface);
  doc.roundedRect(ML, y, CW, 14, 2, 2, "F");
  doc.setTextColor(...C.gray);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Laporan ini digenerate otomatis oleh MERCYSTARDIAG. Gunakan sebagai referensi, bukan pengganti diagnosis profesional.",
    ML + CW / 2,
    y + 5.5,
    { align: "center" }
  );
  doc.text("Build with passion by Faris Rayhan", ML + CW / 2, y + 10.5, {
    align: "center"
  });

  // ── PAGE NUMBERS ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setTextColor(...C.gray);
    doc.setFontSize(7);
    doc.text(`Halaman ${i} dari ${totalPages}`, W - MR, H - 8, {
      align: "right"
    });
  }

  doc.save(`mercydiag-laporan-${Date.now()}.pdf`);
}
