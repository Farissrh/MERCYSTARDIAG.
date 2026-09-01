import { useEffect, useRef, useState } from "react";
import { useECUConnection } from "../context/ECUContext";

export function useLiveECU() {
  const { transport } = useECUConnection();

  const [rpm, setRpm] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [throttle, setThrottle] = useState(0);
  const [coolant, setCoolant] = useState(0);
  const [voltage, setVoltage] = useState(0);
  const [heartbeat, setHeartbeat] = useState(0);

  // Extended parameters dari slow PIDs — undefined = belum pernah diterima
  const [load, setLoad] = useState<number | undefined>(undefined);
  const [map, setMap] = useState<number | undefined>(undefined);
  const [fuelTrim, setFuelTrim] = useState<number | undefined>(undefined);
  const [intakeTemp, setIntakeTemp] = useState<number | undefined>(undefined);

  // Track transport reference sebelumnya untuk detect genuine transport change
  const prevTransportRef = useRef(transport);

  useEffect(() => {
    if (!transport) return;

    let mounted = true;

    // FIX: reset semua state saat transport berubah
    // Tanpa ini, nilai load/map/dll dari session WiFi sebelumnya masih keliatan
    // saat switch ke Mock atau transport lain yang tidak kirim extended params
    if (prevTransportRef.current !== transport) {
      prevTransportRef.current = transport;
      setRpm(0);
      setSpeed(0);
      setThrottle(0);
      setCoolant(0);
      setVoltage(0);
      setHeartbeat(0);
      setLoad(undefined);
      setMap(undefined);
      setFuelTrim(undefined);
      setIntakeTemp(undefined);
    }

    transport.onData(data => {
      if (!mounted) return;

      setRpm(data.rpm ?? 0);
      setSpeed(data.speed ?? 0);
      setThrottle(data.throttle ?? 0);
      setCoolant(data.coolant ?? 0);
      setVoltage(data.voltage ?? 0);
      setHeartbeat(data.heartbeat ?? Date.now());

      // Extended: hanya update kalau memang ada nilainya di tick ini
      // Kalau undefined = PID tidak di-poll tick ini, retain nilai sebelumnya
      if (data.load !== undefined) setLoad(data.load);
      if (data.map !== undefined) setMap(data.map);
      if (data.fuelTrim !== undefined) setFuelTrim(data.fuelTrim);
      if (data.intakeTemp !== undefined) setIntakeTemp(data.intakeTemp);
    });

    return () => {
      mounted = false;
    };
  }, [transport]);

  return {
    rpm,
    speed,
    throttle,
    coolant,
    voltage,
    heartbeat,
    load,
    map,
    fuelTrim,
    intakeTemp
  };
}
