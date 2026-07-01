import { editMyProfile, getMyProfile } from '../utils/dbMethods';
import { UsernameUpdateZod } from '../utils/zod';
import { defineMcpTool } from './registry';
import { requireAuth } from './shared';
import type { McpTool } from './types';

export const profileTools: McpTool[] = [
  defineMcpTool('profile_get', async (c) => await getMyProfile(requireAuth(c).userId)),
  defineMcpTool('profile_update', async (c, args) => {
    if (args.username !== undefined) UsernameUpdateZod.parse({ username: args.username });
    return await editMyProfile(requireAuth(c).userId, args);
  }),
];
