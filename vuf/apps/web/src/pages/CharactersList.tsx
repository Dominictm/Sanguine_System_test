import { useState } from 'react';
import type { Clan } from '@vuf/shared';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

const CLANS: Clan[] = [
  'BRUJAH', 'GANGREL', 'MALKAVIAN', 'NOSFERATU', 'TOREADOR', 'TREMERE',
  'TZIMISCE', 'VENTRUE', 'CAPPADOCIAN', 'ASSAMITE', 'TRUE_BRUJAH', 'CAITIFF',
  'OTHER', 'NONE',
];

export function CharactersList() {
  const { data, error, loading, reload } = useApi(() => api.listCharacters(1, 25), []);
  const [name, setName] = useState('');
  const [clan, setClan] = useState<Clan>('NONE');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.createCharacter({ name: name.trim(), clan });
      setName('');
      setClan('NONE');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    await api.deleteCharacter(id);
    reload();
  };

  if (loading) return <p>Загрузка…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h1 className="page-title">Персонажи</h1>

      <form className="inline-form" onSubmit={submit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя персонажа"
        />
        <select value={clan} onChange={(e) => setClan(e.target.value as Clan)}>
          {CLANS.map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
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
            <th>Имя</th>
            <th>Клан</th>
            <th>Поколение</th>
            <th>Статус</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.data.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.clan}</td>
              <td>{c.generation ?? '—'}</td>
              <td>{c.status}</td>
              <td>
                <button className="danger" onClick={() => remove(c.id)}>
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
