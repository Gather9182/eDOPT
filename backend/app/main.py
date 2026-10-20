from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import OptimizationInputs, OptimizationResult
from .services.optimization import run_optimization
from .services.price_service import PriceService, AWattarProvider, historical_calendar, historical_calendar_exclusions
from .utils.excel_processor import process_umlauf_excel, scan_umlauf_excel
from .services.charging_sites import validate_sites
from .services.feasibility import energy_feasibility_issues
from .services.soc_policy import policy_active
from .services.opportunity_charging import possible_availability
from fastapi import UploadFile, File, Form
from datetime import datetime, timezone
from importlib.metadata import version, PackageNotFoundError
import platform

app = FastAPI(title="eDOPT Optimization API")
from .services.optimization_progress import OptimizationJobs
optimization_jobs = OptimizationJobs()


@app.get('/api/optimize/capabilities')
def optimization_capabilities():
    return optimization_jobs.capabilities()


@app.post('/api/optimize/jobs', status_code=202)
def start_optimization_job(inputs: OptimizationInputs):
    try:
        return {'job_id':optimization_jobs.submit(inputs)}
    except RuntimeError as error:
        raise HTTPException(status_code=429,detail=str(error))


@app.get('/api/optimize/jobs/{job_id}')
def optimization_job_status(job_id: str):
    try:
        return optimization_jobs.get(job_id)
    except KeyError:
        raise HTTPException(status_code=404,detail='Optimization job is unavailable. The backend may have restarted or the report expired. No new run was started automatically.')


@app.post('/api/optimize/jobs/{job_id}/cancel')
def cancel_optimization_job(job_id: str):
    try:
        return optimization_jobs.cancel(job_id)
    except KeyError:
        raise HTTPException(status_code=404,detail='Optimization job is unavailable. Cancellation could not be confirmed.')

# Configure CORS for local development
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class HistoricalContextRequest(BaseModel):
    start_date: str
    end_date: str
    latitude: float
    longitude: float
    pv_capacity_kw: float
    resolution_min: int = 15

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check():
    return {"status": "online", "version": "1.1.0-milp"}


@app.get('/api/prices/historical-calendar')
def get_historical_calendar(start_date: str,end_date: str,resolution_min: int=15):
    try:
        dates=historical_calendar(start_date,end_date,resolution_min)
        return {'dates':dates,'timezone':'Europe/Vienna','dst_policy':'skip',
                'excluded_dates':historical_calendar_exclusions(dates)}
    except ValueError as error:
        raise HTTPException(status_code=400,detail=str(error))


@app.get('/api/prices/historical-day')
async def get_strict_historical_day(date: str,resolution_min: int=15):
    try:
        return await PriceService().get_strict_historical_day(date,resolution_min)
    except (ValueError,KeyError,TypeError) as error:
        raise HTTPException(status_code=400,detail=str(error))

