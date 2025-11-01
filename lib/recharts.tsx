"use client";

import * as React from "react";

type Margin = { top?: number; right?: number; bottom?: number; left?: number };

type ResponsiveContainerProps = {
  width: number | string;
  height: number | string;
  children: React.ReactNode;
};

type LineChartContextValue = {
  width: number;
  height: number;
};

const ChartSizeContext = React.createContext<LineChartContextValue>({ width: 0, height: 0 });

export function ResponsiveContainer({ width, height, children }: ResponsiveContainerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      setSize({ width: node.clientWidth, height: node.clientHeight });
    });

    observer.observe(node);
    setSize({ width: node.clientWidth, height: node.clientHeight });

    return () => observer.disconnect();
  }, []);

  const style: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
  };

  return (
    <div ref={containerRef} style={style}>
      <ChartSizeContext.Provider value={size}>{children}</ChartSizeContext.Provider>
    </div>
  );
}

function useChartSize(): LineChartContextValue {
  return React.useContext(ChartSizeContext);
}

type LineChartProps = {
  data: Array<Record<string, unknown>>;
  margin?: Margin;
  children: React.ReactNode;
};

type LineProps = {
  dataKey: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  type?: string;
  dot?: boolean;
  isAnimationActive?: boolean;
  animationDuration?: number;
  activeDot?: boolean | { r?: number; stroke?: string; strokeWidth?: number; fill?: string };
};

type AxisProps = {
  dataKey?: string;
  stroke?: string;
  tickLine?: boolean;
  axisLine?: boolean;
  tickFormatter?: (value: number) => string;
};

type TooltipProps = {
  contentStyle?: React.CSSProperties;
  formatter?: (value: number, name: string) => [string, string];
  labelFormatter?: (label: string, payload: TooltipPayloadItem[]) => string;
};

type CartesianGridProps = {
  strokeDasharray?: string;
  stroke?: string;
};

type ReferenceLineLabel =
  | string
  | {
      value?: string;
      position?: "left" | "right";
      fill?: string;
      fontSize?: number;
    };

type ReferenceLineProps = {
  y?: number;
  stroke?: string;
  strokeDasharray?: string;
  label?: ReferenceLineLabel;
};

type TooltipPayloadItem = {
  dataKey: string;
  payload: Record<string, unknown>;
  value: number | null;
  color?: string;
};

const COMPONENT_ID = {
  chart: "recharts-lite-chart",
  line: "recharts-lite-line",
  xAxis: "recharts-lite-x-axis",
  yAxis: "recharts-lite-y-axis",
  tooltip: "recharts-lite-tooltip",
  grid: "recharts-lite-grid",
  referenceLine: "recharts-lite-reference-line",
} as const;

type ComponentId = (typeof COMPONENT_ID)[keyof typeof COMPONENT_ID];

type ComponentWithId<P> = React.ComponentType<P> & { componentId?: ComponentId };

function assignComponentId<P>(component: React.ComponentType<P>, id: ComponentId) {
  (component as ComponentWithId<P>).componentId = id;
}

function extractComponentId(type: unknown): ComponentId | undefined {
  if (type && (typeof type === "function" || typeof type === "object")) {
    const candidate = (type as { componentId?: unknown }).componentId;
    return typeof candidate === "string" ? (candidate as ComponentId) : undefined;
  }
  return undefined;
}

function isChartElement<P>(child: React.ReactNode, id: ComponentId): child is React.ReactElement<P> {
  return React.isValidElement(child) && extractComponentId(child.type) === id;
}

function getNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function computeTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }

  if (min === max) {
    return [min];
  }

  const step = (max - min) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

