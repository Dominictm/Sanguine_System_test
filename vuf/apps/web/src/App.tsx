import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { CharactersList } from './pages/CharactersList';
import { LocationsList } from './pages/LocationsList';
import { ScenariosList } from './pages/ScenariosList';
import { Dashboard } from './pages/Dashboard';

const navItems = [
  { to: '/', label: 'Панель', end: true },
  { to: '/characters', label: 'Персонажи' },
  { to: '/locations', label: 'Локации' },
  { to: '/scenarios', label: 'Сценарии' },
];

export function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Vuf</div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/characters" element={<CharactersList />} />
          <Route path="/locations" element={<LocationsList />} />
          <Route path="/scenarios" element={<ScenariosList />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
