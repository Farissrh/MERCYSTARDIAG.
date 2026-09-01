import serial
import time
import sys
import socket

# --- DATABASE KODE ERROR (DTC) SEDERHANA ---
DTC_DATABASE = {
    "P0100": "Mass or Volume Air Flow Circuit Malfunction",
    "P0101": "Mass or Volume Air Flow Circuit Range/Performance",
    "P0110": "Intake Air Temperature Circuit Malfunction",
    "P0115": "Engine Coolant Temperature Circuit Malfunction",
    "P0120": "Throttle/Pedal Position Sensor/Switch A Circuit Malfunction",
    "P0130": "O2 Sensor Circuit Malfunction (Bank 1 Sensor 1)",
    "P0170": "Fuel Trim Malfunction (Bank 1)",
    "P0300": "Random/Multiple Cylinder Misfire Detected",
    "P0301": "Cylinder 1 Misfire Detected",
    "P0302": "Cylinder 2 Misfire Detected",
    "P0303": "Cylinder 3 Misfire Detected",
    "P0304": "Cylinder 4 Misfire Detected",
    "P0305": "Cylinder 5 Misfire Detected",
    "P0306": "Cylinder 6 Misfire Detected",
    "P0335": "Crankshaft Position Sensor A Circuit Malfunction",
    "P0420": "Catalyst System Efficiency Below Threshold (Bank 1)",
    "P0500": "Vehicle Speed Sensor Malfunction",
    "P0600": "Serial Communication Link Malfunction",
    "P0715": "Input/Turbine Speed Sensor Circuit Malfunction",
}

# Response prefix per mode
# Mode 03 → response "43", Mode 07 → "47", Mode 0A → "4A"
MODE_RESPONSE_PREFIX = {
    "03": "43",
    "07": "47",
    "0A": "4A",
}


