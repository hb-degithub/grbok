import { useEffect, useState } from 'react';
import {
  DEFAULT_SITE_SETTINGS,
  loadSiteSettings,
  type SiteSettings,
} from '../lib/site-settings';

export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    loadSiteSettings()
      .then((loaded) => {
        if (mounted) setSettings(loaded);
      })
      .catch((err) => {
        if (mounted) setError(err as Error);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { settings, loading, error };
}
