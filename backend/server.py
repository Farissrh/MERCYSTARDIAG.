import time
import threading
from flask import Flask, jsonify
from flask_socketio import SocketIO
from flask_cors import CORS

from mercy_scanner import MercyDiagnosticTool, DTC_DATABASE

# =====================
# CONFIG
# =====================
SERIAL_PORT           = "COM8"
AUTO_RPM_THRESHOLD    = 4000
POLL_INTERVAL         = 0.4
ECU_MIN_REQUEST_DELAY = 0.18

# =====================
# APP INIT
# =====================
app      = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

tool = MercyDiagnosticTool(SERIAL_PORT)

# =====================
# GLOBAL STATE
# =====================
latest_data = {
    "rpm":      0,
    "coolant":  0,
    "speed":    0,
    "throttle": 0,
    "voltage":  0,
    "ignition": False
}

freeze_frames   = {}
auto_log_buffer = []

# Vehicle info — diisi saat connect berhasil
vehicle_info = None


def query_vin_serial() -> dict | None:
    """
    VIN query via serial dinonaktifkan — terlalu tidak stabil untuk Bluetooth.
    Race condition antara VIN query dan ecu_loop yang sama-sama akses tool.ser
    menyebabkan koneksi drop setelah BUS INIT berhasil.
    Pakai hardcode langsung yang sudah dikonfirmasi dari nomor rangka + mesin.
    """
    print("[VIN] Pakai hardcode (Bluetooth mode)")
    return hardcoded_vehicle_info()


def parse_vin_from_hex(raw: str) -> str:
    """Parse VIN bytes dari response hex KWP2000/ISO15765"""
    if not raw:
        return ""

    raw = raw.upper().replace(" ", "").replace("\r", "").replace("\n", "")
    data_bytes = []

    # Cari semua frame "4902XX..."
    i = 0
    while i < len(raw):
        idx = raw.find("4902", i)
        if idx == -1:
            break
        after = raw[idx + 4:]  # skip "4902"
        if len(after) < 2:
            break
        payload = after[2:]    # skip sequence byte

        j = 0
        while j + 1 < len(payload):
            # Stop kalau ketemu "4902" berikutnya
            if payload[j:j+4] == "4902":
                break
            byte = int(payload[j:j+2], 16)
            # Hanya ambil karakter VIN valid: 0-9, A-Z
            if 0x30 <= byte <= 0x39 or 0x41 <= byte <= 0x5A:
                data_bytes.append(chr(byte))
            j += 2

        i = idx + 4

    vin = "".join(data_bytes)
    return vin[-17:] if len(vin) >= 17 else ""


def decode_vin(vin: str) -> dict:
    """Decode VIN menjadi info kendaraan"""
    v = vin.upper().strip()[:17]
    if len(v) != 17:
        return hardcoded_vehicle_info()

    wmi_map = {
        "WDB": "Mercedes-Benz (Germany)",
        "WDD": "Mercedes-Benz (Germany)",
        "MHL": "Mercedes-Benz (Indonesia)",
    }
    model_map = {
        "203": "W203 (C-Class 2000–2007)",
        "204": "W204 (C-Class 2007–2014)",
        "211": "W211 (E-Class 2002–2009)",
        "220": "W220 (S-Class 1998–2005)",
    }
    year_map = {
        "Y": 2000, "1": 2001, "2": 2002, "3": 2003, "4": 2004,
        "5": 2005, "6": 2006, "7": 2007, "8": 2008, "9": 2009,
    }
    # Override spesifik per VIN prefix (dikonfirmasi dari nomor mesin)
    override_map = {
        "WDB2030616": "C240 (M112 E26 V6 2.6L)",
    }

    wmi        = v[0:3]
    model_code = v[3:6]
    engine_code = v[6:8]
    year_char  = v[9]
    vin_prefix = v[0:10]

    make  = wmi_map.get(wmi, f"Unknown ({wmi})")
    model = model_map.get(model_code, f"Unknown ({model_code})")
    year  = year_map.get(year_char, 0)

    # Engine: cek override dulu
    engine = override_map.get(vin_prefix, f"Engine code: {engine_code}")

    return {
        "vin":       v,
        "make":      make,
        "model":     model,
        "engine":    engine,
        "modelYear": year,
        "plant":     "Sindelfingen, Germany" if v[10] == "A" else f"Plant: {v[10]}",
        "isValid":   True
    }


def hardcoded_vehicle_info() -> dict:
    """Fallback hardcode dari nomor rangka + mesin yang sudah dikonfirmasi"""
    return {
        "vin":       "WDB2030616A794557",
        "make":      "Mercedes-Benz (Germany)",
        "model":     "W203 (C-Class 2000–2007)",
        "engine":    "C240 (M112 E26 V6 2.6L)",
        "modelYear": 2006,
        "plant":     "Sindelfingen, Germany",
        "isValid":   False
    }

# =====================
# REST API
# =====================

@app.route("/status")
def status():
    return jsonify({
        "connected": tool.connected,
        "port":      SERIAL_PORT
    })


@app.route("/connect", methods=["POST"])
def connect_ecu():
    global vehicle_info
    if tool.connected:
        return jsonify({"connected": True})
    ok = tool.connect()
    if ok:
        # Query VIN setelah connect berhasil
        vehicle_info = query_vin_serial()
        print(f"[VIN] Vehicle info: {vehicle_info}")
    return jsonify({"connected": ok})


