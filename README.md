<div align="center">
  <img
    src="assets/edopt-repository-banner.png"
    alt="eDOPT Electric Depot Optimization Tool repository banner"
    width="100%"
  />
</div>

<br>

<div align="center">

# eDOPT

**Electric Depot Optimization & Planning Tool**

A web-based research prototype for analyzing electricity procurement and charging schedules in battery-electric bus depots.

[![License](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg)](https://vitejs.dev/)
[![aWATTar API](https://img.shields.io/badge/API-aWATTar%20Market-orange.svg)](https://www.awattar.at/)
[![Open-Meteo API](https://img.shields.io/badge/API-Open--Meteo%20Weather-skyblue.svg)](https://open-meteo.com/)
[![PuLP Solver](https://img.shields.io/badge/Solver-PuLP%20MILP-purple.svg)](https://coin-or.github.io/pulp/)

[Research Context](#research-context) • [Purpose and Scope](#purpose-and-scope) • [Main Functions](#main-functions) • [Architecture](#architecture) • [Quick Start](#quick-start) • [License](#license)

</div>

---

## Research Context

eDOPT was developed by **Martin Pfeiffer, BSc.** as the software artifact of the master's thesis:

> *Electricity Procurement Cost Minimization for Depot Charging of Electric Buses: An Optimization-Based Decision-Support Framework*

The thesis was conducted at the **Vienna University of Economics and Business (WU Vienna)**, within the **Institute for Data, Energy, and Sustainability (IDEaS)** at the Department of Information Systems and Operations Management.

Academic supervision was provided by **Behnam Zakeri, DSc.**, with **Dr. Amin Anjomshoaa** as co-supervisor. The project was developed in cooperation with the **ÖBB Open Innovation** and **Postbus GmbH**. The industry partners contributed to the underlying problem definition, provided operational context and case-study data, and supported the applied development of the framework.

The repository contains the implementation of the decision-support tool developed for the thesis. Confidential operational data used in the Wels case study are not included.

---

## Purpose and Scope

Electric bus depots must supply the energy required by their fleets within charging windows defined by fixed vehicle circulation plans. At the same time, charging is constrained by vehicle availability, battery limits, charger capacity, and the depot grid connection. When electricity prices vary over time, the allocation of charging demand across feasible periods can influence procurement costs.

eDOPT represents this problem as a mixed-integer linear programming model. The model determines charging schedules within the available depot windows while respecting bus-level and depot-level constraints. Optional scenario extensions include photovoltaic generation and a stationary battery energy storage system.

The tool is intended for:

- scenario analysis and research
- evaluation of charging schedules under time-varying electricity prices
- comparison of charge-on-arrival and optimized charging strategies
- analysis of PV and BESS integration under defined assumptions
- preparation of operational cost estimates for further planning or investment analysis

The tool is **not** a real-time charging controller. It does not communicate with physical chargers, modify vehicle timetables, or provide a complete investment appraisal. Results depend on the uploaded operational data and the selected technical, economic, and infrastructure assumptions.

---

## Main Functions

| Function | Description |
| :--- | :--- |
| **MILP optimization** | Uses PuLP and CBC to allocate charging power across buses and time periods under the configured constraints. |
| **Vehicle circulation processing** | Converts compatible vehicle circulation plans into bus-specific availability windows and trip-energy profiles. |
| **Electricity price inputs** | Supports time-varying Austrian electricity price data, fixed prices, and additional variable price components. |
| **Bus-level constraints** | Represents battery capacity, state of charge, charging efficiency, maximum charging power, scheduled energy consumption, and readiness requirements. |
| **Depot-level constraints** | Represents charging socket availability, aggregate charger capacity, and the depot grid connection limit. |
| **PV and BESS scenarios** | Extends the depot energy balance with photovoltaic generation, stationary storage, curtailment, and storage operation. |
| **Result visualization** | Displays charging profiles, state-of-charge trajectories, electricity prices, costs, grid imports, and scenario-specific energy flows. |
| **Scenario comparison** | Compares reference and optimized configurations using common operational input data. |
| **Data export** | Exports schedules, time series, cost summaries, and scenario results to Excel or CSV where supported. |

---

## Architecture

The application follows a modular client-server architecture:

```text
┌───────────────────────────────────────────────────────────────────┐
│                    React + Vite Web Interface                     │
│        Input configuration, scenario setup, charts, tables        │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ REST API (JSON)
┌─────────────────────────────────▼─────────────────────────────────┐
│                         FastAPI Backend                           │
│       Request handling, preprocessing, external data services     │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ Model data and constraints
┌─────────────────────────────────▼─────────────────────────────────┐
│                       MILP Model with PuLP                        │
│            Charging, grid, PV, BESS, and SoC constraints          │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ CBC solver
┌─────────────────────────────────▼─────────────────────────────────┐
│                    Structured Results and Exports                 │
│       Costs, charging schedules, SoC profiles, energy flows       │
└───────────────────────────────────────────────────────────────────┘
```

The frontend is responsible for user interaction and result presentation. The backend prepares uploaded data, retrieves external inputs where required, constructs the selected optimization scenario, executes the solver, and returns structured results.

---

## Quick Start

### Prerequisites

- **Node.js** 18.0 or higher and **npm**
- **Python** 3.10 or higher
- Windows for the provided `.cmd` setup and start scripts

### 1. Installation

Clone the repository and run the provided dependency installer:

```bash
git clone https://github.com/Gather9182/eDOPT.git
cd eDOPT
install_dependencies.cmd
```

The script creates the backend virtual environment and installs the frontend and backend dependencies.

Manual installation is also possible:

```bash
# Frontend
cd frontend
npm install
cd ..

# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Running the Application

Start the frontend and backend using:

```bash
start_all.cmd
```

The default local services are:

- **Frontend:** [http://localhost:5173](http://localhost:5173)
- **Backend:** [http://localhost:8000](http://localhost:8000)
- **API documentation:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Repository Structure

```text
eDOPT/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point and API endpoints
│   │   ├── models.py                # Request and response data models
│   │   ├── services/
│   │   │   ├── solver.py            # MILP model and optimization logic
│   │   │   ├── price_service.py     # Electricity price retrieval and processing
│   │   │   └── pv_service.py        # PV generation estimation
│   │   └── utils/
│   │       ├── excel_processor.py   # Vehicle circulation plan processing
│   │       └── excel_exporter.py    # Result export generation
│   └── requirements.txt             # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── pages/                   # Main application views
│   │   ├── components/              # Interface components and charts
│   │   ├── services/                # Backend API client
│   │   └── App.jsx                  # Application state and routing
│   ├── package.json                 # Frontend dependencies and scripts
│   └── vite.config.js               # Vite configuration
├── assets/
│   └── edopt-repository-banner.png  # README and repository banner
├── install_dependencies.cmd         # Dependency installation script
├── start_all.cmd                    # Frontend and backend launcher
├── start_backend.cmd                # Backend launcher
├── start_frontend.cmd               # Frontend launcher
├── LICENSE                          # License terms
└── README.md                        # Repository documentation
```

---

## Workflow

1. **Upload operational data:** Provide a compatible vehicle circulation plan or use the included non-confidential example input.
2. **Configure and continue:** Configure import options, vehicle types and charging locations, then click **Continue to Settings**. The current timetable is processed and applied automatically before navigation; generating a preprocessing preview is optional.
3. **Configure the depot:** Define vehicle assumptions, charger capacity, charging sockets, grid connection limits, and state-of-charge requirements.
4. **Configure prices:** Select time-varying or fixed electricity prices and define additional variable procurement components.
5. **Select a scenario:** Run the optimized baseline, PV, BESS, or combined PV-BESS model.
6. **Execute the optimization:** Solve the configured model and review solver and feasibility information.
7. **Analyze the results:** Inspect charging schedules, state-of-charge profiles, costs, grid imports, PV utilization, and BESS operation.
8. **Compare and export:** Compare scenarios and export relevant result data.

---

## Data Availability and Reproducibility

### Importing other timetables and configuring charging locations

The import screen supports worksheet selection and operating-day labels. For a sheet named
`Mo-Do Schule`, all operating-day labels are selected by default. The import summary states
how many source rows were retained or excluded. Times such as `00:19[+1]` retain their day
offset; malformed times produce an error instead of silently removing a trip.

**Continue to Settings** processes the current Excel source with all current import, vehicle
and location settings, applies the returned bus profiles and then opens optimization settings.
There is no separate timetable-apply step. Errors keep the input screen open with an explanatory
message. The Excel source is retained locally in browser storage so that editing locations or
vehicle specifications later also regenerates the profiles, including after a page reload.
Projects imported before source-file caching may need the original Excel file uploaded once.
Vehicle specifications can be configured immediately after upload without generating a preview.
Price assumptions are stored as edited; fetching prices applies them automatically, and a newly
selected market date is synchronized on Continue if it has not yet been applied.

After **Run Check**, routes without charging availability or with individually impossible
energy requirements can be excluded using **Ignore and continue without these routes**.
The energy check gives each bus optimistic charging access without competition or switching
locks; failure already under those conditions identifies a route that cannot be served with
the current battery, charging windows, power and final reserve. It also detects final reserve
plus next-day energy exceeding battery capacity. Passing this check does not prove that the
shared fleet infrastructure and switching rules are feasible. Solver failures remain visible
on the settings page. The remaining fleet is checked again; unrelated errors still block
optimization. Exclusions apply to single runs, all scenarios and
long-term chunks, and are recorded in result metadata. Imported routes are retained and can
be restored with **Alle Umläufe wieder einschließen**. Reprocessing a timetable clears the
exclusions so corrected routes are reconsidered. At least one route must remain included.

Select the distance convention explicitly. **Previous detection** retains the original Wels
interpretation. **Metres** and **kilometres** interpret all unlabelled values in the chosen unit.
**Mixed export** interprets fractional values as kilometres and integer values below a configurable
threshold as kilometres; integers at or above the threshold are metres. With threshold 50,
`21` means 21 km, `94` means 94 m, and `86.16` means 86.16 km. Explicit `m`/`km` suffixes take
precedence in the explicit modes. Check this convention against the source export. Optional
vehicle-type overrides apply a single configured vehicle type to every trip of an Umlauf.
The optional first-type checkbox uses only the part before the first slash in each source
vehicle-type label: `NGB/RB12` becomes `NGB`. Consumption and battery specifications
are looked up using the resulting type. Explicit per-Umlauf selections take precedence
over this checkbox and retain their selected label.

### Optional charging trips during timetable breaks

An optional workbook sheet **Mapping Lademöglichkeiten** is read automatically during
upload. Its required columns are `Haltestelle`, `Ladestandort`, `Hinweg`, and `Rückweg`.
Travel times are minutes (for example `15 min`). Optional `Hinweg (km)` and `Rückweg (km)`
columns supply distances; otherwise enter them in **Ladeorte & Sperrzeiten → Zusätzliche
Lademöglichkeiten mit Hin- und Rückfahrt**. Missing distances remain missing and the affected
connections are skipped with an explanation. A zero-minute link defaults to zero kilometres.
The source workbook is not edited.

Enable optional trips and link each destination to an existing physical charging site.
Zero-minute mappings to depot A/E nodes can suggest that site automatically; shared
destinations share the same connector, power and grid limits. Stop nodes, site assignment,
outbound/return times and distances are editable. Global minimum charging time, buffer per
direction, minimum net battery-energy gain and minimum power during counted charging slots
are configurable. Minimum time and buffer can also be overridden per connection. Optional
allowed transfer windows restrict driving; an empty list permits driving throughout the day.
New workbooks start with this feature disabled.

Continue to Settings regenerates optional visits from actual gaps between fixed movements.
The solver chooses whether to visit and when to depart and return, allows at most one
destination per pause, and includes both travel legs in the battery equations only when
selected. Original route movements and their energy remain unchanged. Both driving legs and
the configured minimum charging duration must fit in the pause. Durations are rounded up and
pause boundaries inward to the chosen time grid. Minimum charging time counts only slots at
or above the configured minimum power; the configured net gain is after travel consumption
and charging losses. A bus must already have enough energy to reach the charger.

While travelling it cannot charge or occupy its original connector. Site switching locks and
arrival permissions also apply to optional visits; optional departures cannot bypass a lock.
Results and Excel/JSON exports show chosen departures, charger arrival, return, extra distance
and travel energy. Single-run audit inputs include realized transfer energy and trips while
retaining original inputs for the charge-on-arrival comparison, which does not use optional
trips. In non-cyclic long-term chunks, optional trips must finish inside the chunk: cross-chunk
visits are omitted rather than creating unfinished travel or losing energy. Choose a longer
continuous chunk to consider a break spanning midnight. Cyclic single-day runs support
overnight visits across the repeating-day boundary.

Under **Ladeorte & Sperrzeiten**, enable separate charging locations. Import the suggested A/E
node pairs or add locations manually, then assign all timetable nodes representing each physical
site. These are candidate sites, not evidence of installed charging infrastructure.
Use **Ausgewählte A/E-Knoten übernehmen** to transfer only the A/E nodes selected in the
Umlaufplan pill selector. Existing locations retain their capacities and switching windows;
missing nodes are added to the matching location without creating duplicate assignments.
Enter the actual
number of connectors, power per connector, aggregate charging power and grid limit at each site.
The existing fleet-wide grid and aggregate charging limits remain additional constraints; the legacy
fleet-wide connector count is replaced by site connector counts. Continue automatically regenerates
the timetable after changes to node mappings. Intermediate stops can also be used without A/E trip markers.

Charging is allowed only in full time slots contained in a stay, with no driving overlap. Physical
presence includes partial boundary slots so that a socket cannot be reassigned before departure.
Every positive-duration movement, including type B, blocks charging. Arrivals after midnight are
included in repeated operating-day profiles. This is a repeated timetable, not a calendar-aware
selection of different Monday/Tuesday timetables or public holidays.

Each location supports multiple daily **no-switch windows**, including windows crossing midnight.
Equal start/end times block switching all day. During a window, a parked connected bus keeps its
connector even at zero charging power. Power can still be modulated automatically. Timetable
departures are always permitted. An optional setting allows a newly arriving bus to connect once to
a free connector; it cannot displace another parked vehicle. Lock boundaries within a time slot
are treated conservatively by blocking switching for that slot. Connector identity within a site is
interchangeable: connectors at one site share the same configured power rating.

For repeated complete-day horizons, overnight connections remain consistent across the horizon
boundary. Long-term simulation carries connection states, as well as SoC, into the next chunk.
PV and the stationary BESS must be assigned to one location and cannot supply other sites.
An infeasible location-constrained MILP is reported as a failure; the legacy heuristic is not used
because it cannot represent physical connections. The charge-on-arrival comparison uses the same
site/connection rules and reports unmet operating requirements instead of presenting them as a
valid cost comparison. Results and Excel exports include site power, grid import and occupied
connectors, bus connection schedules, and site settings.

Backend regression tests: `cd backend` followed by `.venv\Scripts\python.exe -m unittest discover -s tests`.
Frontend profile, import, fleet exclusion and optional trip tests: `cd frontend` followed by `node --test tests/charging.test.mjs tests/timetableImport.test.mjs tests/optimizationFleet.test.mjs tests/opportunity.test.mjs`.

## Source Data

The original vehicle circulation plan used for the Wels case study is not included because it contains depot-specific operational information provided by the industry partners. The exact empirical case study therefore cannot be reproduced from this repository alone.

A non-confidential example input is provided to demonstrate the input structure and application workflow. The tool can also be applied to other compatible vehicle circulation plans. Depending on the data source, depot identifiers, operating-day filters, vehicle assumptions, and scenario parameters may need to be adjusted.

Electricity price and weather-related inputs can be retrieved from external services integrated into the application. Availability, formats, and values returned by these services may change over time.

---

## Methodological Notes

The optimization results should be interpreted as scenario-based outputs under the selected assumptions. In particular:

- the vehicle circulation plan is treated as fixed
- charging is optimized only within the derived availability windows
- the model uses deterministic input data for each optimization run
- results depend on the selected planning horizon and end-of-horizon requirements
- PV and BESS scenarios represent operational energy flows, not complete investment cases
- capital expenditure, financing, maintenance, degradation, and replacement costs are outside the model scope
- PV export and BESS electricity sales are not represented in the current formulation

The implementation includes fallback and diagnostic functions for testing and scenario exploration. The thesis results are based on successful runs of the exact MILP formulation.

---

## License

The repository is provided for non-commercial academic, research, educational, and evaluation purposes under the terms stated in the [LICENSE](LICENSE) file.

Commercial use, redistribution as part of a paid service, or incorporation into commercial software requires prior written permission from the author.

---

## Acknowledgements

This project was developed as part of a master's thesis at WU Vienna under the supervision of **Behnam Zakeri, DSc.**, with **Dr. Amin Anjomshoaa** as co-supervisor.

The practical problem setting and case-study context were developed in cooperation with the **ÖBB Open Innovation** and **Postbus GmbH**. Particular thanks are due to **Jan Hilmar, PhD**, and **Felix Grossar, MA**, for their guidance, operational insights, and support with the case-study data.

<div align="center">
  <sub>Master's thesis project by Martin Pfeiffer, BSc. | WU Vienna | In cooperation with ÖBB Open Innovation and Postbus GmbH</sub>
</div>
