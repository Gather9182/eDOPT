export function effectivePrices(market,assumptions) {
  const config = assumptions || {supplier_markup:10,variable_network_charge:15,other_variable_levies:0,electricity_tax:8.2,use_vat:false,pricing_mode:'effective'};
  if (!market.every(Number.isFinite)) throw new Error('Price series contains missing or invalid values.');
  if (config.pricing_mode !== 'effective') return [...market];
  const fees = ['supplier_markup','variable_network_charge','other_variable_levies','electricity_tax'].reduce((sum,key) => sum+Number(config[key] ?? 0),0);
  const factor = config.use_vat ? 1+Number(config.vat_rate ?? .2) : 1;
  if (!Number.isFinite(fees) || !Number.isFinite(factor) || factor < 0) throw new Error('Invalid price assumptions.');
  return market.map(price => (price+fees)*factor);
}

