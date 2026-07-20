import React, { useState, useRef, useEffect } from 'react';
import { 
  FolderOpen, 
  Save, 
  Download, 
  Upload, 
  Trash2, 
  Check, 
  AlertCircle,
  Plus,
  Loader2
} from 'lucide-react';

const ScenarioManager = ({
  projectData,
  savedScenarios,
  onLoadScenario,
  onSaveScenario,
  onDeleteScenario,
  onImportScenario
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
  const popoverRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeScenarioName = projectData.meta?.scenario_name || 'Baseline_Depot_2026';

  const handleSave = (e) => {
    e.preventDefault();
    const name = newScenarioName.trim();
    if (!name) return;
    onSaveScenario(name);
    setNewScenarioName('');
  };

  const handleExport = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projectData, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${activeScenarioName}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      document.body.removeChild(downloadAnchor);
    } catch (err) {
      console.error("Export scenario failed:", err);
      alert("Failed to export scenario settings.");
    }
  };

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        onImportScenario(parsed);
      } catch (err) {
        alert("Error parsing JSON file. Please ensure it is a valid eDOPT scenario file.");
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  return (
    <div className="scenario-manager-container" ref={popoverRef}>
      <button 
        className={`scenario-pill-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Manage project scenarios"
      >
        <FolderOpen size={14} className="scenario-icon" />
        <span className="scenario-pill-label">Scenario:</span>
        <span className="scenario-pill-value">{activeScenarioName.replace(/_/g, ' ')}</span>
      </button>

      {isOpen && (
        <div className="scenario-popover animate-in">
          <div className="scenario-popover-header">
            <span>Scenario Controls</span>
            <span className="text-xxs text-muted font-normal uppercase">eDOPT Config</span>
          </div>

          <div className="scenario-popover-section">
            <h4 className="scenario-section-title">Saved Scenarios</h4>
            <div className="saved-scenarios-list no-scrollbar">
              {savedScenarios.map((scen) => {
                const isActive = scen.name === activeScenarioName;
                const formattedDate = new Date(scen.timestamp).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
                
                return (
                  <div key={scen.name} className={`saved-scenario-item ${isActive ? 'active' : ''}`}>
                    <div 
                      className="saved-scenario-info"
                      onClick={() => {
                        onLoadScenario(scen.name);
                        setIsOpen(false);
                      }}
                    >
                      <span className="saved-scenario-name">
                        {scen.name.replace(/_/g, ' ')}
                      </span>
                      <span className="saved-scenario-meta">
                        {formattedDate} • {scen.data?.buses?.length || 0} buses
                      </span>
                    </div>
                    
                    <div className="saved-scenario-actions">
                      {isActive ? (
                        <span className="badge badge-success text-[8px] font-bold py-0.5 px-1.5 uppercase">Active</span>
                      ) : (
                        scen.name !== 'Baseline_Depot_2026' && (
                          <button 
                            className="delete-scenario-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteScenario(scen.name);
                            }}
                            title="Delete scenario"
                          >
                            <Trash2 size={12} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="scenario-popover-section border-t border-border-light pt-3">
            <h4 className="scenario-section-title">Save Current Settings</h4>
            <form onSubmit={handleSave} className="save-scenario-form">
              <input
                type="text"
                placeholder="New scenario name..."
                className="form-input text-xs py-1.5 px-3"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
              />
              <button 
                type="submit" 
                className="btn btn-primary btn-sm py-1.5"
                disabled={!newScenarioName.trim()}
              >
                <Save size={12} />
                Save
              </button>
            </form>
          </div>

          <div className="scenario-popover-section border-t border-border-light pt-3 flex gap-2">
            <button 
              className="btn btn-outline btn-sm py-2 flex-1 justify-center text-xs" 
              onClick={handleExport}
              title="Export active scenario to local file"
            >
              <Download size={12} />
              Export JSON
            </button>

            <button 
              className="btn btn-outline btn-sm py-2 flex-1 justify-center text-xs" 
              onClick={handleImportClick}
              disabled={isImporting}
              title="Import scenario from local file"
            >
              {isImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Import JSON
            </button>
            
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept=".json" 
              onChange={handleFileChange} 
            />
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .scenario-manager-container {
          position: relative;
          display: inline-block;
        }

        .scenario-pill-btn {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 99px;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--text-secondary);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: var(--shadow-sm);
        }

        .scenario-pill-btn:hover,
        .scenario-pill-btn.active {
          border-color: var(--primary);
          background: var(--primary-soft);
          color: var(--primary);
        }

        .scenario-icon {
          opacity: 0.7;
        }

        .scenario-pill-btn:hover .scenario-icon,
        .scenario-pill-btn.active .scenario-icon {
          opacity: 1;
        }

        .scenario-pill-label {
          color: var(--text-muted);
          font-weight: 400;
        }

        .scenario-pill-btn:hover .scenario-pill-label,
        .scenario-pill-btn.active .scenario-pill-label {
          color: var(--primary);
          opacity: 0.8;
        }

        .scenario-pill-value {
          font-weight: 700;
        }

        .scenario-popover {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 0.5rem;
          width: 320px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: var(--shadow-lg);
          padding: 1rem;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          animation: slideDownIn 0.2s ease-out;
        }

        @keyframes slideDownIn {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .scenario-popover-header {
          font-weight: 700;
          font-size: 0.7rem;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.05em;
          padding-bottom: 0.375rem;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .scenario-popover-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .scenario-section-title {
          font-size: 0.65rem;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }

        .saved-scenarios-list {
          max-height: 150px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .saved-scenario-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.4rem 0.6rem;
          border: 1px solid var(--border-light);
          border-radius: 8px;
          background: var(--bg-app);
          transition: all 0.2s;
        }

        .saved-scenario-item:hover {
          border-color: var(--border);
          background: white;
        }

        .saved-scenario-item.active {
          border-color: var(--primary-soft);
          background: var(--primary-soft) / 20;
        }

        .saved-scenario-info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          cursor: pointer;
          flex: 1;
          min-width: 0; /* allows text truncation */
        }

        .saved-scenario-name {
          font-weight: 600;
          font-size: 0.75rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .saved-scenario-item.active .saved-scenario-name {
          color: var(--primary);
        }

        .saved-scenario-meta {
          font-size: 0.6rem;
          color: var(--text-muted);
        }

        .saved-scenario-actions {
          margin-left: 0.5rem;
          display: flex;
          align-items: center;
        }

        .delete-scenario-btn {
          color: var(--text-muted);
          padding: 0.25rem;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .delete-scenario-btn:hover {
          color: var(--error);
          background: var(--badge-error-bg);
        }

        .save-scenario-form {
          display: flex;
          gap: 0.375rem;
        }

        .save-scenario-form input {
          flex: 1;
          height: 30px;
        }

        .save-scenario-form button {
          height: 30px;
          flex-shrink: 0;
        }
      `}} />
    </div>
  );
};

export default ScenarioManager;
