import { useState } from 'react';
import type { LocationType } from '@vuf/shared';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

const TYPES: LocationType[] = [
  'HAVEN', 'CLUB', 'ELYSIUM', 'STREET', 'OFFICE', 'RESIDENCE',
  'GOVERNMENT', 'UNDERGROUND', 'OTHER',
];

export function LocationsList() {
  const { data, error, loading, reload } = useApi(() => api.listLocations(1, 25), []);
  const [name, setName] = useState('');
  const [type, setType] = useState<LocationType>('OTHER');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.createLocation({ name: name.trim(), type, city: city.trim() || undefined });
      setName('');
      setType('OTHER');
      setCity('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    await api.deleteLocation(id);
    reload();
  };

  if (loading) return <p>Загрузка…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1 className="page-title">Локации</h1>

      <form className="inline-form" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Город" />
        <select value={type} onChange={(e) => setType(e.target.value as LocationType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace('_', ' ')}
            </option>
          ))}
        </select>
        <button type="submit" disabled={saving || !name.trim()}>
          Создать
        </button>
      </form>
      {formError && <p className="error">{formError}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Тип</th>
            <th>Город</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.data.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td>
              <td>{l.type}</td>
              <td>{l.city ?? '—'}</td>
              <td>
                <button className="danger" onClick={() => remove(l.id)}>
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
