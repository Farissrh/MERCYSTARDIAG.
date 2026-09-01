/**
 * engineAnalyzer.ts
 *
 * Analisis kondisi mesin real-time berbasis OBD-II PID data.
 * Threshold dikalibrasi untuk Mercedes-Benz W203 C240 (M112 E26, V6 2.6L).
 *
 * Referensi:
 * - Mercedes-Benz W203 Workshop Manual (WIS/ASRA)
 * - SAE J1979 OBD-II PID specification
 * - Bosch Motronic ME 2.8 ECU documentation (digunakan di M112)
 * - Alldata & Mitchell1 service data untuk M112 E26
 */

export interface EngineInsight {
  level: "info" | "warning" | "danger";
  message: string;
  parameter: string; // parameter apa yang trigger ini
}

export interface EngineAnalyzerInput {
  rpm: number;
  speed: number; // km/h
  throttle: number; // % (0–100)
  coolant: number; // °C
  voltage: number; // V

  // Parameter tambahan dari slow PIDs — opsional karena mungkin belum
  // tersedia di tick pertama atau tidak support semua adapter
  load?: number; // % engine load (PID 0104)
  map?: number; // kPa manifold absolute pressure (PID 010B)
  fuelTrim?: number; // % short term fuel trim (PID 0106)
  intakeTemp?: number; // °C intake air temperature (PID 010F)
}

// ─── THRESHOLD CONSTANTS ─────────────────────────────────────────────────────
// Semua nilai berdasarkan spesifikasi M112 E26, bukan asumsi

const M112 = {
  // RPM
  IDLE_RPM_MIN: 580, // Di bawah ini = idle terlalu rendah, risiko stall
  IDLE_RPM_MAX: 850, // Di atas ini saat throttle closed = idle abnormal
  IDLE_RPM_HIGH_WARN: 950, // Warning: idle tinggi (vacuum leak, ICV issue)
  IDLE_RPM_HIGH_CRIT: 1200, // Danger: idle sangat tinggi

  // Coolant — thermostat M112 buka di 87°C, target operasi 85–100°C
  COOLANT_COLD: 60, // Di bawah ini = belum warm up, closed loop belum aktif
  COOLANT_NORMAL_MAX: 100, // Batas atas normal
  COOLANT_WARN: 105, // Warning: mulai overheat
  COOLANT_DANGER: 110, // Danger: overheat serius

  // Voltage — alternator Bosch pada M112 output 13.8–14.4V saat engine on
  VOLT_CHARGING_MIN: 13.2, // Di bawah ini saat rpm > 1000 = alternator suspect
  VOLT_CHARGING_WARN: 12.8, // Warning nyata: alternator kemungkinan tidak charging
  VOLT_DANGER: 12.3, // Danger: jalan dari aki doang, sebentar lagi mati

  // Engine Load (PID 0104) — % dari max torque capability
  LOAD_IDLE_MAX: 30, // Idle normal < 30%
  LOAD_IDLE_HIGH: 45, // Idle > 45% = beban parasitik (AC, power steering berat)
  LOAD_HIGH_SPEED_0: 70, // Load tinggi tapi mobil diam = anomali

  // MAP / Manifold Pressure (PID 010B) — naturally aspirated M112
  // Intake manifold vacuum normal saat idle: ~25–45 kPa (absolute)
  // Atmospheric = ~101 kPa, idle vacuum = ~55–75 kPa vacuum = 26–46 kPa absolute
  MAP_IDLE_MAX: 50, // Di atas ini saat idle = vacuum rendah = suspect vacuum leak
  MAP_IDLE_CRITICAL: 65, // Sangat tinggi = vacuum leak signifikan atau throttle body issue

  // Fuel Trim STFT (PID 0106) — % koreksi injeksi, normal ±10%
  FUEL_TRIM_WARN: 15, // ±15% = ECU struggle, kemungkinan vacuum leak / injector kotor
  FUEL_TRIM_DANGER: 25, // ±25% = masalah serius, misfire atau sensor O2 fault

  // Intake Air Temperature (PID 010F)
  // M112 tidak turbocharged — IAT seharusnya dekat ambient + sedikit heat soak
  INTAKE_TEMP_WARN: 55, // Di atas ini = heat soak / intake restriction
  INTAKE_TEMP_DANGER: 70, // Sangat panas = power loss signifikan, risiko knock

  // Throttle
  THROTTLE_CLOSED: 5 // Di bawah ini = throttle dianggap closed
} as const;

// ─── HELPER ──────────────────────────────────────────────────────────────────

function isIdle(rpm: number, speed: number, throttle: number): boolean {
  return rpm > 400 && speed < 5 && throttle < M112.THROTTLE_CLOSED;
}

function isEngineOn(rpm: number): boolean {
  return rpm > 400;
}

// ─── ANALYZER ────────────────────────────────────────────────────────────────

