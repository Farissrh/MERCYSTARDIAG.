import socket
import time
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS

ELM_HOST = "192.168.0.10"
ELM_PORT = 35000

app = Flask(__name__)
CORS(app)

class WifiELMSession:
    def __init__(self):
        self.sock = None
        self.lock = threading.Lock()
        self.connected = False

    def _raw_send(self, cmd):
        """
        Send one command and read until ELM327 prompt '>' appears.

        KEY FIX: sebelumnya pakai sock.settimeout(1) → nunggu 1 detik timeout
        setiap request selesai. Sekarang pakai terminator '>' detection:
        begitu ELM kirim '>' (artinya dia udah selesai), langsung return.
        Gak perlu nunggu timeout sama sekali.
        """
        self.sock.sendall((cmd.strip() + "\r").encode())

        response = b""
        self.sock.settimeout(2)  # max wait 2s total — tapi biasanya selesai jauh sebelum itu

        try:
            while True:
                chunk = self.sock.recv(256)
                if not chunk:
                    break
                response += chunk

                # ELM327 selalu akhiri response dengan '>' — ini tandanya done
                # Langsung break, jangan nunggu timeout
                if b">" in response:
                    break

        except socket.timeout:
            pass  # kalau beneran timeout (NO DATA dll), lanjut aja

        result = response.decode(errors="ignore")
        result = result.replace(">", "").replace("\r", " ").strip()
        return result

    def connect(self):
        # Force disconnect dulu kalau ada koneksi lama
        if self.connected or self.sock:
            print("[WIFI] Force closing old connection before reconnect...")
            self.disconnect()
            time.sleep(0.5)

        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(5)
            self.sock.connect((ELM_HOST, ELM_PORT))
            print("[WIFI] TCP Connected")

            # AT Z — flush semua state ELM lama
            self.sock.sendall(b"AT Z\r")
            time.sleep(1.2)  # tunggu ELM reset penuh (~1 detik)

            # Flush semua response AT Z yang mungkin masih di buffer
            self.sock.settimeout(0.3)
            try:
                while True:
                    data = self.sock.recv(1024)
                    if not data:
                        break
            except socket.timeout:
                pass
            self.sock.settimeout(2)

            # Basic config saja — TANPA 0100 BUS INIT
            # BUS INIT dilakukan oleh frontend (WifiELMTransport.ts) dengan retry logic
            self._raw_send("AT E0")
            self._raw_send("AT L0")
            self._raw_send("AT H0")
            self._raw_send("AT S0")
            # Timeout default — frontend akan set sesuai kebutuhan
            self._raw_send("AT ST C8")

            self.connected = True
            print("[WIFI] Init complete — ready for frontend BUS INIT")
            return True

        except Exception as e:
            print(f"[ERROR] Connect failed: {e}")
            self.disconnect()
            return False

        except Exception as e:
            print(f"[ERROR] Connect failed: {e}")
            self.connected = False
            return False

    def disconnect(self):
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
        self.sock = None
        self.connected = False
        print("[WIFI] Disconnected")

    def send(self, cmd):
        with self.lock:
            try:
                if not self.connected:
                    if not self.connect():
                        return "NOT CONNECTED"
                return self._raw_send(cmd)
            except Exception as e:
                print(f"[ERROR] Send failed: {e}")
                self.disconnect()
                return f"ERROR: {e}"

    def send_batch(self, commands: list[str]) -> list[str]:
        """
        Send multiple commands sequentially in one lock acquisition.
        KEY FIX: sebelumnya tiap PID = 1 HTTP request dari frontend
        (3 PIDs = 3 round-trips HTTP localhost).
        Sekarang semua PID dikirim dalam 1 HTTP request → 1 lock acquire
        → langsung loop send di Python → jauh lebih cepat.
        """
        results = []
        with self.lock:
            for cmd in commands:
                try:
                    if not self.connected:
                        if not self.connect():
                            results.append("NOT CONNECTED")
                            continue
                    result = self._raw_send(cmd)
                    results.append(result)
                except Exception as e:
                    print(f"[ERROR] Batch send failed on {cmd}: {e}")
                    self.disconnect()
                    results.append(f"ERROR: {e}")
        return results


elm_session = WifiELMSession()


@app.route("/wifi-send", methods=["POST"])
def wifi_send():
    """Single command endpoint"""
    data   = request.json
    cmd    = data.get("command")
    result = elm_session.send(cmd)
    return jsonify({"response": result})


@app.route("/wifi-reset", methods=["POST"])
def wifi_reset():
    """
    Force disconnect dan reconnect TCP ke ELM327.
    Dipanggil dari frontend sebelum connect() untuk pastikan koneksi fresh.
    """
    print("[WIFI] Force reset requested")
    elm_session.disconnect()
    time.sleep(0.5)
    ok = elm_session.connect()
    return jsonify({"connected": ok})


@app.route("/wifi-batch", methods=["POST"])
def wifi_batch():
    """
    Batch endpoint — kirim banyak PID dalam 1 HTTP request.
    Request: { "commands": ["010C", "010D", "0111"] }
    Response: { "responses": ["410C0CB4", "410D00", "41110B"] }
    """
    data     = request.json
    commands = data.get("commands", [])

    if not commands:
        return jsonify({"responses": []})

    results = elm_session.send_batch(commands)
    return jsonify({"responses": results})


@app.route("/wifi-status")
def wifi_status():
    return jsonify({"connected": elm_session.connected})


if __name__ == "__main__":
    print("[SYSTEM] Starting WiFi ELM Bridge (Fast Mode)")
    app.run(port=5050)