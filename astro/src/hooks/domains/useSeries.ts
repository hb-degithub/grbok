import { useState, useEffect } from 'react';
import { seriesService, type SeriesEntry } from '../../lib/services/seriesService';

export function useSeries(seriesId: string | undefined) {
  const [entries, setEntries] = useState<SeriesEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seriesId) {
      setLoading(false);
      setEntries([]);
      return;
    }

    setLoading(true);
    seriesService.getSeriesEntries(seriesId)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [seriesId]);

  return { entries, loading };
}
