/**
 * vinDecoder.ts
 *
 * Decode VIN dari response hex OBD-II Mode 09 PID 02,
 * lalu parse informasi kendaraan dari struktur VIN.
 *
 * Referensi:
 * - ISO 3779 — VIN structure standard
 * - SAE J1979 — OBD-II Mode 09 PID 02 VIN response format
 * - NHTSA VIN decoder structure
 * - Mercedes-Benz WMI & VDS codes
 */

export interface VehicleInfo {
  vin:          string;       // Full VIN string, e.g. "WDB2032341F123456"
  make:         string;       // e.g. "Mercedes-Benz"
  model:        string;       // e.g. "W203 (C-Class)"
  engine:       string;       // e.g. "C240 (M112 V6 2.6L)"
  modelYear:    number;       // e.g. 2001
  plant:        string;       // Manufacturing plant
  isValid:      boolean;      // VIN checksum valid
}

// ─── WMI TABLE (World Manufacturer Identifier — first 3 chars) ───────────────
// Mercedes-Benz WMI codes
const MERCEDES_WMI: Record<string, string> = {
  "WDB": "Mercedes-Benz (Germany)",
  "WDD": "Mercedes-Benz (Germany)",
  "WDC": "Mercedes-Benz (Germany — SUV)",
  "WDF": "Mercedes-Benz (Germany — Van)",
  "VSA": "Mercedes-Benz (Spain)",
  "VF9": "Mercedes-Benz (France)",
  "4JG": "Mercedes-Benz (USA — SUV)",
  "55S": "Mercedes-Benz (USA)",
  "MHL": "Mercedes-Benz (Indonesia — KIA/ATPM)",  // ← tambah WMI Indonesia
  "MHH": "Mercedes-Benz (Indonesia)",
};

// ─── MODEL CODE TABLE (chars 4–6 of VIN = VDS model segment) ─────────────────
// Mercedes-Benz model codes
const MB_MODEL_CODES: Record<string, string> = {
  // W203 C-Class
  "203": "W203 (C-Class 2000–2007)",
  "204": "W204 (C-Class 2007–2014)",
  "205": "W205 (C-Class 2014–2021)",

  // W211 E-Class
  "211": "W211 (E-Class 2002–2009)",
  "212": "W212 (E-Class 2009–2016)",

  // W220 S-Class
  "220": "W220 (S-Class 1998–2005)",
  "221": "W221 (S-Class 2005–2013)",

  // W163/W164 ML
  "163": "W163 (ML-Class 1997–2005)",
  "164": "W164 (ML-Class 2005–2011)",

  // W210 E-Class
  "210": "W210 (E-Class 1995–2002)",

  // W168/W169 A-Class
  "168": "W168 (A-Class 1997–2004)",
  "169": "W169 (A-Class 2004–2012)",

  // W245 B-Class
  "245": "W245 (B-Class 2005–2011)",

  // R170/R171 SLK
  "170": "R170 (SLK 1996–2004)",
  "171": "R171 (SLK 2004–2011)",

  // C215/C216 CL
  "215": "C215 (CL-Class 1999–2006)",
  "216": "C216 (CL-Class 2006–2014)",

  // R230 SL
  "230": "R230 (SL-Class 2001–2012)",
};

// ─── ENGINE CODE TABLE (char 7–8 of VIN for W203) ────────────────────────────
// Mercedes W203 engine codes berdasarkan VDS (Vehicle Descriptor Section)
// Referensi: Mercedes-Benz internal production codes
// CATATAN: Kode ini tidak 100% universal — Mercedes pakai batch codes
// yang bisa berbeda per tahun produksi dan pasar.