@app.post("/api/optimize", response_model=OptimizationResult)
async def optimize_depot(inputs: OptimizationInputs):
    """
    Triggers the optimization engine. Uses the MILP solver via PuLP.
    """
    try:
        result = await run_optimization(inputs)
        return result
    except Exception as e:
        if hasattr(e, 'diagnostics'):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=500, content={'detail': str(e), 'diagnostics': e.diagnostics})
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/data/validate")
async def validate_inputs(inputs: OptimizationInputs, include_diagnostics: bool = False):
    """
    Validates the input data structure and internal consistency.
    """
    def response(result):
        for issue in result.get('issues', []):
            prefix = issue.get('message', '').split(':', 1)[0]
            issue.setdefault('category', 'storage' if prefix == 'BESS' else 'solar' if prefix == 'PV' else 'data')
            issue.setdefault('code', 'BESS_CONFIGURATION' if prefix == 'BESS' else 'PV_CONFIGURATION' if prefix == 'PV' else 'INPUT_VALIDATION')
        if include_diagnostics:
            packages = {}
            for package in ('fastapi', 'pydantic', 'pandas', 'pulp'):
                try:
                    packages[package] = version(package)
                except PackageNotFoundError:
                    packages[package] = None
            result['diagnostics'] = {
                'checked_at': datetime.now(timezone.utc).isoformat(),
                'api_version': '1.1.0-milp', 'python_version': platform.python_version(), 'packages': packages,
                'effective_inputs': inputs.model_dump(mode='json'),
            }
        return result

    issues = []
    sites_valid = True
    try:
        validate_sites(inputs)
    except ValueError as exc:
        sites_valid = False
        issues.append({'type': 'ERROR', 'code': 'CHARGING_SITE_CONFIGURATION', 'category': 'infrastructure', 'message': str(exc)})
    num_periods = int((inputs.planning_horizon_hours * 60) / inputs.time_step_minutes)
    
    # Check 1: Price consistency
    if len(inputs.electricity_prices) != num_periods:
        issues.append({
            "type": "ERROR",
            "code": "PRICE_PROFILE_LENGTH", "category": "data",
            "message": f"Electricity price data length ({len(inputs.electricity_prices)}) does not match expected periods ({num_periods})."
        })

    # Check 2: Constraint plausibility
    if not inputs.charging_sites and inputs.charger_capacity_kw <= 0:
        issues.append({"type": "ERROR", "code": "CHARGER_CAPACITY_INVALID", "category": "infrastructure", "message": "Total charger capacity must be greater than 0."})
    if not inputs.charging_sites and inputs.grid_limit_kw <= 0:
        issues.append({"type": "ERROR", "code": "GRID_LIMIT_INVALID", "category": "infrastructure", "message": "Grid connection limit must be greater than 0."})

    # Check 3: Bus data validation
    bus_ids = set()
    for bus in inputs.buses:
        # Check for duplicated IDs
        if bus.id in bus_ids:
            issues.append({"type": "ERROR", "code": "DUPLICATE_ROUTE_ID", "category": "data", "bus_id": bus.id, "message": f"Duplicate route ID found: {bus.id}"})
        bus_ids.add(bus.id)

        # Efficiency check
        if not (0 < bus.efficiency <= 1.0):
            issues.append({"type": "ERROR", "code": "BUS_EFFICIENCY_INVALID", "category": "vehicle", "bus_id": bus.id, "message": f"Bus {bus.id}: Efficiency must be between 0 and 1 (current: {bus.efficiency})"})

        # Power vs Capacity check
        if not inputs.charging_sites and bus.max_power_kw > inputs.charger_capacity_kw:
            issues.append({"type": "WARNING", "code": "BUS_POWER_EXCEEDS_SITE_CAPACITY", "category": "infrastructure", "bus_id": bus.id, "message": f"Bus {bus.id}: Individual charging power ({bus.max_power_kw}kW) exceeds total depot charger capacity ({inputs.charger_capacity_kw}kW)."})

        # Check availability vector length
        if len(bus.availability) != num_periods:
            issues.append({
                "type": "ERROR", 
                "code": "AVAILABILITY_PROFILE_LENGTH", "category": "data", "bus_id": bus.id,
                "message": f"Availability vector for bus {bus.id} must be {num_periods} periods long."
            })

        # Check if bus is never available
        if len(bus.availability) == len(inputs.electricity_prices) and not any(possible_availability(bus, inputs) if sites_valid else bus.availability):
            issues.append({
                "type": "WARNING",
                "code": "NO_CHARGING_AVAILABILITY",
                "category": "charging",
                "bus_id": bus.id,
                "message": f"Bus {bus.id} has NO availability for charging during the entire horizon."
            })

    # Check 4: Readiness consistency
    if inputs.use_next_day_readiness:
        total_readiness = sum(b.next_day_required_energy_kwh for b in inputs.buses)
        if total_readiness == 0 and len(inputs.buses) > 0:
            issues.append({
                "type": "WARNING",
                "code": "NEXT_DAY_REQUIREMENT_EMPTY", "category": "energy",
                "message": "Next-day readiness is enabled but the total morning energy requirement is zero. Verify the route data or disable next-day readiness if this is intended."
            })

    # Check 5: BESS Configuration (Stationary Storage)
    if inputs.bess_config and inputs.scenario in ["bess", "pv_bess"]:
        b = inputs.bess_config
        if b.capacity_kwh <= 0:
            issues.append({"type": "ERROR", "message": "BESS: Capacity must be greater than 0 if scenario is active."})
        
        # SoC Range & Logic
        if b.min_soc_kwh < 0:
            issues.append({"type": "ERROR", "message": "BESS: Min SoC cannot be negative."})
        if b.max_soc_kwh > b.capacity_kwh:
            issues.append({"type": "ERROR", "message": f"BESS: Max SoC ({b.max_soc_kwh} kWh) exceeds total capacity ({b.capacity_kwh} kWh). Ensure percentages are <= 100%."})
        if b.min_soc_kwh >= b.max_soc_kwh:
            issues.append({"type": "ERROR", "message": "BESS: Min SoC must be strictly less than Max SoC."})
        
        # Initial SoC placement
        if not (b.min_soc_kwh <= b.initial_soc_kwh <= b.max_soc_kwh):
            issues.append({"type": "ERROR", "message": f"BESS: Initial SoC ({b.initial_soc_kwh} kWh) must be between Min ({b.min_soc_kwh} kWh) and Max ({b.max_soc_kwh} kWh)."})
        
        # Power limits
        if b.max_charge_power_kw < 0 or b.max_discharge_power_kw < 0:
            issues.append({"type": "ERROR", "message": "BESS: Power limits cannot be negative."})
        if b.efficiency <= 0 or b.efficiency > 1.0:
            issues.append({"type": "ERROR", "message": "BESS: Efficiency must be between 0 and 1.0."})

    # Check 6: PV Configuration
    if inputs.pv_config and inputs.scenario in ["pv", "pv_bess"]:
        if inputs.pv_config.capacity_kw <= 0:
            issues.append({"type": "WARNING", "message": "PV: Peak power is 0 or negative, but a PV scenario is selected."})

    if (inputs.charging_sites or policy_active(inputs)) and not any(issue["type"] == "ERROR" for issue in issues):
        issues.extend(energy_feasibility_issues(inputs))

    if any(issue["type"] == "ERROR" for issue in issues):
        return response({"status": "invalid", "issues": issues})
    
    if issues:
        return response({"status": "warning", "issues": issues})

    return response({"status": "valid", "message": "All inputs are consistent and ready for optimization", "issues": []})