export function LineChart({ data, margin, children }: LineChartProps) {
  const { width, height } = useChartSize();
  const marginResolved = {
    top: margin?.top ?? 16,
    right: margin?.right ?? 16,
    bottom: margin?.bottom ?? 32,
    left: margin?.left ?? 48,
  } satisfies Required<Margin>;

  const chartWidth = Math.max(width - marginResolved.left - marginResolved.right, 0);
  const chartHeight = Math.max(height - marginResolved.top - marginResolved.bottom, 0);

  const childArray = React.Children.toArray(children);
  const lineDefs = childArray.filter((child): child is React.ReactElement<LineProps> =>
    isChartElement<LineProps>(child, COMPONENT_ID.line),
  );
  const xAxis = childArray.find((child): child is React.ReactElement<AxisProps> =>
    isChartElement<AxisProps>(child, COMPONENT_ID.xAxis),
  );
  const yAxis = childArray.find((child): child is React.ReactElement<AxisProps> =>
    isChartElement<AxisProps>(child, COMPONENT_ID.yAxis),
  );
  const tooltip = childArray.find((child): child is React.ReactElement<TooltipProps> =>
    isChartElement<TooltipProps>(child, COMPONENT_ID.tooltip),
  );
  const grid = childArray.find((child): child is React.ReactElement<CartesianGridProps> =>
    isChartElement<CartesianGridProps>(child, COMPONENT_ID.grid),
  );
  const referenceLines = childArray.filter((child): child is React.ReactElement<ReferenceLineProps> =>
    isChartElement<ReferenceLineProps>(child, COMPONENT_ID.referenceLine),
  );

  const lineValues = lineDefs.flatMap((line) =>
    data
      .map((datum) => getNumeric((datum as Record<string, unknown>)[line.props.dataKey]))
      .filter((value): value is number => value !== null),
  );

  const referenceValues = referenceLines
    .map((line) => getNumeric(line.props.y))
    .filter((value): value is number => value !== null);

  const allValues = [...lineValues, ...referenceValues];

  const hasValues = allValues.length > 0;
  const yMin = hasValues ? Math.min(...allValues) : 0;
  const yMax = hasValues ? Math.max(...allValues) : 1;

  const ticks = hasValues ? computeTicks(yMin, yMax, 5) : [];

  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [isHovering, setIsHovering] = React.useState(false);

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (!chartWidth) return;
      const bounds = (event.currentTarget as SVGRectElement).getBoundingClientRect();
      const relativeX = event.clientX - bounds.left;
      const ratio = relativeX / bounds.width;
      const index = Math.round(ratio * (data.length - 1));
      setActiveIndex(Math.max(0, Math.min(data.length - 1, index)));
      setIsHovering(true);
    },
    [chartWidth, data.length],
  );

  const handlePointerLeave = React.useCallback(() => {
    setIsHovering(false);
  }, []);

  const yScale = (value: number) => {
    if (yMax === yMin) {
      return chartHeight / 2;
    }
    return chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;
  };

  const xScale = (index: number) => {
    if (data.length <= 1) {
      return chartWidth / 2;
    }
    return (index / (data.length - 1)) * chartWidth;
  };

  const activeDatum = activeIndex !== null ? data[activeIndex] : undefined;
  const labelKey = xAxis?.props.dataKey ?? "index";

  const tooltipContent = React.useMemo(() => {
    if (!tooltip || !activeDatum || activeIndex === null) {
      return null;
    }

    const formatter = tooltip.props.formatter;
    const labelFormatter = tooltip.props.labelFormatter;

    const payloadItems = lineDefs.map<TooltipPayloadItem>((line) => {
      const rawValue = (activeDatum as Record<string, unknown>)[line.props.dataKey];
      return {
        dataKey: line.props.dataKey,
        payload: activeDatum as Record<string, unknown>,
        value: getNumeric(rawValue),
        color: line.props.stroke ?? "#facc15",
      };
    });

    const rows = payloadItems.map((item) => {
      const numeric = item.value ?? 0;
      const [valueText, name] = formatter
        ? formatter(numeric, item.dataKey)
        : [String(numeric), item.dataKey];
      return {
        color: item.color ?? "#facc15",
        valueText,
        name,
      };
    });

    const labelRaw = (activeDatum as Record<string, unknown>)[labelKey];
    const labelString = typeof labelRaw === "string" ? labelRaw : String(labelRaw ?? "");
    const label = labelFormatter ? labelFormatter(labelString, payloadItems) : labelString;

    return { rows, label };
  }, [activeDatum, activeIndex, labelKey, lineDefs, tooltip]);

  if (width === 0 || height === 0 || chartWidth === 0 || chartHeight === 0) {
    return <div style={{ width: "100%", height: "100%" }} />;
  }

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <g transform={`translate(${marginResolved.left},${marginResolved.top})`}>
        {grid ? (
          <g>
            {ticks.map((tick, index) => {
              const y = yScale(tick);
              return (
                <line
                  key={index}
                  x1={0}
                  x2={chartWidth}
                  y1={y}
                  y2={y}
                  stroke={grid.props.stroke ?? "rgba(255,255,255,0.08)"}
                  strokeDasharray={grid.props.strokeDasharray ?? "4 4"}
                />
              );
            })}
          </g>
        ) : null}

        {yAxis ? (
          <g>
            {ticks.map((tick, index) => {
              const y = yScale(tick);
              const text = yAxis.props.tickFormatter ? yAxis.props.tickFormatter(tick) : tick.toFixed(0);
              return (
                <g key={index} transform={`translate(0,${y})`}>
                  {yAxis.props.tickLine !== false ? <line x1={-6} x2={0} y1={0} y2={0} stroke={yAxis.props.stroke ?? "rgba(255,255,255,0.45)"} /> : null}
                  <text
                    x={-10}
                    y={4}
                    fontSize={12}
                    fill={yAxis.props.stroke ?? "rgba(255,255,255,0.45)"}
                    textAnchor="end"
                    fontFamily="var(--font-source-code-pro), monospace"
                  >
                    {text}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {xAxis ? (
          <g transform={`translate(0, ${chartHeight})`}>
            {data.map((datum, index) => {
              const x = xScale(index);
              const raw = (datum as Record<string, unknown>)[xAxis.props.dataKey ?? "index"];
              const label = typeof raw === "string" ? raw : String(raw ?? "");
              const shouldRender = data.length <= 6 || index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 6) === 0;
              if (!shouldRender) return null;
              return (
                <g key={index} transform={`translate(${x},0)`}>
                  {xAxis.props.tickLine !== false ? <line y2={6} stroke={xAxis.props.stroke ?? "rgba(255,255,255,0.45)"} /> : null}
                  <text
                    y={18}
                    fontSize={11}
                    fill={xAxis.props.stroke ?? "rgba(255,255,255,0.45)"}
                    textAnchor="middle"
                    fontFamily="var(--font-source-code-pro), monospace"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {referenceLines.map((line, lineIndex) => {
          const numeric = getNumeric(line.props.y);
          if (numeric === null) {
            return null;
          }

          const y = yScale(numeric);
          const stroke = line.props.stroke ?? "rgba(255,255,255,0.35)";
          const strokeDasharray = line.props.strokeDasharray ?? "4 4";
          const label = line.props.label;

          let labelText: string | null = null;
          let labelPosition: "left" | "right" = "right";
          let labelFill = stroke;
          let labelFontSize = 11;

          if (label) {
            if (typeof label === "string") {
              labelText = label;
            } else {
              labelText = label.value ?? null;
              labelPosition = label.position ?? "right";
              if (label.fill) {
                labelFill = label.fill;
              }
              if (label.fontSize) {
                labelFontSize = label.fontSize;
              }
            }
          }

          return (
            <g key={`reference-${lineIndex}`}>
              <line x1={0} x2={chartWidth} y1={y} y2={y} stroke={stroke} strokeDasharray={strokeDasharray} />
              {labelText ? (
                <text
                  x={labelPosition === "left" ? 8 : chartWidth - 8}
                  y={y - 6}
                  textAnchor={labelPosition === "left" ? "start" : "end"}
                  fontSize={labelFontSize}
                  fill={labelFill}
                  fontFamily="var(--font-source-code-pro), monospace"
                >
                  {labelText}
                </text>
              ) : null}
            </g>
          );
        })}

        {lineDefs.map((line, lineIndex) => {
          const path = data
            .map((datum, index) => {
              const numeric = getNumeric((datum as Record<string, unknown>)[line.props.dataKey]);
              if (numeric === null) {
                return null;
              }
              const x = xScale(index);
              const y = yScale(numeric);
              return `${index === 0 ? "M" : "L"}${x},${y}`;
            })
            .filter(Boolean)
            .join(" ");

          return (
            <path
              key={lineIndex}
              d={path}
              fill="none"
              stroke={line.props.stroke ?? "#facc15"}
              strokeWidth={line.props.strokeWidth ?? 2}
              strokeDasharray={line.props.strokeDasharray}
            />
          );
        })}

        {tooltip ? (
          <g>
            <rect
              x={0}
              y={0}
              width={chartWidth}
              height={chartHeight}
              fill="transparent"
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            />
            {isHovering && activeDatum ? (
              <g>
                {lineDefs.map((line, index) => {
                  const value = getNumeric((activeDatum as Record<string, unknown>)[line.props.dataKey]);
                  if (value === null) return null;
                  const x = xScale(activeIndex ?? 0);
                  const y = yScale(value);
                  return (
                    <circle key={index} cx={x} cy={y} r={4} stroke={line.props.stroke ?? "#facc15"} strokeWidth={2} fill="#050505" />
                  );
                })}
                <line
                  x1={xScale(activeIndex ?? 0)}
                  x2={xScale(activeIndex ?? 0)}
                  y1={0}
                  y2={chartHeight}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="4 4"
                />
                {tooltipContent ? (
                  <foreignObject
                    x={Math.min(xScale(activeIndex ?? 0) + 12, chartWidth - 160)}
                    y={12}
                    width={148}
                    height={120}
                  >
                    <div
                      style={{
                        padding: "0.6rem",
                        borderRadius: "0.75rem",
                        border: tooltip.props.contentStyle?.border ?? "1px solid rgba(255,255,255,0.08)",
                        background: tooltip.props.contentStyle?.background ?? "rgba(10,10,10,0.9)",
                        color: tooltip.props.contentStyle?.color ?? "#f5f5f5",
                        fontFamily: tooltip.props.contentStyle?.fontFamily ?? "var(--font-source-code-pro), monospace",
                        fontSize: tooltip.props.contentStyle?.fontSize ?? "0.75rem",
                        boxShadow: tooltip.props.contentStyle?.boxShadow,
                      }}
                    >
                      <div style={{ opacity: 0.7, marginBottom: "0.35rem" }}>{tooltipContent.label}</div>
                      <div style={{ display: "grid", gap: "0.25rem" }}>
                        {tooltipContent.rows.map((row, index) => (
                          <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                            <span style={{ color: row.color }}>{row.name}</span>
                            <span>{row.valueText}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </foreignObject>
                ) : null}
              </g>
            ) : null}
          </g>
        ) : null}
      </g>
    </svg>
  );
}
LineChart.displayName = "LineChart";
assignComponentId(LineChart, "recharts-lite-chart");

export function Line(_props: LineProps) {
  return null;
}
Line.displayName = "Line";
assignComponentId(Line, COMPONENT_ID.line);

export function XAxis(_props: AxisProps) {
  return null;
}
XAxis.displayName = "XAxis";
assignComponentId(XAxis, COMPONENT_ID.xAxis);

export function YAxis(_props: AxisProps) {
  return null;
}
YAxis.displayName = "YAxis";
assignComponentId(YAxis, COMPONENT_ID.yAxis);

export function Tooltip(_props: TooltipProps) {
  return null;
}
Tooltip.displayName = "Tooltip";
assignComponentId(Tooltip, COMPONENT_ID.tooltip);

export function CartesianGrid(_props: CartesianGridProps) {
  return null;
}
CartesianGrid.displayName = "CartesianGrid";
assignComponentId(CartesianGrid, COMPONENT_ID.grid);

export function ReferenceLine(_props: ReferenceLineProps) {
  return null;
}
ReferenceLine.displayName = "ReferenceLine";
assignComponentId(ReferenceLine, COMPONENT_ID.referenceLine);
