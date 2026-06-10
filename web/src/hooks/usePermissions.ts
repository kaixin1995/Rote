import { useAuthState } from '@/state/profile';
import type { EffectivePermissionsResponse } from '@/types/permissions';
import { get } from '@/utils/api';
import useSWR from 'swr';

export function usePermissions() {
  const { profile } = useAuthState();
  const result = useSWR<EffectivePermissionsResponse>(
    profile?.id ? (['/permissions/me', profile.id] as const) : null,
    async ([url]: readonly [string, string]) => {
      const response = await get(url);
      return response.data as EffectivePermissionsResponse;
    }
  );

  return {
    ...result,
    capabilities: result.data?.capabilities,
  };
}
