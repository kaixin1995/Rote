import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import type { AdminHookChannel } from '../types';
import { BARK_SOUND_DEFAULT_VALUE } from './hookChannelConfig';
import { getBarkSoundOptions } from './hookChannelDialogUtils';

interface HookChannelBarkFieldsProps {
  channel: Extract<AdminHookChannel, { type: 'bark' }>;
  onChange: (channel: AdminHookChannel) => void;
}

export default function HookChannelBarkFields({ channel, onChange }: HookChannelBarkFieldsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.admin' });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`hook-bark-server-${channel.id}`}>{t('hooks.bark.serverUrl')}</Label>
        <Input
          id={`hook-bark-server-${channel.id}`}
          value={channel.serverUrl || ''}
          placeholder="https://api.day.app"
          onChange={(event) => onChange({ ...channel, serverUrl: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`hook-bark-key-${channel.id}`}>{t('hooks.bark.key')}</Label>
        <Input
          id={`hook-bark-key-${channel.id}`}
          type="password"
          value={channel.key}
          required
          onChange={(event) => onChange({ ...channel, key: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`hook-bark-group-${channel.id}`}>{t('hooks.bark.group')}</Label>
        <Input
          id={`hook-bark-group-${channel.id}`}
          value={channel.group || ''}
          onChange={(event) => onChange({ ...channel, group: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`hook-bark-icon-${channel.id}`}>{t('hooks.bark.icon')}</Label>
        <Input
          id={`hook-bark-icon-${channel.id}`}
          value={channel.icon || ''}
          onChange={(event) => onChange({ ...channel, icon: event.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`hook-bark-sound-${channel.id}`}>{t('hooks.bark.sound')}</Label>
        <Select
          value={channel.sound || BARK_SOUND_DEFAULT_VALUE}
          onValueChange={(value) =>
            onChange({
              ...channel,
              sound: value === BARK_SOUND_DEFAULT_VALUE ? undefined : value,
            })
          }
        >
          <SelectTrigger id={`hook-bark-sound-${channel.id}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={BARK_SOUND_DEFAULT_VALUE}>{t('hooks.bark.soundDefault')}</SelectItem>
            {getBarkSoundOptions(channel.sound).map((sound) => (
              <SelectItem key={sound.value} value={sound.value}>
                {'customLabel' in sound
                  ? sound.customLabel
                  : t(`hooks.bark.sounds.${sound.translationKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
