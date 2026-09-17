"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TimelinePoint } from "../lib/types";

export default function GrowthTimelineChart({
  weekly,
  monthly,
}: {
  weekly: TimelinePoint[];
  monthly: TimelinePoint[];
}) {
  const [granularity, setGranularity] = useState<"weekly" | "monthly">("monthly");
  const data = granularity === "weekly" ? weekly : monthly;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
        <ToggleButton active={granularity === "weekly"} onClick={() => setGranularity("weekly")}>
          Semanal
        </ToggleButton>
        <ToggleButton active={granularity === "monthly"} onClick={() => setGranularity("monthly")}>
          Mensual
        </ToggleButton>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e88d6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#1e88d6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tc-gray-100)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
          <YAxis tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
          <Tooltip
            formatter={(value) => [`${value} documentos`, "Total acumulado"]}
            labelFormatter={(label) => `Fecha: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="#0b5fa5"
            strokeWidth={2}
            fill="url(#growthFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "1px solid var(--tc-blue-500)",
        background: active ? "var(--tc-blue-600)" : "var(--tc-white)",
        color: active ? "var(--tc-white)" : "var(--tc-blue-700)",
        borderRadius: 6,
        padding: "5px 14px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