class MercyDiagnosticTool:
    def __init__(self, port, baudrate=38400):
        self.port        = port
        self.baudrate    = baudrate
        self.ser         = None
        self.connected   = False
        self._err_count  = 0  # consecutive error counter
        self._MAX_ERRORS = 5  # disconnect hanya setelah 5x error berturut

    def connect(self):
        print(f"[SYSTEM] Menghubungkan ke adapter di {self.port}...")
        try:
            # FIX: timeout 3 detik untuk Bluetooth
            self.ser = serial.Serial(self.port, self.baudrate, timeout=3)
            time.sleep(1)
            self._send_at("AT Z")
            self._send_at("AT E0")
            self._send_at("AT L0")
            self._send_at("AT H1")
            self._send_at("AT E0")

            proto_resp = self._send_at("AT SP 5")
            print(f"[SYSTEM] Set Protocol KWP2000: {proto_resp}")

            print("[SYSTEM] Melakukan Handshake ke ECU (Bus Init)...")
            response = self.send_request("01 00")

            if "NO DATA" in response or "ERROR" in response or "UNABLE" in response:
                print("[ERROR] Gagal terhubung ke ECU. Pastikan kunci kontak ON.")
                return False

            print("[SUCCESS] Terhubung ke ECU Mercedes-Benz!")
            self.connected = True
            return True

        except Exception as e:
            print(f"[ERROR] Masalah Port Serial: {e}")
            return False

    def _send_at(self, command):
        if not self.ser:
            return ""
        self.ser.write((command + '\r').encode())
        time.sleep(0.1)
        return self.ser.read_until(b'>').decode(errors='ignore').replace('>', '').strip()

    def send_request(self, command):
        if not self.ser:
            return ""

        try:
            if isinstance(self.ser, socket.socket):
                self.ser.send((command.replace(" ", "") + '\r').encode())
                time.sleep(0.2)
                raw = self.ser.recv(4096).decode(errors="ignore")
            else:
                self.ser.write((command.replace(" ", "") + '\r').encode())
                raw = self.ser.read_until(b'>').decode(errors='ignore')

            clean = raw.replace('>', '').replace('\r', '').replace('\n', '').strip()
            clean = clean.replace("SEARCHING...", "")
            clean = clean.replace("BUS INIT...", "")
            clean = clean.replace("BUS INIT: OK", "")
            clean = clean.replace(" ", "")

            self._err_count = 0  # reset counter kalau berhasil
            return clean

        except:
            self._err_count += 1
            if self._err_count >= self._MAX_ERRORS:
                print(f"[WARN] {self._err_count} consecutive errors — marking disconnected")
                self.connected  = False
                self._err_count = 0
            return ""

    # ─── DTC PARSER ───────────────────────────────────────────────────────────

    def parse_dtc(self, raw_hex: str, mode: str = "03") -> list:
        """
        Parse response hex OBD-II menjadi list kode DTC.

        Support:
        - Mode 03 (stored DTC)   → response prefix "43"
        - Mode 07 (pending DTC)  → response prefix "47"
        - Mode 0A (permanent DTC) → response prefix "4A"
        - Multi-frame response (banyak DTC)
        - Semua prefix: P, C, B, U
        - Membersihkan noise ELM327 sebelum parse

        Args:
            raw_hex: string hex response dari ECU (sudah dibersihkan spasi)
            mode: "03", "07", atau "0A"
        """
        codes = []

        if not raw_hex:
            return codes

        # Bersihkan semua noise ELM327
        cleaned = raw_hex.upper()
        cleaned = cleaned.replace("SEARCHING...", "")
        cleaned = cleaned.replace("BUSINIT...", "")
        cleaned = cleaned.replace("BUSINITIOK", "")
        cleaned = cleaned.replace("BUS INIT: OK", "")
        cleaned = cleaned.replace(" ", "")
        cleaned = cleaned.replace("\r", "")
        cleaned = cleaned.replace("\n", "")

        if not cleaned or "NODATA" in cleaned or "ERROR" in cleaned:
            return codes

        # Tentukan expected response prefix berdasarkan mode
        expected_prefix = MODE_RESPONSE_PREFIX.get(mode, "43")

        # FIX: cari semua kemunculan prefix response — handle multi-frame
        # Contoh multi-frame: "430000000043P0715430171"
        # Atau dari ELM dengan header: "43030000000043P0715"
        payload_bytes = []

        # Cari semua posisi expected_prefix dalam string
        search_pos = 0
        while True:
            idx = cleaned.find(expected_prefix, search_pos)
            if idx == -1:
                break

            # Ambil semua byte setelah prefix ini sampai prefix berikutnya
            # atau sampai habis
            next_idx = cleaned.find(expected_prefix, idx + 2)
            if next_idx == -1:
                chunk = cleaned[idx + 2:]
            else:
                chunk = cleaned[idx + 2: next_idx]

            payload_bytes.append(chunk)
            search_pos = idx + 2

        if not payload_bytes:
            return codes

        # Gabungkan semua payload dari semua frame
        full_payload = "".join(payload_bytes)

        # Parse per 4 karakter hex (2 byte = 1 DTC)
        i = 0
        while i + 3 < len(full_payload):
            chunk = full_payload[i:i+4]
            i += 4

            if len(chunk) < 4:
                continue

            # Skip null bytes (0000 = tidak ada DTC)
            if chunk == "0000":
                continue

            try:
                A = int(chunk[0:2], 16)
                B = int(chunk[2:4], 16)
            except ValueError:
                continue

            # Decode prefix dari 2 bit tertinggi byte A
            # 00 = P, 01 = C, 10 = B, 11 = U
            type_code = (A & 0xC0) >> 6
            prefix_map = {0: "P", 1: "C", 2: "B", 3: "U"}
            prefix = prefix_map.get(type_code, "P")

            # Decode digit 2 dan 3
            digit2 = (A & 0x30) >> 4
            digit3 = A & 0x0F

            # Digit 4-5 dari byte B (dalam hex)
            digits45 = chunk[2:4]

            dtc_code = f"{prefix}{digit2}{digit3}{digits45}"

            # Validasi format kode (harus P/C/B/U + 4 digit hex)
            if len(dtc_code) == 6 and dtc_code[1:].isalnum():
                codes.append(dtc_code)

        # Hilangkan duplikat sambil pertahankan urutan
        seen = set()
        unique_codes = []
        for code in codes:
            if code not in seen:
                seen.add(code)
                unique_codes.append(code)

        return unique_codes

    def scan_all_dtc(self) -> dict:
        """
        Scan semua mode DTC sekaligus:
        - Mode 03: Stored DTC
        - Mode 07: Pending DTC
        - Mode 0A: Permanent DTC

        Returns dict dengan key per mode.
        """
        result = {
            "stored":    [],
            "pending":   [],
            "permanent": [],
        }

        mode_map = {
            "03": "stored",
            "07": "pending",
            "0A": "permanent",
        }

        for mode, key in mode_map.items():
            resp = self.send_request(mode)

            if not resp or "NO DATA" in resp or "ERROR" in resp:
                continue

            codes = self.parse_dtc(resp, mode)

            # Filter kode yang valid (bukan "Format Respon Tidak Dikenal")
            valid_codes = [c for c in codes if len(c) == 6 and c[0] in "PCBU"]
            result[key] = valid_codes

        return result

    def _extract_pid(self, resp: str, pid_code: str) -> str:
        """
        Extract payload dari response PID — handle format dengan/tanpa KWP2000 header.
        Contoh tanpa header: "410C0CB4"
        Contoh dengan header: "87F110410C0CB4"
        """
        if not resp:
            return ""
        clean = resp.replace(" ", "").upper()
        marker = "41" + pid_code.upper().zfill(2)
        idx = clean.find(marker)
        if idx == -1:
            return ""
        return clean[idx:]

    def _send_pid(self, pid: str, retries: int = 2) -> str:
        """Send PID dengan retry — Bluetooth kadang drop response"""
        for attempt in range(retries):
            resp = self.send_request(pid)
            payload = self._extract_pid(resp, pid[2:])
            if payload:
                return payload
            if attempt < retries - 1:
                time.sleep(0.1)
        return ""

    def get_live_data(self):
        # Gunakan last known values sebagai fallback kalau PID gagal
        # supaya display tidak tiba-tiba 0 saat ada Bluetooth hiccup
        if not hasattr(self, '_last'):
            self._last = {"rpm": 0, "temp": 0, "spd": 0, "throt": 0, "voltage": 0.0}

        # 1. RPM (PID 0C)
        payload = self._send_pid("010C")
        if payload and len(payload) >= 8:
            try:
                A = int(payload[4:6], 16)
                B = int(payload[6:8], 16)
                self._last["rpm"] = ((A * 256) + B) / 4
            except:
                pass

        # 2. Coolant Temp (PID 05)
        payload = self._send_pid("0105")
        if payload and len(payload) >= 6:
            try:
                A = int(payload[4:6], 16)
                self._last["temp"] = A - 40
            except:
                pass

        # 3. Speed (PID 0D)
        payload = self._send_pid("010D")
        if payload and len(payload) >= 6:
            try:
                self._last["spd"] = int(payload[4:6], 16)
            except:
                pass

        # 4. Throttle Position (PID 11)
        payload = self._send_pid("0111")
        if payload and len(payload) >= 6:
            try:
                A = int(payload[4:6], 16)
                self._last["throt"] = (A * 100) / 255
            except:
                pass

        # 5. Voltage
        v = self.get_battery_voltage()
        if v > 0:
            self._last["voltage"] = v

        return (
            self._last["rpm"],
            self._last["temp"],
            self._last["spd"],
            self._last["throt"],
            self._last["voltage"]
        )
        """
        Extract payload dari response PID — handle format dengan/tanpa KWP2000 header.
        Contoh tanpa header: "410C0CB4"
        Contoh dengan header: "87F110410C0CB4" atau "86F11041 0C 0C B4"
        """
        if not resp:
            return ""
        # Hapus spasi
        clean = resp.replace(" ", "").upper()
        # Cari "41XX" pattern (service 41 = response to 01, XX = PID)
        marker = "41" + pid_code.upper().replace(" ", "").replace("01", "").zfill(2)
        idx = clean.find(marker)
        if idx == -1:
            return ""
        return clean[idx:]

    def get_battery_voltage(self):
        try:
            resp = self._send_at("ATRV")
            if "V" in resp:
                return float(resp.replace("V", "").strip())
            return 0.0
        except:
            return 0.0

    def scan_for_errors(self):
        print("\n[SCANNER] Scanning semua mode DTC...")
        result = self.scan_all_dtc()

        total = sum(len(v) for v in result.values())

        if total == 0:
            print("[RESULT] Tidak ada kode error tersimpan (Clean).")
            return

        for category, codes in result.items():
            if not codes:
                continue
            print(f"\n[{category.upper()}] {len(codes)} kode:")
            print("-" * 50)
            for code in codes:
                desc = DTC_DATABASE.get(code, "Deskripsi tidak ada di database lokal")
                print(f" >> {code} : {desc}")
        print("-" * 50)

    def connect_wifi_auto(self):
        print("[SYSTEM] Mencari ELM327 WiFi...")

        candidates = [
            ("192.168.0.10", 35000),
            ("192.168.0.10", 23),
            ("192.168.1.10", 35000),
            ("192.168.1.10", 23),
        ]

        for host, port in candidates:
            try:
                print(f"[SCAN] Coba {host}:{port}")
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(2)
                sock.connect((host, port))

                sock.send(b"AT Z\r")
                time.sleep(0.5)
                resp = sock.recv(1024).decode(errors="ignore")

                if "ELM" in resp.upper():
                    print(f"[SUCCESS] WiFi ELM ditemukan di {host}:{port}")
                    self.ser      = sock
                    self.connected = True
                    return True

                sock.close()

            except:
                continue

        print("[ERROR] WiFi ELM tidak ditemukan.")
        return False


