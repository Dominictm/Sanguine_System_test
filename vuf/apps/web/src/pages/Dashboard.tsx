import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

export function Dashboard() {
  const chars = useApi(() => api.listCharacters(1, 5), []);
  const locs = useApi(() => api.listLocations(1, 5), []);
  const scens = useApi(() => api.listScenarios(1, 5), []);

  return (
    <section>
      <h1 className="page-title">Панель</h1>
      <div className="cards">
        <div className="card">
          <span className="card-label">Персонажи</span>
          <span className="card-value">{chars.data?.meta.total ?? '—'}</span>
        </div>
        <div className="card">
          <span className="card-label">Локации</span>
          <span className="card-value">{locs.data?.meta.total ?? '—'}</span>
        </div>
        <div className="card">
          <span className="card-label">Сценарии</span>
          <span className="card-value">{scens.data?.meta.total ?? '—'}</span>
        </div>
      </div>
    </section>
  );
}
