import React from 'react';
import logoImg from '../assets/logo.png';
import { 
  LayoutDashboard, 
  Database, 
  Settings, 
  Zap, 
  BarChart3, 
  Download,
  Bus,
  Sun,
  Battery,
  GitCompare
} from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'inputs', label: 'Input Data', icon: <Database size={20} /> },
    { id: 'run', label: 'Optimization', icon: <Zap size={20} /> },
    { id: 'results', label: 'Results', icon: <BarChart3 size={20} /> },
    { id: 'compare', label: 'Compare', icon: <GitCompare size={20} /> },
    { id: 'export', label: 'Export', icon: <Download size={20} /> },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo-container">
          <img src={logoImg} className="logo-image" alt="eDOPT Logo" />
          <span className="logo-text-dopt">DOPT</span>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="extension-badge">
          <Sun size={14} />
          <span>PV Ready</span>
        </div>
        <div className="extension-badge">
          <Battery size={14} />
          <span>BESS Ready</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .sidebar {
          width: var(--sidebar-width);
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          height: 100vh;
          position: sticky;
          top: 0;
        }

        .sidebar-header {
          padding: 2rem 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }

        .logo-container {
          display: flex;
          align-items: center;
          gap: 0;
        }

        .logo-image {
          width: 38px;
          height: 38px;
          object-fit: contain;
          flex-shrink: 0;
          transform: translateY(3px);
        }

        .logo-text-dopt {
          font-family: var(--font-sans);
          font-size: 2.2rem;
          font-weight: 800;
          color: #475569;
          line-height: 1;
          letter-spacing: -0.02em;
        }

        .sidebar-nav {
          flex: 1;
          padding: 0 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: 10px;
          color: var(--text-secondary);
          transition: all 0.2s;
          font-weight: 500;
          width: 100%;
          text-align: left;
        }

        .nav-item:hover {
          background: var(--bg-app);
          color: var(--text-primary);
        }

        .nav-item.active {
          background: var(--primary-soft);
          color: var(--primary);
        }

        .nav-icon {
          display: flex;
          align-items: center;
        }

        .sidebar-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .extension-badge {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.75rem;
          background: var(--bg-app);
          border-radius: 6px;
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 600;
          border: 1px solid var(--border-light);
        }
      `}} />
    </div>
  );
};

export default Sidebar;
