import React from 'react';
import { 
  ResponsiveContainer, 
  ComposedChart,
  Bar, 
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine,
  Cell,
  Legend
} from 'recharts';

const PriceChart = ({ data, assumptions, unit = "EUR/MWh" }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm border-2 border-dashed border-border rounded-xl">
        No price data available. Fetch via aWATTar or upload CSV.
      </div>
    );
  }

  const {
    supplier_markup = 0,
    variable_network_charge = 0,
    other_variable_levies = 0,
    electricity_tax = 0,
    use_vat = false
  } = assumptions || {};

  const fixedAdditions = supplier_markup + variable_network_charge + other_variable_levies + electricity_tax;

  const chartData = data.map((price, i) => {
    const spot = typeof price === 'number' ? price : price.price;
    const effective = (spot + fixedAdditions) * (use_vat ? 1.2 : 1.0);
    return {
      time: `${i}:00`,
      spot: spot,
      effective: effective,
      margin: effective - spot
    };
  });

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface p-3 border border-border shadow-xl rounded-lg">
          <p className="font-bold text-[10px] uppercase tracking-wider text-muted mb-2">Time Slot: {label}</p>
          <div className="space-y-1.5">
            <div className="flex justify-between gap-8 text-xs">
              <span className="text-secondary">Wholesale Spot:</span>
              <span className="font-mono font-bold">€{payload[0].value.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-8 text-xs pt-1 border-t border-border/40">
              <span className="text-primary font-bold">Effective Price:</span>
              <span className="text-primary font-mono font-bold">€{payload[1].value.toFixed(2)}</span>
            </div>
            <div className="text-[9px] text-muted italic pt-1">
              {use_vat ? 'Includes 20% VAT + Markups' : 'Excludes VAT, includes Markups'}
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-light)" />
          <XAxis 
            dataKey="time" 
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            interval={3}
          />
          <YAxis 
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--primary-soft)', opacity: 0.2 }} />
          <Legend 
            verticalAlign="top" 
            align="right" 
            iconType="circle"
            wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: '15px' }}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
          
          <Bar 
            name="Spot Price"
            dataKey="spot" 
            radius={[2, 2, 0, 0]}
            barSize={12}
            fill="var(--text-muted)"
            fillOpacity={0.3}
          />

          <Area 
            name="Effective Price"
            type="monotone" 
            dataKey="effective" 
            stroke="var(--primary)" 
            strokeWidth={2}
            fill="var(--primary-soft)" 
            fillOpacity={0.3}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PriceChart;