const W203_ENGINE_CODES: Record<string, string> = {
  // Pre-facelift (2000–2004) — M111/M112/OM646/OM612
  "23": "C240 (M112 V6 2.6L)",
  "24": "C320 (M112 V6 3.2L)",
  "25": "C200 Kompressor (M111 I4 2.0L Supercharged)",
  "26": "C180 Kompressor (M111 I4 1.8L Supercharged)",
  "27": "C230 Kompressor (M111 I4 2.3L Supercharged)",
  "28": "C200 CDI (OM646 I4 2.2L Diesel)",
  "29": "C220 CDI (OM646 I4 2.2L Diesel)",
  "30": "C270 CDI (OM612 I5 2.7L Diesel)",
  "31": "C30 CDI AMG (OM612 I5 3.0L Diesel)",
  "32": "C32 AMG (M112 V6 3.2L Supercharged)",
  "33": "C55 AMG (M113 V8 5.5L)",

  // Facelift (2004–2007) — M271/M272/OM646/OM648
  "04": "C180 Kompressor Facelift (M271 I4 1.8L Supercharged)",
  "05": "C200 Kompressor Facelift (M271 E18 I4 1.8L Supercharged)",
  "07": "C230 Facelift (M272 V6 2.5L)",
  "08": "C280 Facelift (M272 V6 3.0L)",
  "09": "C350 Facelift (M272 V6 3.5L)",
  "10": "C200 CDI Facelift (OM646 I4 2.2L Diesel)",
  "11": "C220 CDI Facelift (OM646 I4 2.2L Diesel)",
  "12": "C320 CDI Facelift (OM648 I6 3.0L Diesel)",
};

// Lookup spesifik berdasarkan VIN prefix lengkap (lebih akurat dari 2 digit engine code)
// Diisi berdasarkan konfirmasi owner / nomor mesin aktual
const W203_VIN_PREFIX_OVERRIDE: Record<string, string> = {
  "WDB2030616": "C240 (M112 E26 V6 2.6L)", // dikonfirmasi dari nomor mesin 11291231975137
};

// ─── MODEL YEAR TABLE (char 10 of VIN) ───────────────────────────────────────
const MODEL_YEAR_CODES: Record<string, number> = {
  "A": 1980, "B": 1981, "C": 1982, "D": 1983, "E": 1984,
  "F": 1985, "G": 1986, "H": 1987, "J": 1988, "K": 1989,
  "L": 1990, "M": 1991, "N": 1992, "P": 1993, "R": 1994,
  "S": 1995, "T": 1996, "V": 1997, "W": 1998, "X": 1999,
  "Y": 2000, "1": 2001, "2": 2002, "3": 2003, "4": 2004,
  "5": 2005, "6": 2006, "7": 2007, "8": 2008, "9": 2009,
  "A2": 2010, "B2": 2011, "C2": 2012, "D2": 2013, "E2": 2014,
  "F2": 2015, "G2": 2016, "H2": 2017, "J2": 2018, "K2": 2019,
  "L2": 2020, "M2": 2021, "N2": 2022, "P2": 2023, "R2": 2024,
};

// ─── PLANT CODE TABLE (char 11 of VIN for Mercedes Germany) ──────────────────
const MB_PLANT_CODES: Record<string, string> = {
  "A": "Sindelfingen, Germany",
  "B": "Bremen, Germany",
  "D": "Düsseldorf, Germany",
  "E": "Rastatt, Germany",
  "F": "Berlin, Germany (formerly AMG)",
  "G": "Graz, Austria (Magna Steyr)",
  "H": "Hambach, France",
  "J": "Kecskemét, Hungary",
  "U": "Tuscaloosa, USA",
  "X": "Beijing, China (BBAC)",
};

// ─── VIN CHECKSUM VALIDATOR ───────────────────────────────────────────────────
// SAE J1979 / NHTSA VIN check digit algorithm (char 9)
function validateVINChecksum(vin: string): boolean {
  if (vin.length !== 17) return false;

  const transliteration: Record<string, number> = {
    A:1, B:2, C:3, D:4, E:5, F:6, G:7, H:8,
    J:1, K:2, L:3, M:4, N:5,      P:7, R:9,
         S:2, T:3, U:4, V:5, W:6, X:7, Y:8, Z:9,
    "0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9
  };

  const weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const char = vin[i].toUpperCase();
    const val  = transliteration[char];
    if (val === undefined) return false;
    sum += val * weights[i];
  }

  const remainder  = sum % 11;
  const checkDigit = remainder === 10 ? "X" : String(remainder);

  return checkDigit === vin[8].toUpperCase();
}

// ─── RAW HEX → VIN STRING ────────────────────────────────────────────────────
/**
 * Parse Mode 09 PID 02 response menjadi VIN string.
 *
 * ELM327 response format bisa multi-line seperti:
 * "014 \r49 02 01 57 44 42 \r49 02 02 32 30 33 32 \r49 02 03 33 34 31 46 \r..."
 * atau single line: "490201574442323033323334314631323334353637"
 *
 * Setiap byte setelah "49 02 XX" adalah ASCII char VIN.
 * Byte pertama per line (XX = sequence number) di-skip.
 */
