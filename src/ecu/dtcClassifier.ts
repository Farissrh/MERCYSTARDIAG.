/**
 * dtcClassifier.ts
 *
 * Klasifikasi DTC dengan rekomendasi spesifik per kode.
 * Dikalibrasi untuk Mercedes-Benz W203 C240 (M112 E26, V6 2.6L).
 *
 * Referensi:
 * - Mercedes-Benz W203 Workshop Manual (WIS/ASRA)
 * - Bosch Motronic ME 2.8 service documentation
 * - SAE J2012 DTC format standard
 */

export type DTCSeverity = "critical" | "major" | "minor";

export interface DTCMeta {
  severity: DTCSeverity;
  recommendation: string;
  scoreDeduction: number;
}

// ─── PER-CODE LOOKUP TABLE ────────────────────────────────────────────────────
// Kode yang paling umum di W203 + semua kode di dtcDecorder.ts
// Diurutkan dari yang paling kritis

const DTC_SPECIFIC: Record<string, DTCMeta> = {
  // ── MISFIRE ──────────────────────────────────────────────────────────────
  P0300: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Misfire acak di banyak silinder. Bisa merusak catalytic converter jika dibiarkan. Cek busi, koil, dan injector. Jangan gas di RPM tinggi."
  },
  P0301: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 1. Cek busi, koil pengapian, dan injector silinder 1. Lanjut berkendara bisa merusak catalyst."
  },
  P0302: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 2. Cek busi, koil pengapian, dan injector silinder 2."
  },
  P0303: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 3. Cek busi, koil pengapian, dan injector silinder 3."
  },
  P0304: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 4. Cek busi, koil pengapian, dan injector silinder 4."
  },
  P0305: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 5. Cek busi, koil pengapian, dan injector silinder 5."
  },
  P0306: {
    severity: "critical",
    scoreDeduction: 30,
    recommendation:
      "Misfire silinder 6. Cek busi, koil pengapian, dan injector silinder 6."
  },

  // ── CRANKSHAFT / CAMSHAFT SENSOR ─────────────────────────────────────────
  P0335: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Sensor posisi crankshaft tidak terbaca. Mesin bisa mati mendadak saat jalan. Jangan berkendara jauh — ganti sensor segera."
  },
  P0336: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Sinyal crankshaft sensor tidak stabil (intermittent). Risiko mesin mati tiba-tiba. Cek kabel sensor dan reluctor ring."
  },
  P0340: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Sensor camshaft (Bank 1) tidak terbaca. Berpengaruh ke timing injeksi dan pengapian. Segera ganti sensor."
  },
  P0341: {
    severity: "major",
    scoreDeduction: 25,
    recommendation:
      "Sinyal camshaft sensor tidak sesuai range. Cek timing chain dan kondisi sensor camshaft."
  },
  P0016: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Korelasi crankshaft-camshaft tidak sinkron (Bank 1). Kemungkinan timing chain mulai melar atau VVT solenoid bermasalah. Jangan tunda."
  },
  P0017: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Korelasi crankshaft-camshaft tidak sinkron (Bank 1 Sensor B). Cek timing chain dan VVT system."
  },

  // ── MAF / MAP / IAT ───────────────────────────────────────────────────────
  P0100: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Sirkuit MAF sensor bermasalah. Mesin berjalan di limp mode. Bersihkan atau ganti MAF sensor — jangan gunakan WD40, gunakan MAF cleaner."
  },
  P0101: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "MAF sensor out of range. Bersihkan MAF sensor, cek kebocoran intake hose antara MAF dan throttle body."
  },
  P0102: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sinyal MAF terlalu rendah. Cek kabel MAF, kebersihan sensor, dan koneksi konektor."
  },
  P0103: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sinyal MAF terlalu tinggi. Kemungkinan short di kabel atau sensor rusak."
  },
  P0105: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sirkuit MAP sensor bermasalah. Cek vacuum hose ke MAP sensor dan kondisi sensor."
  },
  P0110: {
    severity: "minor",
    scoreDeduction: 10,
    recommendation:
      "Sensor suhu udara masuk (IAT) bermasalah. Berpengaruh ke campuran AFR di suhu ekstrem. Cek konektor sensor."
  },

  // ── COOLANT TEMPERATURE ───────────────────────────────────────────────────
  P0115: {
    severity: "major",
    scoreDeduction: 22,
    recommendation:
      "Sirkuit sensor suhu coolant (ECT) bermasalah. ECU tidak bisa mengatur fuel trim dengan benar. Cek sensor ECT dan kabelnya."
  },
  P0116: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Nilai sensor ECT tidak masuk akal (out of range). Kemungkinan sensor ECT rusak atau thermostat stuck open."
  },
  P0128: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Suhu coolant tidak mencapai nilai normal — thermostat stuck open. Mesin tidak bisa warm up → konsumsi BBM boros, oli tidak terlumasi optimal. Ganti thermostat."
  },
  P0217: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "ECU mendeteksi kondisi overheat. Matikan mesin segera. Cek level coolant, kipas radiator, dan kondisi water pump."
  },

  // ── THROTTLE POSITION ─────────────────────────────────────────────────────
  P0120: {
    severity: "major",
    scoreDeduction: 22,
    recommendation:
      "Sirkuit TPS (Throttle Position Sensor) bermasalah. Akselerasi bisa tidak responsif atau surging. Cek TPS dan kabelnya."
  },
  P0121: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "TPS nilai tidak sesuai range. Kemungkinan TPS perlu dikalibrasi atau kotor. Bersihkan throttle body sekalian."
  },
  P0122: {
    severity: "major",
    scoreDeduction: 20,
    recommendation: "Sinyal TPS terlalu rendah. Cek kabel dan konektor TPS."
  },
  P0123: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Sinyal TPS terlalu tinggi. Kemungkinan short ke power supply."
  },

  // ── O2 SENSOR ────────────────────────────────────────────────────────────
  P0130: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sensor O2 upstream Bank 1 bermasalah. Fuel trim akan kacau, konsumsi BBM naik. Cek sensor O2 dan exhaust leak sebelum sensor."
  },
  P0131: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Tegangan sensor O2 Bank 1 terlalu rendah (lean). Cek kebocoran vacuum, MAF sensor, dan kondisi injector."
  },
  P0132: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Tegangan sensor O2 Bank 1 terlalu tinggi (rich). Cek tekanan bahan bakar dan injector bocor."
  },
  P0133: {
    severity: "major",
    scoreDeduction: 15,
    recommendation:
      "Respons sensor O2 Bank 1 lambat. Sensor O2 kemungkinan sudah aus. Pertimbangkan penggantian sensor O2."
  },
  P0134: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sensor O2 Bank 1 tidak aktif. ECU kehilangan feedback lambda → fuel trim open loop. Ganti sensor O2."
  },
  P0135: {
    severity: "minor",
    scoreDeduction: 12,
    recommendation:
      "Heater sensor O2 Bank 1 bermasalah. Sensor butuh lebih lama untuk warm up → emisi tinggi saat cold start."
  },
  P0150: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Sensor O2 upstream Bank 2 bermasalah. Sama seperti P0130 tapi di sisi Bank 2."
  },
  P0151: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Tegangan O2 Bank 2 terlalu rendah. Cek vacuum leak di sisi Bank 2."
  },
  P0155: {
    severity: "minor",
    scoreDeduction: 12,
    recommendation: "Heater sensor O2 Bank 2 bermasalah."
  },

  // ── FUEL TRIM ────────────────────────────────────────────────────────────
  P0170: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Fuel trim Bank 1 di luar batas. ECU kesulitan maintain stoichiometry. Cek MAF sensor, vacuum leak, dan injector."
  },
  P0171: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Campuran terlalu lean Bank 1 — ECU menambah injeksi tapi tidak cukup. Penyebab umum: vacuum leak, MAF kotor, atau fuel pressure rendah. Cek dulu vacuum hose."
  },
  P0172: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Campuran terlalu rich Bank 1 — ECU mengurangi injeksi tapi masih keenakan BBM. Cek injector bocor, sensor O2, dan tekanan BBM terlalu tinggi."
  },
  P0173: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Fuel trim Bank 2 di luar batas. Sama seperti P0170 tapi Bank 2."
  },
  P0174: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Campuran lean Bank 2. Pada M112 V6, sering disebabkan vacuum leak di intake manifold sisi kanan."
  },
  P0175: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Campuran rich Bank 2. Cek injector silinder 4–6 dan sensor O2 Bank 2."
  },

  // ── IDLE CONTROL ─────────────────────────────────────────────────────────
  P0505: {
    severity: "major",
    scoreDeduction: 22,
    recommendation:
      "Sistem idle control bermasalah. Idle mungkin tidak stabil atau terlalu tinggi/rendah. Cek dan bersihkan Idle Control Valve (ICV/IAC)."
  },
  P0506: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "RPM idle lebih rendah dari target ECU. Bersihkan throttle body dan ICV. Cek vacuum hose yang mungkin tersumbat."
  },
  P0507: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "RPM idle lebih tinggi dari target ECU. Kemungkinan vacuum leak atau ICV stuck open. Periksa semua selang vacuum."
  },

  // ── VEHICLE SPEED SENSOR ─────────────────────────────────────────────────
  P0500: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Sensor kecepatan kendaraan (VSS) tidak terbaca. Speedometer dan cruise control tidak berfungsi. Cek sensor ABS roda dan kabelnya."
  },
  P0501: {
    severity: "minor",
    scoreDeduction: 12,
    recommendation:
      "VSS nilai tidak sesuai range. Bisa juga dari sensor ABS yang kotor. Bersihkan sensor ABS dan cek kabel."
  },

  // ── EGR SYSTEM ───────────────────────────────────────────────────────────
  P0400: {
    severity: "major",
    scoreDeduction: 15,
    recommendation:
      "Aliran EGR bermasalah. Berpengaruh ke emisi NOx. Bersihkan atau ganti katup EGR."
  },
  P0401: {
    severity: "major",
    scoreDeduction: 15,
    recommendation:
      "Aliran EGR kurang dari yang diharapkan. Katup EGR kemungkinan tersumbat karbon. Bersihkan katup EGR."
  },
  P0402: {
    severity: "major",
    scoreDeduction: 15,
    recommendation:
      "Aliran EGR terlalu berlebihan. Katup EGR kemungkinan stuck open. Ganti katup EGR."
  },
  P0403: {
    severity: "major",
    scoreDeduction: 15,
    recommendation:
      "Sirkuit kontrol katup EGR bermasalah. Cek solenoid EGR dan kabelnya."
  },

  // ── CATALYST ─────────────────────────────────────────────────────────────
  P0420: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Efisiensi catalytic converter Bank 1 di bawah ambang batas. Cat con kemungkinan rusak akibat misfire sebelumnya atau sudah aus. Tidak urgent untuk safety, tapi segera diperiksa."
  },
  P0430: {
    severity: "major",
    scoreDeduction: 18,
    recommendation:
      "Efisiensi catalytic converter Bank 2 di bawah ambang batas. Sama seperti P0420 tapi Bank 2."
  },

  // ── EVAP SYSTEM ──────────────────────────────────────────────────────────
  P0440: {
    severity: "minor",
    scoreDeduction: 8,
    recommendation:
      "Sistem EVAP (penguapan bahan bakar) bocor. Bau bensin mungkin tercium. Cek tutup tangki dulu — sering ini penyebabnya."
  },
  P0441: {
    severity: "minor",
    scoreDeduction: 8,
    recommendation:
      "Purge flow EVAP tidak sesuai. Cek purge solenoid valve dan vacuum line EVAP."
  },
  P0442: {
    severity: "minor",
    scoreDeduction: 8,
    recommendation:
      "Kebocoran kecil sistem EVAP. Cek tutup tangki BBM dan selang EVAP."
  },
  P0455: {
    severity: "minor",
    scoreDeduction: 10,
    recommendation:
      "Kebocoran besar sistem EVAP. Cek tutup tangki, selang EVAP, dan charcoal canister."
  },

  // ── TRANSMISSION P07xx ────────────────────────────────────────────────────
  P0700: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "TCM (Transmission Control Module) mendeteksi fault. Transmisi mungkin masuk limp mode. Scan TCM terpisah untuk kode spesifik."
  },
  P0705: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Sensor posisi tuas transmisi (PRNDL) bermasalah. Transmisi tidak bisa membaca posisi yang dipilih. Cek sensor range transmisi."
  },
  P0710: {
    severity: "major",
    scoreDeduction: 25,
    recommendation:
      "Sensor suhu oli transmisi bermasalah. Transmisi tidak bisa proteksi diri dari overheat. Ganti sensor segera."
  },
  P0715: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "Sensor kecepatan input shaft transmisi (turbine speed) tidak terbaca. Transmisi tidak bisa shift dengan benar — inilah yang menyebabkan gejala lumpuh/tidak mau pindah gigi. Hindari jalan jauh. Segera ke bengkel transmisi spesialis."
  },
  P0716: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Sinyal input speed sensor transmisi tidak stabil. Sama seperti P0715, transmisi tidak bisa hitung slip ratio. Cek sensor dan kabelnya terlebih dahulu sebelum bongkar transmisi."
  },
  P0717: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "Input shaft speed sensor tidak ada sinyal sama sekali. Kemungkinan sensor putus atau kabel terputus. Cek kabel dan konektor sensor sebelum ganti transmisi."
  },
  P0720: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Sensor kecepatan output shaft transmisi bermasalah. Berpengaruh ke shift quality dan speedometer. Cek sensor dan kabelnya."
  },
  P0725: {
    severity: "major",
    scoreDeduction: 25,
    recommendation:
      "Input sinyal kecepatan mesin ke TCM bermasalah. TCM tidak bisa sinkronisasi dengan RPM mesin. Cek kabel komunikasi antara ECU dan TCM."
  },
  P0730: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "Rasio gigi tidak sesuai — transmisi tidak shift ke gigi yang benar. Kemungkinan solenoid shift bermasalah atau oli transmisi sudah sangat kotor. Ganti oli transmisi dulu, scan ulang."
  },
  P0740: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Sirkuit torque converter clutch bermasalah. Konsumsi BBM naik, mesin terasa 'ngeden' di kecepatan tinggi. Cek solenoid TCC dan kondisi oli transmisi."
  },
  P0741: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Torque converter clutch tidak mengunci (stuck off). Transmisi kehilangan efisiensi. Cek solenoid TCC dan oli transmisi."
  },
  P0742: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Torque converter clutch stuck on. Mesin bisa mati saat berhenti. Berbahaya untuk berkendara. Segera periksa."
  },
  P0750: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Shift solenoid A bermasalah. Transmisi tidak bisa shift normal. Ganti solenoid — sering bisa dilakukan tanpa bongkar transmisi penuh."
  },
  P0755: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Shift solenoid B bermasalah. Sama seperti P0750. Cek kondisi oli transmisi dulu — oli kotor bisa merusak solenoid."
  },
  P0760: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Shift solenoid C bermasalah. Transmisi mungkin masuk limp mode di gigi 3."
  },
  P0780: {
    severity: "critical",
    scoreDeduction: 38,
    recommendation:
      "Shift malfunction umum. Transmisi bermasalah saat perpindahan gigi. Cek level dan kondisi oli transmisi terlebih dahulu."
  },

  // ── SYSTEM VOLTAGE ────────────────────────────────────────────────────────
  P0560: {
    severity: "major",
    scoreDeduction: 25,
    recommendation:
      "Tegangan sistem tidak stabil. Cek kondisi aki, kabel massa, dan alternator."
  },
  P0562: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Tegangan sistem terlalu rendah. Aki atau alternator bermasalah serius. Cek alternator dan kondisi aki segera."
  },
  P0563: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Tegangan sistem terlalu tinggi. Kemungkinan voltage regulator di alternator rusak. Bisa merusak komponen elektronik."
  },

  // ── ECU / COMMUNICATION ────────────────────────────────────────────────────
  P0600: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "Komunikasi serial ECU bermasalah. Bisa jadi CAN bus fault atau ECU rusak. Perlu diagnosis mendalam di bengkel."
  },
  P0601: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "ROM ECU rusak. ECU perlu diganti atau di-reflash. Jangan tunda."
  },
  P0604: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation: "RAM internal ECU rusak. ECU perlu diganti."
  },
  P0606: {
    severity: "critical",
    scoreDeduction: 40,
    recommendation:
      "Processor ECU fault. ECU perlu diperiksa dan kemungkinan diganti."
  },

  // ── FUEL PUMP ────────────────────────────────────────────────────────────
  P0230: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Sirkuit fuel pump primer bermasalah. Mesin bisa mati kekurangan bahan bakar. Cek relay fuel pump dan kabelnya."
  },
  P0087: {
    severity: "critical",
    scoreDeduction: 35,
    recommendation:
      "Tekanan bahan bakar terlalu rendah. Cek fuel pump, fuel filter, dan pressure regulator. Mesin bisa brebet atau mati saat akselerasi."
  },
  P0088: {
    severity: "major",
    scoreDeduction: 25,
    recommendation:
      "Tekanan bahan bakar terlalu tinggi. Cek pressure regulator dan return line bahan bakar."
  },

  // ── KNOCK SENSOR ─────────────────────────────────────────────────────────
  P0325: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Sirkuit knock sensor Bank 1 bermasalah. ECU tidak bisa mendeteksi detonasi → tidak bisa retard timing → risiko knocking merusak mesin. Cek sensor dan kabelnya."
  },
  P0330: {
    severity: "major",
    scoreDeduction: 20,
    recommendation:
      "Sirkuit knock sensor Bank 2 bermasalah. Sama seperti P0325 tapi Bank 2."
  }
};

