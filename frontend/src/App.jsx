import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import InputData from './pages/InputData';
import OptimizationRun from './pages/OptimizationRun';
import Results from './pages/Results';
import ModelComparison from './pages/ModelComparison';
import Export from './pages/Export';

const STORAGE_KEY = 'energy_tool_project_data';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [optimizationStatus, setOptimizationStatus] = useState('idle'); // idle, running, completed
  
  // Shared state for optimization inputs
  const [projectData, setProjectData] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {
      buses: [],
      constraints: {
        charger_capacity_kw: 1200,
        grid_limit_kw: 800,
        efficiency: 0.92,
        max_power_per_bus: 150,
        max_battery_capacity_kwh: 350,
        consumption_wh_m: 1.5
      },
      pricing: [],
      meta: {
        last_upload: null,
        data_source: 'mock',
        default_energy_demand: 180,
        default_consumption_wh_m: 1.5,
        co2_emission_factor: 400.0,
        vehicle_types_config: {},
        planning_horizon: 24,
        time_resolution: 15,
        scenario_name: 'Baseline_Depot_2026',
        optimality_gap: 0.1,
        time_limit: 60,
        price_assumptions: {
          supplier_markup: 10.0,
          variable_network_charge: 15.0,
          other_variable_levies: 0.0,
          electricity_tax: 8.2,
          use_vat: false,
          pricing_mode: 'effective'
        },
        latitude: 48.1567,
        longitude: 14.0245
      }
    };
  });

  // Saved scenarios state list
  const [savedScenarios, setSavedScenarios] = useState(() => {
    const saved = localStorage.getItem('energy_tool_saved_scenarios');
    if (saved) return JSON.parse(saved);
    
    // Initialize list with default scenario template if empty
    const defaultData = {
      buses: [],
      constraints: {
        charger_capacity_kw: 1200,
        grid_limit_kw: 800,
        efficiency: 0.92,
        max_power_per_bus: 150,
        max_battery_capacity_kwh: 350,
        consumption_wh_m: 1.5
      },
      pricing: [],
      meta: {
        last_upload: null,
        data_source: 'mock',
        default_energy_demand: 180,
        default_consumption_wh_m: 1.5,
        co2_emission_factor: 400.0,
        vehicle_types_config: {},
        planning_horizon: 24,
        time_resolution: 15,
        scenario_name: 'Baseline_Depot_2026',
        optimality_gap: 0.1,
        time_limit: 60,
        price_assumptions: {
          supplier_markup: 10.0,
          variable_network_charge: 15.0,
          other_variable_levies: 0.0,
          electricity_tax: 8.2,
          use_vat: false,
          pricing_mode: 'effective'
        },
        latitude: 48.1567,
        longitude: 14.0245
      }
    };
    return [{
      name: 'Baseline_Depot_2026',
      timestamp: new Date().toISOString(),
      data: defaultData
    }];
  });

  // Persist project data to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData));
  }, [projectData]);

  // Persist saved scenarios to localStorage
  useEffect(() => {
    localStorage.setItem('energy_tool_saved_scenarios', JSON.stringify(savedScenarios));
  }, [savedScenarios]);

  // Scenario state control functions
  const handleLoadScenario = (scenarioName) => {
    const scenario = savedScenarios.find(s => s.name === scenarioName);
    if (scenario) {
      setProjectData(scenario.data);
    }
  };

  const handleSaveScenario = (name) => {
    const normalizedName = name.trim().replace(/\s+/g, '_');
    if (!normalizedName) return;

    const exists = savedScenarios.some(s => s.name === normalizedName);
    if (exists) {
      const confirmOverwrite = window.confirm(`Scenario "${normalizedName}" already exists. Overwrite?`);
      if (!confirmOverwrite) return;
    }

    const updatedData = {
      ...projectData,
      meta: {
        ...projectData.meta,
        scenario_name: normalizedName
      }
    };

    const newScenario = {
      name: normalizedName,
      timestamp: new Date().toISOString(),
      data: updatedData
    };

    setSavedScenarios(prev => {
      const filtered = prev.filter(s => s.name !== normalizedName);
      return [...filtered, newScenario];
    });

    setProjectData(updatedData);
  };

  const handleDeleteScenario = (scenarioName) => {
    if (scenarioName === 'Baseline_Depot_2026') {
      alert("Cannot delete the baseline default scenario template.");
      return;
    }
    const confirmDelete = window.confirm(`Are you sure you want to delete scenario "${scenarioName}"?`);
    if (!confirmDelete) return;

    setSavedScenarios(prev => prev.filter(s => s.name !== scenarioName));
  };

  const handleImportScenario = (scenarioObj) => {
    if (!scenarioObj || typeof scenarioObj.constraints !== 'object' || typeof scenarioObj.meta !== 'object') {
      alert("Invalid scenario format. The file must contain valid constraints and metadata.");
      return;
    }

    const name = scenarioObj.meta?.scenario_name || `Imported_${Date.now()}`;
    const newScenario = {
      name: name,
      timestamp: new Date().toISOString(),
      data: scenarioObj
    };

    setSavedScenarios(prev => {
      const filtered = prev.filter(s => s.name !== name);
      return [...filtered, newScenario];
    });

    setProjectData(scenarioObj);
    alert(`Scenario "${name}" imported successfully.`);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard 
          onStartOptimization={() => setActiveTab('run')} 
          projectData={projectData}
          setActiveTab={setActiveTab}
        />;
      case 'inputs':
        return <InputData 
          projectData={projectData} 
          setProjectData={setProjectData} 
          setActiveTab={setActiveTab}
        />;
      case 'run':
        return <OptimizationRun 
          projectData={projectData} 
          setProjectData={setProjectData}
          onComplete={(targetTab) => {
            setOptimizationStatus('completed');
            setActiveTab(typeof targetTab === 'string' ? targetTab : 'results');
          }} 
        />;
      case 'results':
        return <Results />;
      case 'compare':
        return <ModelComparison />;
      case 'export':
        return <Export projectData={projectData} />;
      default:
        return <Dashboard 
          onStartOptimization={() => setActiveTab('run')} 
          projectData={projectData}
          setActiveTab={setActiveTab}
        />;
    }
  };

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      projectData={projectData}
      setProjectData={setProjectData}
      savedScenarios={savedScenarios}
      onLoadScenario={handleLoadScenario}
      onSaveScenario={handleSaveScenario}
      onDeleteScenario={handleDeleteScenario}
      onImportScenario={handleImportScenario}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;

