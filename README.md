<div align="center">

# eDOPT — Electric Depot Optimization & Planning Tool

**Stop overpaying for depot charging. Start optimizing smarter.**

eDOPT is a web-based decision-support system designed to minimize electricity procurement costs in electric bus depots. By combining Mixed-Integer Linear Programming (MILP) with dynamic spot market price integration, grid capacity limits, and battery health constraints, eDOPT transforms depot charging from a cost center into a managed asset.

[![License](https://img.shields.io/badge/License-Non--Commercial-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg)](https://vitejs.dev/)

[Key Features](#-key-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Scenario Management](#-scenario-management) • [License](#-license)

</div>

---

## 💡 The Problem & Solution

Electric bus fleets face high operational electricity costs due to volatile spot market prices and expensive peak demand charges (*Netznutzungsgebühren*). Uncoordinated charging leads to simultaneous high-power draws, triggering severe financial penalties from grid operators.

**eDOPT solves this problem** by dynamically shifting charging windows into low-cost price periods while enforcing strict grid limits and charger availability constraints—all while guaranteeing that every vehicle meets its target State of Charge (SoC) prior to scheduled departure.

```
       Unoptimized Charging                  eDOPT Smart Optimization
  ⚡ High Peak Demand Costs             📉 Peak Shaving & Grid Protection
  📈 Uncoordinated High Spot Prices     💲 Automated Load Shifting to Cheap Hours
  ⚠️ Potential Grid Overloads           ✅ Guaranteed Bus Departure Readiness
```

---

## ✨ Key Features

| Feature | Description |
| :--- | :--- |
| **MILP Optimization Engine** | Mathematical Mixed-Integer Linear Programming solver powered by PuLP / CBC to find mathematically optimal charging paths. |
| **Dynamic Spot Price Integration** | Real-time market tariff ingestion (e.g., aWATTar API, day-ahead spot market) and custom price markup modeling. |
| **Peak Demand Shaving** | Enforces maximum grid connection capacity (*Grid Limit kW*) to eliminate costly demand spikes. |
| **Vehicle SoC & Availability** | Respects bus arrival/departure schedules (*Umlaufpläne*), battery capacities, and maximum charging power per vehicle. |
| **Scenario Extensions (PV & BESS)** | Evaluate future depot upgrades, including Photovoltaic (PV) solar generation and Battery Energy Storage Systems (BESS). |
| **Interactive Visual Analytics** | High-precision interactive charts (powered by Recharts) for hourly load profiles, state-of-charge curves, and price breakdowns. |
| **Scenario Management** | Save, load, compare, and export baseline vs. optimized fleet scenarios. |
| **Excel & Data Exporter** | Export full optimized schedule tables, load curves, and cost summaries to Excel / CSV. |

---

## 🏗️ Architecture

eDOPT is built using a modern, lightweight decoupled architecture:

```
┌───────────────────────────────────────────────────────────────────┐
│                    React + Vite Web Dashboard                     │
│    (Interactive Input Forms, Scenario Comparison, Recharts UI)    │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ REST API (JSON)
┌─────────────────────────────────▼─────────────────────────────────┐
│                      FastAPI Backend Engine                       │
│    (Endpoint Routing, Price Ingestion, Data Preprocessing)        │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ Matrix & Constraints
┌─────────────────────────────────▼─────────────────────────────────┐
│                     MILP Solver Core (PuLP)                       │
│     (Cost Minimization Function under Physical & Grid Limits)      │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
* **Node.js** (v18.0 or higher) & **npm**
* **Python** (v3.10 or higher)

### 1. Installation

Clone the repository and run the automated installer:

```bash
# Clone the repository
git clone https://github.com/Gather9182/eDOPT.git
cd eDOPT

# Install dependencies (creates backend .venv & installs frontend node_modules)
install_dependencies.cmd
```

> Alternatively, install manually:
> ```bash
> # Frontend
> cd frontend && npm install && cd ..
> 
> # Backend
> cd backend
> python -m venv .venv
> .venv\Scripts\activate
> pip install -r requirements.txt
> ```

### 2. Running the Application

Launch both Frontend and Backend servers with a single script:

```bash
start_all.cmd
```

This will launch:
* **Frontend Web Dashboard:** [http://localhost:5173](http://localhost:5173)
* **FastAPI Backend Server:** [http://localhost:8000](http://localhost:8000)
* **Interactive API Docs (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 📁 Repository Structure

```
eDOPT/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point & API endpoints
│   │   ├── models.py                # Pydantic data schemas & request models
│   │   ├── services/
│   │   │   ├── solver.py            # MILP mathematical optimization formulation
│   │   │   ├── price_service.py     # Spot price fetching & preprocessing
│   │   │   └── pv_service.py        # Solar PV generation estimation
│   │   └── utils/
│   │       ├── excel_processor.py   # Timetable & CSV/Excel parser
│   │       └── excel_exporter.py    # Report generator
│   └── requirements.txt             # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── pages/                   # Main views (Dashboard, Inputs, Results, Compare)
│   │   ├── components/              # UI elements, modals, and charts
│   │   ├── services/                # API client endpoints
│   │   └── App.jsx                  # Application state & routing
│   ├── package.json                 # Frontend dependencies & scripts
│   └── vite.config.js               # Vite build configuration
├── install_dependencies.cmd         # Automated setup & venv initializer
├── start_all.cmd                    # One-click dual server launcher
├── start_backend.cmd                # Backend launcher script
├── start_frontend.cmd               # Frontend launcher script
├── .gitignore                       # Lightweight git tracking config
├── LICENSE                          # Non-Commercial license terms
└── README.md                        # Documentation
```

---

## 📊 Workflow & Usage

1. **Upload Timetable Data (`Inputs`):** Upload your bus schedule (*Umlaufplan*) CSV/Excel file or use the built-in synthetic benchmark dataset.
2. **Configure Constraints:** Set physical parameters such as maximum charger power ($kW$), depot grid limit ($kW$), and battery capacities.
3. **Select Pricing Model:** Choose between dynamic spot market tariffs (e.g. aWATTar) or fixed rate pricing.
4. **Run Solver (`Optimization`):** Trigger the MILP solver and inspect convergence logs.
5. **Analyze Results (`Results` & `Compare`):** View load profiles, cost breakdowns, peak reduction statistics, and export scenario data.

---

## 🛡️ License

This project is licensed under the **Non-Commercial & Educational License**. See the [LICENSE](LICENSE) file for complete details.

* **Permitted:** Free for personal, academic, research, and educational evaluation.
* **Restricted:** Commercial distribution, reselling, or incorporation into paid services is strictly prohibited without prior written consent from the author.

---

<div align="center">
  <sub>Developed in cooperation with ÖBB Innovation Lab</sub>
</div>
