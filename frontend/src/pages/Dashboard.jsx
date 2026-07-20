import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  ArrowRight, 
  Zap, 
  Info,
  Clock,
  TrendingUp,
  Bus
} from 'lucide-react';

const Dashboard = ({ onStartOptimization, projectData, setActiveTab }) => {
  const [showLearnMore, setShowLearnMore] = useState(false);
  const numUmlaufe = projectData.buses?.length || 0;
  const avgPrice = projectData.pricing?.length > 0 
    ? (projectData.pricing.reduce((a, b) => a + b, 0) / projectData.pricing.length).toFixed(1)
    : '---';

  const steps = [
    { title: 'Data Upload', status: projectData.buses?.length > 0 ? 'completed' : 'pending', desc: 'Umlaufplan & Price Series' },
    { title: 'Parameters', status: 'completed', desc: 'Physical Constraints' },
    { title: 'Optimization', status: 'pending', desc: 'Solve Minimize Cost' },
    { title: 'Results', status: 'pending', desc: 'Schedules & Load Profile' },
  ];

  const stats = [
    { label: 'Umläufe', value: numUmlaufe.toString(), icon: <Bus size={18} /> },
    { label: 'Time Horizon', value: `${projectData.meta.planning_horizon}h`, icon: <Clock size={18} /> },
    { label: 'Price Avg', value: avgPrice !== '---' ? `€${avgPrice}/MWh` : 'No Data', icon: <TrendingUp size={18} /> },
  ];

  return (
    <div className="dashboard-container animate-in">
      <div className="section-header">
        <h1>Welcome back, Martin</h1>
        <p>Overview of your charging project and optimization status.</p>
      </div>

      <div className="welcome-section mb-6">
        <div className="card hero-card">
          <div className="hero-content">
            <h2 className="text-2xl font-bold mb-2">Optimize Your Depot Charging</h2>
            <p className="text-secondary mb-6 max-w-lg">
              eDOPT helps you minimize electricity procurement costs by intelligently 
              scheduling bus charging windows while respecting grid limits and vehicle availability.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={onStartOptimization}>
                <Zap size={18} />
                Run Optimization
              </button>
              <button className="btn btn-outline" onClick={() => setShowLearnMore(true)}>
                <Info size={18} />
                Learn More
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <Zap size={80} className="text-primary opacity-20" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        {stats.map((stat, i) => (
          <div key={i} className="card stat-card">
            <div className="stat-icon">{stat.icon}</div>
            <div className="stat-info">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value">{stat.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card h-fit transition-all hover:shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h3 className="card-title m-0"><TrendingUp size={18} className="text-primary" /> Workflow Progress</h3>
          </div>
          <div className="workflow-steps">
            {steps.map((step, i) => (
              <div key={i} className={`workflow-step ${step.status} py-2`}>
                <div className="step-marker">
                  {step.status === 'completed' ? <CheckCircle2 size={20} className="text-success" /> : <Circle size={20} className="text-muted" />}
                </div>
                <div className="step-details flex-1">
                  <span className="step-title font-semibold text-sm">{step.title}</span>
                  <p className="step-desc text-xs text-muted">{step.desc}</p>
                </div>
                {i < steps.length - 1 && <ArrowRight size={16} className="text-muted opacity-30" />}
              </div>
            ))}
          </div>
          <div className="mt-8 pt-4 border-t border-border-light">
            <button 
              className="btn btn-primary w-full flex justify-between items-center group shadow-sm hover:shadow-md transition-all" 
              onClick={() => setActiveTab('inputs')}
            >
              <span className="font-bold">Start Project Setup</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>

        <div className="card h-fit">
          <h3 className="card-title text-primary">Project Summary</h3>
          <div className="summary-list mt-4">
            <div className="summary-item py-3 border-b border-border-light flex justify-between items-center text-sm">
              <span className="font-medium">Status</span>
              <span className="badge badge-success">Ready to Run</span>
            </div>
            <div className="summary-item py-3 border-b border-border-light flex justify-between items-center text-sm">
              <span className="font-medium">Baseline Case</span>
              <span className="text-secondary">{(projectData.meta?.scenario_name || 'Baseline_Depot_2026').replace(/_/g, ' ')}</span>
            </div>
            <div className="summary-item py-3 border-b border-border-light flex justify-between items-center text-sm">
              <span className="font-medium">Extensions</span>
              <div className="flex gap-2">
                <span className="badge badge-muted">PV Placeholder</span>
                <span className="badge badge-muted">BESS Placeholder</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showLearnMore && (
        <div className="modal-overlay" onClick={() => setShowLearnMore(false)}>
          <div className="modal-content animate-pop" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-area">
                <div className="icon-badge">
                  <Zap size={20} className="text-primary" />
                </div>
                <h2>About eDOPT</h2>
              </div>
              <button className="btn-close" onClick={() => setShowLearnMore(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p className="intro-text">
                eDOPT (electric Depot Optimization and Planning Tool) is an intelligent scheduling system 
                designed to manage electric vehicle charging sessions at bus depots. 
                It minimizes electricity procurement costs by aligning charging schedules with dynamic spot prices 
                while respecting battery health, charger capacities, and grid limits.
              </p>
              
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-icon">📈</span>
                  <div className="info-text">
                    <h3>Dynamic Pricing</h3>
                    <p>Integrates dynamic electricity market spot prices (e.g. aWATTar) and shifts vehicle charging to cheaper hours.</p>
                  </div>
                </div>

                <div className="info-item">
                  <span className="info-icon">⚡</span>
                  <div className="info-text">
                    <h3>Peak Shaving</h3>
                    <p>Enforces grid limits to avoid expensive demand spikes (Netznutzungsgebühren) by dynamically balancing power.</p>
                  </div>
                </div>

                <div className="info-item">
                  <span className="info-icon">🚌</span>
                  <div className="info-text">
                    <h3>Operational Guarantee</h3>
                    <p>Ensures every bus is fully charged to its target state before its scheduled departure, keeping operations smooth.</p>
                  </div>
                </div>

                <div className="info-item">
                  <span className="info-icon">⚙️</span>
                  <div className="info-text">
                    <h3>MILP Optimization</h3>
                    <p>Uses mathematical Mixed-Integer Linear Programming to compute the mathematically optimal charging plan.</p>
                  </div>
                </div>
              </div>

              <div className="interactive-teaser">
                <h4>Workflow at a glance</h4>
                <ol>
                  <li><strong>Upload Data:</strong> Input your bus timetable (Umlaufplan) and select pricing models in the <em>Inputs</em> section.</li>
                  <li><strong>Run Solver:</strong> Click <em>Run Optimization</em> to let the algorithm compute the optimal schedule.</li>
                  <li><strong>Analyze:</strong> Review charging graphs, peak shaving results, and export data in <em>Results</em>.</li>
                </ol>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowLearnMore(false)}>Close</button>
              <button className="btn btn-primary" onClick={() => { setShowLearnMore(false); onStartOptimization(); }}>
                <Zap size={16} /> Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .hero-card {
          background: linear-gradient(135deg, var(--bg-surface) 0%, var(--primary-soft) 100%);
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2.5rem;
          border: 1px solid var(--primary-soft);
        }

        .workflow-steps {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .workflow-step {
          display: flex;
          align-items: center;
          gap: 1rem;
          position: relative;
        }

        .step-arrow {
          position: absolute;
          right: 0;
        }

        .hero-actions {
          display: flex;
          gap: 0.75rem;
        }

        .summary-item:last-child {
          border-bottom: none;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(8px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
          animation: fadeIn 0.2s ease-out;
        }

        .modal-content {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          width: 90%;
          max-width: 650px;
          max-height: 85vh;
          box-shadow: var(--shadow-lg);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--border-light);
        }

        .modal-title-area {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .modal-title-area h2 {
          font-size: 1.25rem;
          margin: 0;
          color: var(--text-primary);
        }

        .icon-badge {
          background: var(--primary-soft);
          width: 36px;
          height: 36px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-close {
          font-size: 1.5rem;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0.25rem;
          line-height: 1;
        }

        .btn-close:hover {
          color: var(--text-primary);
        }

        .modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .intro-text {
          color: var(--text-secondary);
          font-size: 0.95rem;
          line-height: 1.6;
        }

        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .info-item {
          display: flex;
          gap: 0.75rem;
          padding: 1rem;
          background: var(--border-light);
          border-radius: 10px;
          border: 1px solid var(--border);
        }

        .info-icon {
          font-size: 1.5rem;
          line-height: 1;
          display: flex;
          align-items: flex-start;
        }

        .info-text h3 {
          font-size: 0.9rem;
          margin-bottom: 0.25rem;
          color: var(--text-primary);
          font-weight: 600;
        }

        .info-text p {
          font-size: 0.8rem;
          color: var(--text-secondary);
          line-height: 1.4;
          margin: 0;
        }

        .interactive-teaser {
          background: linear-gradient(135deg, var(--primary-soft) 0%, rgba(229, 237, 255, 0.4) 100%);
          padding: 1.25rem;
          border-radius: 10px;
          border: 1px solid var(--primary-soft);
        }

        .interactive-teaser h4 {
          font-size: 0.9rem;
          margin-bottom: 0.5rem;
          color: var(--primary);
          font-weight: 600;
        }

        .interactive-teaser ol {
          padding-left: 1.25rem;
          font-size: 0.8rem;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-top: 1px solid var(--border-light);
          background: var(--border-light);
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes popIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .animate-pop {
          animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}} />
    </div>
  );
};

export default Dashboard;