@app.route("/vehicle-info")
def get_vehicle_info():
    """Endpoint untuk frontend ambil info kendaraan"""
    if vehicle_info:
        return jsonify(vehicle_info)
    if tool.connected:
        # Kalau belum ada, coba query sekarang
        info = query_vin_serial()
        return jsonify(info)
    return jsonify(None)


@app.route("/disconnect", methods=["POST"])
def disconnect_ecu():
    try:
        if tool.ser:
            tool.ser.close()
        tool.connected = False
        tool.ser       = None
        return jsonify({"disconnected": True})
    except:
        return jsonify({"disconnected": False})


@app.route("/connect-wifi", methods=["POST"])
def connect_wifi():
    ok = tool.connect_wifi_auto()
    return jsonify({"connected": ok})


@app.route("/ping")
def ping():
    return jsonify({"status": "ok"})


@app.route("/scan-dtc")
def scan_dtc():
    if not tool.connected:
        return jsonify([])

    all_dtc = set()
    modes   = ["03", "07", "0A"]

    for mode in modes:
        resp = tool.send_request(mode)
        if not resp:
            continue
        resp = resp.replace("\r", " ").replace("\n", " ").strip()
        if "NO DATA" in resp:
            continue
        try:
            codes = tool.parse_dtc(resp)
            for c in codes:
                all_dtc.add(c)
        except:
            pass

    return jsonify([
        {
            "code":        code,
            "description": DTC_DATABASE.get(code, "Unknown fault code")
        }
        for code in sorted(all_dtc)
    ])


@app.route("/scan-pending-dtc")
def scan_pending_dtc():
    if not tool.connected:
        return jsonify([])

    resp = tool.send_request("07")
    if not resp:
        return jsonify([])

    resp = resp.replace("\r", " ").replace("\n", " ").strip()
    if "NO DATA" in resp:
        return jsonify([])

    codes = tool.parse_dtc(resp)

    return jsonify([
        {
            "code":        c,
            "description": DTC_DATABASE.get(c, "Unknown"),
            "severity":    "pending"
        }
        for c in codes
    ])


@app.route("/freeze-frame/<code>")
def freeze_frame(code):
    if code not in freeze_frames:
        return jsonify({"error": "No data"})
    return jsonify(freeze_frames[code])


@app.route("/clear-dtc", methods=["POST"])
def clear_dtc():
    if not tool.connected:
        return jsonify({"status": "not_connected"})

    resp = tool.send_request("04")
    time.sleep(1)

    freeze_frames.clear()
    auto_log_buffer.clear()

    return jsonify({
        "status":   "cleared",
        "response": resp
    })


# =====================
# ECU LOOP
# =====================

def ecu_loop():
    last_dtc_set    = set()
    last_request_ts = 0

    while True:
        try:
            # FIX: ecu_loop TIDAK auto-connect
            # Connect hanya dilakukan oleh endpoint /connect yang dipanggil frontend
            # Kalau tidak connected, cukup tunggu — jangan rebutan port dengan /connect
            if not tool.connected:
                time.sleep(1)
                continue

            now = time.time()
            if now - last_request_ts < ECU_MIN_REQUEST_DELAY:
                time.sleep(0.05)
            last_request_ts = time.time()

            # Emit dulu dengan data terakhir yang ada — frontend tidak perlu nunggu
            # get_live_data selesai (Bluetooth bisa lambat 5-10 detik per cycle)
            socketio.emit("live_data", latest_data)

            rpm, temp, spd, throt, volt = tool.get_live_data()

            voltage = 0.0
            try:
                voltage = float(str(volt).replace("V", "").strip())
            except:
                voltage = 0.0

            ignition_on = (rpm > 0 or temp > 30 or voltage > 11.5)

            latest_data.update({
                "rpm":      rpm,
                "coolant":  temp,
                "speed":    spd,
                "throttle": throt,
                "voltage":  voltage,
                "ignition": ignition_on
            })

            if rpm >= AUTO_RPM_THRESHOLD:
                auto_log_buffer.append({
                    "time":    time.strftime("%Y-%m-%d %H:%M:%S"),
                    "trigger": "RPM_HIGH",
                    **latest_data
                })

            # DTC check
            resp        = tool.send_request("03")
            current_dtc = set()
            if resp and "NO DATA" not in resp:
                current_dtc = set(tool.parse_dtc(resp))

            new_dtc = current_dtc - last_dtc_set

            for code in new_dtc:
                freeze_frames[code] = {
                    "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    **latest_data
                }
                auto_log_buffer.append({
                    "time":    time.strftime("%Y-%m-%d %H:%M:%S"),
                    "trigger": f"DTC_{code}",
                    **latest_data
                })

            last_dtc_set = current_dtc

            socketio.emit("live_data", latest_data)

        except Exception as e:
            print(f"[ERROR] ECU LOOP: {e}")
            tool.connected = False
            if tool.ser:
                try:
                    tool.ser.close()
                except:
                    pass
                tool.ser = None

        time.sleep(POLL_INTERVAL)


# =====================
# SOCKET EVENT
# =====================

@socketio.on("connect")
def on_socket_connect():
    socketio.emit("live_data", latest_data)


# =====================
# MAIN
# =====================

if __name__ == "__main__":
    threading.Thread(target=ecu_loop, daemon=True).start()
    socketio.run(app, host="0.0.0.0", port=5000)