// ─── RANGE-BASED FALLBACK ──────────────────────────────────────────────────
// Untuk kode yang tidak ada di lookup table spesifik

function classifyByRange(code: string): DTCMeta {
  const prefix = code.slice(0, 2).toUpperCase();
  const num = parseInt(code.slice(1), 10);

  // Transmisi P07xx yang tidak ada di lookup spesifik
  if (prefix === "P0" && num >= 700 && num <= 799) {
    return {
      severity: "critical",
      scoreDeduction: 35,
      recommendation:
        "Kode transmisi terdeteksi. Hindari berkendara agresif dan perpindahan gigi paksa. Segera periksa ke bengkel transmisi spesialis."
    };
  }

  // Misfire P030x yang tidak ada (silinder 7–12)
  if (prefix === "P0" && num >= 307 && num <= 312) {
    return {
      severity: "critical",
      scoreDeduction: 28,
      recommendation: `Misfire silinder ${
        num - 300
      }. Cek busi, koil pengapian, dan injector silinder tersebut.`
    };
  }

  // Shift solenoid P075x–P077x
  if (prefix === "P0" && num >= 751 && num <= 789) {
    return {
      severity: "critical",
      scoreDeduction: 32,
      recommendation:
        "Solenoid atau sistem shift transmisi bermasalah. Cek kondisi oli transmisi dan solenoid."
    };
  }

  // Injector circuit P020x
  if (prefix === "P0" && num >= 200 && num <= 212) {
    const cylinder = num - 200;
    return {
      severity: "major",
      scoreDeduction: 22,
      recommendation: `Sirkuit injector${
        cylinder > 0 ? ` silinder ${cylinder}` : ""
      } bermasalah. Cek kabel injector dan resistansi injector.`
    };
  }

  // Ignition coil P035x
  if (prefix === "P0" && num >= 350 && num <= 362) {
    return {
      severity: "major",
      scoreDeduction: 25,
      recommendation:
        "Sirkuit koil pengapian bermasalah. Cek koil dan konektor. Koil rusak menyebabkan misfire."
    };
  }

  // Camshaft/VVT P001x, P001x
  if (prefix === "P0" && num >= 10 && num <= 25) {
    return {
      severity: "critical",
      scoreDeduction: 35,
      recommendation:
        "Masalah pada sistem timing camshaft atau VVT. Bisa berpengaruh ke performa dan timing mesin. Segera periksa."
    };
  }

  // O2 sensor P013x–P016x
  if (prefix === "P0" && num >= 130 && num <= 167) {
    return {
      severity: "major",
      scoreDeduction: 18,
      recommendation:
        "Sensor oksigen (O2) bermasalah. Berpengaruh ke campuran bahan bakar dan emisi. Cek sensor O2 dan exhaust leak."
    };
  }

  // EVAP P044x
  if (prefix === "P0" && num >= 440 && num <= 469) {
    return {
      severity: "minor",
      scoreDeduction: 8,
      recommendation:
        "Sistem EVAP (penguapan BBM) bocor atau tidak berfungsi. Cek tutup tangki BBM dan selang EVAP."
    };
  }

  // Manufacturer specific P1xxx
  if (code.startsWith("P1")) {
    return {
      severity: "major",
      scoreDeduction: 20,
      recommendation:
        "Kode spesifik pabrikan Mercedes-Benz. Memerlukan scanner XENTRY/DAS untuk detail lengkap. Bawa ke bengkel yang punya alat scan Mercedes."
    };
  }

  // Body codes B0xxx
  if (code.startsWith("B")) {
    return {
      severity: "minor",
      scoreDeduction: 10,
      recommendation:
        "Kode body/elektrikal. Berpengaruh ke fitur kenyamanan (AC, power window, dll), tidak langsung ke mesin."
    };
  }

  // Chassis codes C0xxx
  if (code.startsWith("C")) {
    return {
      severity: "major",
      scoreDeduction: 25,
      recommendation:
        "Kode chassis — berkaitan dengan ABS, ESP, atau sistem rem. Berpengaruh ke keselamatan berkendara. Segera periksa."
    };
  }

  // Network/communication U codes
  if (code.startsWith("U")) {
    return {
      severity: "major",
      scoreDeduction: 20,
      recommendation:
        "Kode komunikasi jaringan CAN bus. Bisa menyebabkan banyak kode lain ikut muncul. Cek konektor dan kabel CAN bus."
    };
  }

  // True fallback — unknown
  return {
    severity: "minor",
    scoreDeduction: 10,
    recommendation:
      "Kode tidak dikenal di database lokal. Catat kode ini dan konsultasikan ke bengkel dengan scanner lengkap."
  };
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function classifyDTC(code: string): DTCMeta {
  // Cek lookup spesifik dulu
  const specific = DTC_SPECIFIC[code.toUpperCase()];
  if (specific) return specific;

  // Fallback ke range classifier
  return classifyByRange(code.toUpperCase());
}
