import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts"

export function ECUChart({ data }: { data: any[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="t" hide />
          <YAxis />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="rpm"
            stroke="#00BFFF"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="speed"
            stroke="#00ff88"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