# --- PROGRAM UTAMA ---
def main():
    PORT = 'COM4'
    tool = MercyDiagnosticTool(PORT)

    if tool.connect():
        while True:
            print("\n" + "="*45)
            print(" MERCEDES-BENZ W203 DIAGNOSTIC TOOL")
            print("="*45)
            print("1. Lihat Data Live (RPM, Suhu, Speed, Tegangan Aki)")
            print("2. Scan Kerusakan (DTC) — Semua Mode")
            print("3. Keluar")

            pilihan = input("Pilih menu (1/2/3): ")

            if pilihan == '1':
                print("\n[LIVE] Tekan Ctrl+C untuk berhenti...")
                try:
                    while True:
                        rpm, temp, spd, throt, voltage = tool.get_live_data()
                        sys.stdout.write(
                            f"\r RPM: {rpm:.0f} | Suhu: {temp}°C | Speed: {spd} km/h | Gas: {throt:.1f}% | Aki: {voltage}   "
                        )
                        sys.stdout.flush()
                        time.sleep(0.5)
                except KeyboardInterrupt:
                    print("\n[INFO] Live data dihentikan.")

            elif pilihan == '2':
                tool.scan_for_errors()
                input("\nTekan Enter untuk kembali ke menu...")

            elif pilihan == '3':
                print("[INFO] Menutup koneksi. Bye!")
                if tool.ser:
                    tool.ser.close()
                break
            else:
                print("Pilihan tidak valid.")


if __name__ == "__main__":
    main()