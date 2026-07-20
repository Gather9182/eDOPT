import React from 'react';
import Sidebar from './Sidebar';
import ScenarioManager from './ScenarioManager';

const Layout = ({ 
  children, 
  activeTab, 
  setActiveTab,
  projectData,
  setProjectData,
  savedScenarios,
  onLoadScenario,
  onSaveScenario,
  onDeleteScenario,
  onImportScenario
}) => {
  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="main-content">
        <header className="content-header">
          <div className="breadcrumb">
            <span className="breadcrumb-root">eDOPT</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </span>
          </div>
          <ScenarioManager 
            projectData={projectData}
            setProjectData={setProjectData}
            savedScenarios={savedScenarios}
            onLoadScenario={onLoadScenario}
            onSaveScenario={onSaveScenario}
            onDeleteScenario={onDeleteScenario}
            onImportScenario={onImportScenario}
          />
        </header>
        <div className="page-content">
          {children}
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .content-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          height: var(--header-height);
        }

        .breadcrumb {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: var(--text-muted);
          font-weight: 500;
        }

        .breadcrumb-root {
          color: var(--text-muted);
        }

        .breadcrumb-separator {
          color: var(--border);
        }

        .breadcrumb-current {
          color: var(--text-primary);
          font-weight: 600;
        }

        .profile-initials {
          width: 36px;
          height: 36px;
          background: var(--border-light);
          border: 1px solid var(--border);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
        }

        .page-content {
          animation: fadeIn 0.3s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
};

export default Layout;
