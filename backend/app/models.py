from pydantic import BaseModel, Field
from typing import List, Dict, Optional

class BusUmlauf(BaseModel):
    id: str = Field(..., description="Unique identifier for the bus trip / Umlauf (I)")
    availability: List[int] = Field(..., description="Binary vector for time period availability (a_i_t)")
    max_power_kw: float = Field(..., description="Individual bus charging power limit (P_i_max)")
    efficiency: float = Field(0.92, description="Charging efficiency (eta_i)")
    max_battery_capacity_kwh: float = Field(350.0, description="Maximum energy the battery can hold (B_i_max)")

    # New fields for SoC tracking
    initial_soc_kwh: float = Field(..., description="Initial battery state of charge (kWh)")
    trip_energy_profile_kwh: List[float] = Field(..., description="Energy consumed per time period (kWh)")
    min_final_soc_kwh: float = Field(0.0, description="Minimum battery level required at the end (kWh)")
    next_day_required_energy_kwh: float = Field(0.0, description="Energy needed for first trips of the next day")
    vehicle_type: str = Field("", description="Metadata for vehicle classification")

    # Optional summary field
    energy_demand_kwh: Optional[float] = Field(None, description="Total energy demand for summary purposes")
    trips: List[Dict] = Field(default_factory=list, description="Chronological sequence of individual trip segments")

class PVConfig(BaseModel):
    capacity_kw: float = Field(0.0, description="Installed PV capacity")
    profile_kwh: Optional[List[float]] = Field(None, description="Optional custom PV generation profile")
    allow_curtailment: bool = Field(True, description="Whether to allow excess PV to be curtailed")
    
    # New fields for realistic weather calculation
    profile_mode: str = Field("bell_curve", description="Profile generation mode: bell_curve or open_meteo")
    latitude: Optional[float] = Field(None, description="Latitude for Open-Meteo locale")
    longitude: Optional[float] = Field(None, description="Longitude for Open-Meteo locale")
    reference_date: Optional[str] = Field(None, description="Date for weather extraction (YYYY-MM-DD)")

class BESSConfig(BaseModel):
    capacity_kwh: float = Field(0.0, description="BESS energy capacity")
    max_charge_power_kw: float = Field(0.0, description="Maximum charging power")
    max_discharge_power_kw: float = Field(0.0, description="Maximum discharging power")
    efficiency: float = Field(0.95, description="Round-trip efficiency (or one-way charge/discharge eff)")
    initial_soc_kwh: float = Field(0.0, description="Initial energy storage level")
    min_soc_kwh: float = Field(0.0, description="Minimum allowed energy level")
    max_soc_kwh: float = Field(0.0, description="Maximum allowed energy level")
    
    # Temperature-Based Derating Settings
    enable_temperature_capacity_derating: bool = Field(False, description="Enable ambient-temperature-based BESS capacity derating")
    thermal_time_constant_hours: float = Field(6.0, description="Thermal time constant for cell temperature estimation")
    reference_temperature_c: float = Field(25.0, description="Reference temperature (legacy/metadata, use full_capacity_temperature_c for solver logic)")
    min_capacity_factor: float = Field(0.65, description="Minimum capacity factor (at or below min_modeled_cell_temperature_c)")
    capacity_factor_at_minus_10c: float = Field(0.85, description="Capacity factor at -10C (middle breakpoint)")
    full_capacity_temperature_c: float = Field(25.0, description="Temperature at which 100% capacity is reached")
    min_modeled_cell_temperature_c: float = Field(-20.0, description="Minimum cell temperature for piecewise linear logic")
    initial_cell_temperature_c: Optional[float] = Field(None, description="Initial cell temperature (defaults to ambient if None)")
    thermal_heating_coefficient: float = Field(0.02, description="Heat gain per kWh processed (°C/kWh)")
    temperature_source: str = Field("open_meteo", description="Source for ambient temperature data")