export function parseVINFromHex(raw: string): string {
  if (!raw || raw.includes("NO DATA") || raw.includes("ERROR")) return "";

  const cleaned = raw
    .replace(/>/g, "")
    .replace(/\r/g, " ")
    .toUpperCase()
    .trim();

  const dataBytes: number[] = [];
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    // Cari posisi "4902" dalam token — bisa dengan atau tanpa KWP2000 header
    // Format KWP2000 (W203): "87F110490201000000572B" → header 87F110, lalu 4902, seq, data
    // Format standard:       "490201574442..."
    const idx = token.indexOf("4902");
    if (idx === -1) continue;

    const afterPrefix = token.slice(idx + 4); // skip "4902"
    if (afterPrefix.length < 2) continue;

    // Skip sequence byte (1 byte = 2 hex chars)
    const payload = afterPrefix.slice(2);

    // Parse payload bytes — hanya ambil printable ASCII (0x20–0x7E)
    // Skip null bytes (0x00) dan bytes di luar range ASCII printable
    for (let i = 0; i + 1 < payload.length; i += 2) {
      const byte = parseInt(payload.slice(i, i + 2), 16);
      if (isNaN(byte)) continue;

      // Hanya ambil printable ASCII — ini yang jadi karakter VIN
      // Skip 0x00 (null/padding) dan karakter non-VIN (seperti 0x2B checksum)
      if (byte >= 0x30 && byte <= 0x5A && byte !== 0x3A) {
        // 0x30-0x39 = '0'-'9', 0x41-0x5A = 'A'-'Z'
        // Skip ':' (0x3A) yang bukan karakter VIN valid
        dataBytes.push(byte);
      }
    }
  }

  const vin = dataBytes.map(b => String.fromCharCode(b)).join("");

  if (vin.length < 17) {
    console.warn(`[VIN] Parsed VIN terlalu pendek: "${vin}" (${vin.length} chars) dari raw: ${raw}`);
    return "";
  }

  // Ambil tepat 17 karakter — kalau lebih, ambil dari belakang karena depan mungkin ada padding
  return vin.length > 17 ? vin.slice(-17) : vin.slice(0, 17);
}

// ─── VIN → VEHICLE INFO ───────────────────────────────────────────────────────
export function decodeVIN(vin: string): VehicleInfo {
  // Bersihkan semua karakter non-alphanumeric yang mungkin masuk dari ELM327
  const v = vin
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") // hapus semua selain huruf dan angka
    .trim()
    .slice(0, 17); // pastikan max 17 char

  if (v.length !== 17) {
    return {
      vin:       v,
      make:      "Unknown",
      model:     "Unknown",
      engine:    "Unknown",
      modelYear: 0,
      plant:     "Unknown",
      isValid:   false,
    };
  }

  const wmi       = v.slice(0, 3);   // chars 1–3: World Manufacturer Identifier
  const modelCode = v.slice(3, 6);   // chars 4–6: model
  const engineCode = v.slice(6, 8);  // chars 7–8: engine/body
  const yearChar  = v[9];            // char 10:   model year
  const plantChar = v[10];           // char 11:   plant

  // Make dari WMI
  const make = MERCEDES_WMI[wmi] ?? `Unknown (WMI: ${wmi})`;

  // Model
  const model = MB_MODEL_CODES[modelCode] ?? `Unknown (code: ${modelCode})`;

  // Engine — cek prefix override dulu (lebih akurat), baru fallback ke engine code table
  let engine = "Unknown";
  if (modelCode === "203") {
    const vinPrefix = v.slice(0, 10); // WDB + model + engine = 10 chars
    const overrideEngine = W203_VIN_PREFIX_OVERRIDE[vinPrefix];
    if (overrideEngine) {
      engine = overrideEngine;
    } else {
      engine = W203_ENGINE_CODES[engineCode] ?? `Engine code: ${engineCode}`;
    }
  } else {
    engine = `Engine code: ${engineCode}`;
  }

  // Model year
  const modelYear = MODEL_YEAR_CODES[yearChar] ?? 0;

  // Plant
  const plant = MB_PLANT_CODES[plantChar] ?? `Unknown plant (${plantChar})`;

  // Checksum
  const isValid = validateVINChecksum(v);

  return { vin: v, make, model, engine, modelYear, plant, isValid };
}
