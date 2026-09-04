import { useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

export function ScenariosList() {
  const { data, error, loading, reload } = useApi(() => api.listScenarios(1, 25), []);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.createScenario({ title: title.trim() });
      setTitle('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    await api.deleteScenario(id);
    reload();
  };

  if (loading) return <p>Загрузка…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1 className="page-title">Сценарии</h1>

      <form className="inline-form" onSubmit={submit}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название сценария" />
        <button type="submit" disabled={saving || !title.trim()}>
          Создать
        </button>
      </form>
      {formError && <p className="error">{formError}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Фаза</th>
            <th>Статус</th>
            <th>Персонажи</th>
            <th>Локации</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.data.map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td>{s.phase}</td>
              <td>{s.status}</td>
              <td>{s._count?.characters ?? 0}</td>
              <td>{s._count?.locations ?? 0}</td>
              <td>
                <button className="danger" onClick={() => remove(s.id)}>
                  Удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
