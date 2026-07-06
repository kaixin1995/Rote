import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from 'react-i18next';
import type { AdminHookChannel } from '../types';
import { headersToText, parseHeaders } from './hookChannelDialogUtils';

interface HookChannelHttpFieldsProps {
  channel: Extract<AdminHookChannel, { type: 'http' }>;
  onChange: (channel: AdminHookChannel) => void;
}

export default function HookChannelHttpFields({ channel, onChange }: HookChannelHttpFieldsProps) {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.admin' });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor={`hook-http-url-${channel.id}`}>{t('hooks.http.url')}</Label>
        <Input
          id={`hook-http-url-${channel.id}`}
          value={channel.url}
          placeholder="https://example.com/webhook"
          required
          onChange={(event) => onChange({ ...channel, url: event.target.value })}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor={`hook-http-headers-${channel.id}`}>{t('hooks.http.headers')}</Label>
        <Textarea
          id={`hook-http-headers-${channel.id}`}
          value={headersToText(channel.headers)}
          onChange={(event) => onChange({ ...channel, headers: parseHeaders(event.target.value) })}
          rows={3}
        />
        <p className="text-muted-foreground text-xs">{t('hooks.http.headersDesc')}</p>
      </div>
    </div>
  );
}