class OptimizationInputs(BaseModel):
    scenario: str = Field("baseline", description="Scenario mode: baseline, pv, bess, pv_bess")
    planning_horizon_hours: int = Field(24, description="Total hours (T)")
    time_step_minutes: int = Field(15, description="Duration of each discrete period (delta_t)")
    buses: List[BusUmlauf]
    electricity_prices: List[float] = Field(..., description="Effective Price per MWh (incl. markups) (p_t)")
    market_prices: List[float] = Field(default_factory=list, description="Original wholesale Market Price per MWh")
    charger_capacity_kw: float = Field(..., description="Aggregate depot charger limit (C_max)")
    grid_limit_kw: float = Field(..., description="Depot grid connection limit (G_max)")
    initial_soc_fraction: float = Field(1.0, description="Default initial SoC fraction if not specified per bus")
    min_final_soc_fraction: float = Field(0.2, description="Default minimum final SoC fraction if not specified per bus")
    num_chargers: int = Field(50, description="Number of simultaneous charging sockets available (S_max)")
    use_next_day_readiness: bool = Field(False, description="Enforce final SoC enough for next day's first trips")
    
    # PV and BESS extensions
    pv_config: Optional[PVConfig] = None
    bess_config: Optional[BESSConfig] = None

class BusDiagnostic(BaseModel):
    id: str
    capacity_kwh: float
    initial_soc_kwh: float
    final_soc_kwh: float
    min_soc_reached_kwh: float
    total_trip_energy_kwh: float
    total_charged_energy_kwh: float
    is_charged: bool
    total_distance_km: float = 0.0
    vehicle_type: str = ""
    target_initial_soc_kwh: float = 0.0
    target_min_final_soc_kwh: float = 0.0
    next_day_required_energy_kwh: float = 0.0
    status_flag: str # 'healthy', 'warning', 'critical'
    diagnostic_reason: str

class OptimizationResult(BaseModel):
    scenario: str = "baseline"
    total_cost_eur: float
    total_energy_mwh: float
    peak_load_kw: float # Captured for UI
    # x_i_t: Charging power for bus i at time t
    schedules: Dict[str, List[float]] # BusID -> List [Charging Power per period]
    soc_profiles: Dict[str, List[float]] # BusID -> List [SoC per period]
    aggregated_load_profile: List[float] # Sum of all buses (KW)
    baseline_aggregated_load_profile: List[float] = [] # "Charge on Arrival" baseline
    baseline_cost_eur: float = 0.0
    
    # Extended metrics
    basic_optimized_cost_eur: Optional[float] = None
    grid_import_profile: List[float] = [] # Net import after PV/BESS
    
    # PV Metrics
    pv_yield_profile: List[float] = []
    pv_used_profile: List[float] = []
    pv_curtailed_profile: List[float] = []
    total_pv_generated_kwh: float = 0.0
    total_pv_used_kwh: float = 0.0
    total_pv_curtailed_kwh: float = 0.0
    
    # BESS Metrics
    bess_charge_profile: List[float] = []
    bess_discharge_profile: List[float] = []
    bess_soc_profile: List[float] = []
    bess_charge_from_pv_profile: List[float] = []
    bess_charge_from_grid_profile: List[float] = []
    total_bess_throughput_kwh: float = 0.0
    
    # BESS Temperature-Derating Metrics
    ambient_temperature_profile_c: List[float] = Field(default_factory=list)
    bess_cell_temperature_profile_c: List[float] = Field(default_factory=list)
    bess_capacity_factor_profile: List[float] = Field(default_factory=list)
    bess_max_usable_capacity_profile_kwh: List[float] = Field(default_factory=list)
    
    # Granular Flows (Source to Destination)
    pv_to_bus_profile: List[float] = []
    grid_to_bus_profile: List[float] = []
    bess_to_bus_profile: List[float] = []
    
    electricity_prices: List[float] # The price series used (Effective EUR/MWh)
    market_prices: List[float] = [] # Original wholesale prices (EUR/MWh)
    bus_diagnostics: List[BusDiagnostic] # Per-bus health metrics
    optimization_gap: float
    status: str
    solver_logs: List[str] = Field(default_factory=list)