export function analyzeEngine(data: EngineAnalyzerInput): EngineInsight[] {
  const insights: EngineInsight[] = [];
  const {
    rpm,
    speed,
    throttle,
    coolant,
    voltage,
    load,
    map,
    fuelTrim,
    intakeTemp
  } = data;

  const engineOn = isEngineOn(rpm);
  const idle = isIdle(rpm, speed, throttle);

  if (!engineOn) return insights; // mesin mati, tidak ada yang bisa dianalisis

  // ─── 1. COOLANT TEMPERATURE ──────────────────────────────────
  // Referensi: M112 thermostat 87°C, electric fan trigger ~107°C
  if (coolant > M112.COOLANT_DANGER) {
    insights.push({
      level: "danger",
      parameter: "Suhu Coolant",
      message: `Overheat kritis (${coolant}°C) — matikan AC, segera berhenti dan dinginkan mesin`
    });
  } else if (coolant > M112.COOLANT_WARN) {
    insights.push({
      level: "warning",
      parameter: "Suhu Coolant",
      message: `Suhu mesin tinggi (${coolant}°C) — cek kipas radiator dan level coolant`
    });
  } else if (idle && coolant > M112.COOLANT_NORMAL_MAX) {
    // Overheat saat idle lebih spesifik: kemungkinan kipas elektrik tidak jalan
    insights.push({
      level: "warning",
      parameter: "Suhu Coolant",
      message: `Suhu tinggi saat idle (${coolant}°C) — kemungkinan kipas elektrik tidak berputar`
    });
  }

  // ─── 2. CHARGING VOLTAGE ─────────────────────────────────────
  // Referensi: Bosch alternator M112 = 13.8–14.4V saat engine on
  // 12.x saat engine on = alternator tidak charging = jalan dari aki
  if (voltage > 0) {
    // skip kalau voltage belum terbaca
    if (voltage < M112.VOLT_DANGER) {
      insights.push({
        level: "danger",
        parameter: "Tegangan Aki",
        message: `Tegangan kritis (${voltage.toFixed(
          1
        )}V) — alternator tidak charging, aki akan habis`
      });
    } else if (voltage < M112.VOLT_CHARGING_WARN && rpm > 1000) {
      insights.push({
        level: "warning",
        parameter: "Tegangan Aki",
        message: `Tegangan pengisian rendah (${voltage.toFixed(
          1
        )}V) — cek kondisi alternator dan belt`
      });
    } else if (voltage < M112.VOLT_CHARGING_MIN && rpm > 1000) {
      insights.push({
        level: "info",
        parameter: "Tegangan Aki",
        message: `Tegangan sedikit rendah (${voltage.toFixed(
          1
        )}V) — pantau, normal minimum 13.2V saat mesin hidup`
      });
    }
  }

  // ─── 3. IDLE RPM ─────────────────────────────────────────────
  // Referensi: M112 idle spec 600–750 RPM (warm), cold idle bisa sampai 900
  // Hanya analisis saat warm up selesai (coolant > 70°C)
  if (idle && coolant > 70) {
    if (rpm > M112.IDLE_RPM_HIGH_CRIT) {
      insights.push({
        level: "danger",
        parameter: "RPM Idle",
        message: `RPM idle sangat tinggi (${Math.round(
          rpm
        )} RPM) — kemungkinan vacuum leak besar atau ICV macet terbuka`
      });
    } else if (rpm > M112.IDLE_RPM_HIGH_WARN) {
      insights.push({
        level: "warning",
        parameter: "RPM Idle",
        message: `RPM idle tinggi (${Math.round(
          rpm
        )} RPM) — cek idle control valve (ICV) dan vacuum hose`
      });
    } else if (rpm < M112.IDLE_RPM_MIN) {
      insights.push({
        level: "warning",
        parameter: "RPM Idle",
        message: `RPM idle terlalu rendah (${Math.round(
          rpm
        )} RPM) — risiko stall, cek ICV dan throttle body`
      });
    }
  }

  // ─── 4. ENGINE LOAD ──────────────────────────────────────────
  // Referensi: SAE J1979 — load = (current airflow / max airflow) × 100%
  if (load !== undefined && load > 0) {
    if (idle && load > M112.LOAD_HIGH_SPEED_0) {
      insights.push({
        level: "warning",
        parameter: "Engine Load",
        message: `Beban mesin sangat tinggi saat idle (${load.toFixed(
          0
        )}%) — cek kompresor AC atau power steering`
      });
    } else if (idle && load > M112.LOAD_IDLE_HIGH) {
      insights.push({
        level: "info",
        parameter: "Engine Load",
        message: `Beban idle di atas normal (${load.toFixed(
          0
        )}%) — AC atau aksesori elektrik menarik daya besar`
      });
    }
  }

  // ─── 5. MAP / MANIFOLD PRESSURE ──────────────────────────────
  // Referensi: M112 naturally aspirated
  // Idle vacuum normal = 55–75 cmHg = absolute pressure ~26–46 kPa
  // MAP tinggi saat idle = vacuum rendah = udara masuk tidak lewat throttle = vacuum leak
  if (map !== undefined && map > 0 && idle) {
    if (map > M112.MAP_IDLE_CRITICAL) {
      insights.push({
        level: "danger",
        parameter: "MAP (Vacuum)",
        message: `Vacuum manifold sangat rendah saat idle (${map} kPa) — indikasi vacuum leak besar`
      });
    } else if (map > M112.MAP_IDLE_MAX) {
      insights.push({
        level: "warning",
        parameter: "MAP (Vacuum)",
        message: `Vacuum manifold rendah (${map} kPa, normal < 50 kPa) — kemungkinan vacuum hose bocor`
      });
    }
  }

  // ─── 6. FUEL TRIM (STFT) ─────────────────────────────────────
  // Referensi: Bosch Motronic ME 2.8 — STFT ±10% = normal closed loop
  // Positif = lean (ECU tambah injeksi) = udara berlebih / injeksi kurang
  // Negatif = rich (ECU kurangi injeksi) = bahan bakar berlebih
  if (fuelTrim !== undefined && coolant > 70) {
    // hanya valid saat warm (closed loop aktif)
    const absTrim = Math.abs(fuelTrim);

    if (absTrim > M112.FUEL_TRIM_DANGER) {
      const direction = fuelTrim > 0 ? "lean" : "rich";
      const cause =
        fuelTrim > 0
          ? "vacuum leak, MAF kotor, atau injector lemah"
          : "injector bocor, sensor O2 rusak, atau tekanan BBM terlalu tinggi";
      insights.push({
        level: "danger",
        parameter: "Fuel Trim",
        message: `Fuel trim ekstrem ${
          fuelTrim > 0 ? "+" : ""
        }${fuelTrim.toFixed(1)}% (${direction}) — ${cause}`
      });
    } else if (absTrim > M112.FUEL_TRIM_WARN) {
      const direction =
        fuelTrim > 0 ? "lean (kurang BBM)" : "rich (BBM berlebih)";
      insights.push({
        level: "warning",
        parameter: "Fuel Trim",
        message: `Koreksi fuel trim tinggi ${
          fuelTrim > 0 ? "+" : ""
        }${fuelTrim.toFixed(
          1
        )}% — campuran ${direction}, cek injector dan MAF sensor`
      });
    }
  }

  // ─── 7. INTAKE AIR TEMPERATURE ───────────────────────────────
  // Referensi: M112 tidak turbocharged, IAT seharusnya ambient + 5–15°C heat soak
  // IAT tinggi = intake restriction atau heat soak parah → power loss
  if (intakeTemp !== undefined && intakeTemp > 0) {
    if (intakeTemp > M112.INTAKE_TEMP_DANGER) {
      insights.push({
        level: "danger",
        parameter: "Intake Temp",
        message: `Suhu intake sangat tinggi (${intakeTemp}°C) — risiko knocking, cek filter udara dan saluran intake`
      });
    } else if (intakeTemp > M112.INTAKE_TEMP_WARN) {
      insights.push({
        level: "info",
        parameter: "Intake Temp",
        message: `Suhu intake tinggi (${intakeTemp}°C) — heat soak, performa sedikit berkurang`
      });
    }
  }

  // ─── 8. CROSS-PARAMETER: VACUUM LEAK CONFIDENCE ──────────────
  // Vacuum leak biasanya trigger KOMBINASI: RPM idle tinggi + MAP tinggi + fuel trim positif
  // Kalau 2+ kondisi ini muncul bersamaan, tingkatkan confidence
  const vacuumLeakSignals = [
    idle && rpm > M112.IDLE_RPM_HIGH_WARN,
    map !== undefined && map > M112.MAP_IDLE_MAX && idle,
    fuelTrim !== undefined && fuelTrim > M112.FUEL_TRIM_WARN
  ].filter(Boolean).length;

  if (vacuumLeakSignals >= 2) {
    // Hapus warning individual yang sudah ada, ganti dengan diagnosis yang lebih spesifik
    // (hanya push kalau belum ada warning vacuum leak dari kondisi individual)
    const alreadyHasVacuumWarning = insights.some(
      i =>
        i.parameter === "MAP (Vacuum)" ||
        i.message.toLowerCase().includes("vacuum")
    );

    if (!alreadyHasVacuumWarning) {
      insights.push({
        level: "warning",
        parameter: "Vacuum Leak",
        message: `Multiple indikator vacuum leak aktif (RPM, MAP, Fuel Trim) — periksa semua vacuum hose dan intake gasket`
      });
    }
  }

  // ─── 9. CROSS-PARAMETER: ALTERNATOR LOAD vs VOLTAGE ─────────
  // Voltage rendah + load tinggi saat idle = alternator kewalahan atau rusak
  if (
    voltage > 0 &&
    voltage < M112.VOLT_CHARGING_MIN &&
    load !== undefined &&
    load > M112.LOAD_IDLE_HIGH &&
    idle
  ) {
    const alreadyHasVoltWarning = insights.some(
      i => i.parameter === "Tegangan Aki"
    );
    if (!alreadyHasVoltWarning) {
      insights.push({
        level: "warning",
        parameter: "Alternator",
        message: `Beban tinggi + tegangan rendah (${voltage.toFixed(
          1
        )}V, load ${load.toFixed(0)}%) — alternator kemungkinan overloaded`
      });
    }
  }

  return insights;
}
