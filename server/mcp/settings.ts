import { getMySettings, updateMySettings } from '../utils/dbMethods';
import { defineMcpTool } from './registry';
import { requireAuth } from './shared';
import type { McpTool } from './types';

export const settingTools: McpTool[] = [
  defineMcpTool('settings_get', async (c) => await getMySettings(requireAuth(c).userId)),
  defineMcpTool(
    'settings_update',
    async (c, args) => await updateMySettings(requireAuth(c).userId, args)
  ),
];
