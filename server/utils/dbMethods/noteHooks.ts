import { notifyPublicNoteCreated } from '../adminHooks';
import { trackBackgroundTask } from '../backgroundTask';
import { createRote as createBaseRote, findRoteById } from './note';

export async function createRote(data: any): Promise<any> {
  const rote = await createBaseRote(data);
  if (rote?.state === 'public') {
    const note = (await findRoteById(rote.id)) || rote;
    trackBackgroundTask(notifyPublicNoteCreated(note), 'admin_hook_public_note_failed');
  }
  return rote;
}