@app.post("/api/data/pre-scan-excel")
async def handle_excel_pre_scan(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = Form(None)
):
    """
    Scans the uploaded Excel file to extract all unique node IDs
    and automatically detect potential depot nodes.
    """
    try:
        content = await file.read()
        return scan_umlauf_excel(content, sheet_name)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Excel Pre-Scan Error: {str(e)}")

@app.post("/api/data/process-excel")
async def handle_excel_upload(
    file: UploadFile = File(...),
    round_to_30: bool = Form(False),
    settings: str = Form(None)
):
    """
    Processes an uploaded .xlsx file and returns cleaned trips, 
    charging windows, and the availability matrix.
    """
    try:
        content = await file.read()
        
        # Build processing settings
        proc_settings = {"ROUND_TO_30": round_to_30}
        if settings:
            import json
            try:
                extra_settings = json.loads(settings)
                proc_settings.update(extra_settings)
            except Exception as json_err:
                raise ValueError(f'Invalid import settings: {json_err}')

        results = process_umlauf_excel(content, settings=proc_settings)
        return results
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Excel Processing Error: {str(e)}")

@app.get("/api/prices/awattar")
async def get_awattar_prices(date: str, horizon_hours: int = 24):
    """
    Fetches hourly electricity prices from aWATTar for Austria.
    date format: YYYY-MM-DD
    """
    try:
        service = PriceService(AWattarProvider())
        prices = await service.get_raw_series(date, horizon_hours)
        return {"date": date, "prices": prices, "unit": "EUR/MWh"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"aWATTar Error: {str(e)}")

@app.post("/api/prices/process-optimization-data")
async def process_prices_for_optimization(
    date: str, 
    horizon_hours: int = 24, 
    resolution_min: int = 15
):
    """
    Returns a flattened list of prices mapped to the optimization horizon.
    """
    try:
        service = PriceService(AWattarProvider())
        prices = await service.get_prices_for_optimization(date, horizon_hours, resolution_min)
        return {"prices": prices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Price Mapping Error: {str(e)}")

@app.post("/api/data/historical-context")
async def get_historical_context(req: HistoricalContextRequest):
    """
    Fetches historical data (Prices, PV yield, Ambient Temperature) for a long-term simulation.
    """
    import datetime as dt
    try:
        # Handle YYYY-MM-DD or full ISO
        start_date_clean = req.start_date.split('T')[0]
        end_date_clean = req.end_date.split('T')[0]
        
        start_dt = dt.datetime.strptime(start_date_clean, "%Y-%m-%d")
        end_dt = dt.datetime.strptime(end_date_clean, "%Y-%m-%d")
        
        days = (end_dt - start_dt).days + 1
        horizon_hours = days * 24
        resolution_min = req.resolution_min

        # 1. Prices
        price_service = PriceService(AWattarProvider())
        prices = await price_service.get_prices_for_optimization(start_date_clean, horizon_hours, resolution_min)
        
        # 2. PV Yield
        from .services.pv_service import PVService as pv_instance
        pv_yield = await pv_instance.get_historical_profile(
            req.latitude, req.longitude, req.pv_capacity_kw, start_date_clean, end_date_clean, resolution_min
        )
        
        # 3. Temperatures
        from .services.weather_service import WeatherService as weather_instance
        temps = await weather_instance.get_historical_temperature_profile(
            req.latitude, req.longitude, start_date_clean, end_date_clean, resolution_min
        )

        return {
            "start_date": start_date_clean,
            "end_date": end_date_clean,
            "prices": prices,
            "pv_yield": pv_yield,
            "temperatures": temps,
            "horizon_hours": horizon_hours,
            "days": days
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Long-Term Context Error: {str(e)}")

@app.post("/api/export/excel")
async def export_results_excel(results: Dict[str, Any]):
    """
    Accepts optimization results and compiles them into a styled Excel file.
    """
    try:
        from .utils.excel_exporter import ExcelExporter
        from fastapi.responses import StreamingResponse
        
        excel_stream = ExcelExporter.generate_excel(results)
        
        headers = {
            'Content-Disposition': 'attachment; filename="depot_optimization_report.xlsx"'
        }
        return StreamingResponse(
            excel_stream,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Excel generation failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

