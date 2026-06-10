import { usePermissions } from '@/hooks/usePermissions';
import { useSiteStatus } from '@/hooks/useSiteStatus';
import { useOpenKeys } from '@/state/openKeys';
import type { OpenKey } from '@/types/main';
import { put } from '@/utils/api';
import { Save } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { KeyedMutator } from 'swr';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';

interface OpenKeyEditModelProps {
  openKey: OpenKey;
  close: () => void;
  mutate?: KeyedMutator<OpenKey[]>;
}

function OpenKeyEditModel({ openKey, close, mutate }: OpenKeyEditModelProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'components.openKeyEditModel',
  });
  const { data: siteStatus } = useSiteStatus();
  const { capabilities } = usePermissions();
  const [openKeys, setOpenKeys] = useOpenKeys();
  const defaultCheckedList: string[] = openKey.permissions;
  const checkboxRef = useRef<HTMLButtonElement>(null);

  const processedOptions = useMemo(() => {
    // 完全依赖后端返回的 permissionKeys，未配置时返回空列表
    const permissionKeys = siteStatus?.frontendConfig.permissionKeys ?? [];
    return permissionKeys.map((key) => {
      const attachmentAllowed = capabilities?.['attachment.upload']?.allowed === true;
      const videoAllowed = capabilities?.['attachment.video.upload']?.allowed === true;
      const disabled =
        (key === 'UPLOADATTACHMENT' && !attachmentAllowed) ||
        (key === 'UPLOADVIDEO' && (!attachmentAllowed || !videoAllowed));

      return {
        value: key,
        checked: false,
        disabled,
        // i18n key 统一为 components.openKeyEditModel.permissions.${key}
        label: t(`permissions.${key}`),
      };
    }) as Array<{
      value: string;
      checked: boolean;
      disabled: boolean;
      label: string;
    }>;
  }, [capabilities, t, siteStatus?.frontendConfig?.permissionKeys]);

  const [checkedList, setCheckedList] = useState<string[]>(defaultCheckedList);

  const enabledOptionValues = useMemo(
    () => processedOptions.filter((option) => !option.disabled).map((option) => option.value),
    [processedOptions]
  );
  const checkAll =
    enabledOptionValues.length > 0 &&
    enabledOptionValues.every((value) => checkedList.includes(value));

  const onChange = (value: string, disabled: boolean) => {
    if (disabled) return;
    setCheckedList((prev: string[]) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  // 修正 onCheckAllChange 以适配 shadcn Checkbox 的 onCheckedChange 签名
  const onCheckAllChange = (checked: boolean) => {
    setCheckedList(checked ? enabledOptionValues : []);
  };

  function save() {
    const availableCheckedList = checkedList.filter((value) => enabledOptionValues.includes(value));
    if (availableCheckedList.length === 0) {
      toast.error(t('minimumPermission'));
      return;
    }
    close();
    const toastId = toast.loading(t('saving'));
    put('/api-keys/' + openKey.id, { permissions: availableCheckedList })
      .then((res) => {
        toast.success(t('saveSuccess'), {
          id: toastId,
        });
        // 更新 Jotai 状态（用于兼容旧代码）
        setOpenKeys(openKeys.map((key) => (key.id === res.data.data.id ? res.data.data : key)));
        // 刷新 SWR 数据（用于 profile 页面）
        if (mutate) {
          mutate();
        }
      })
      .catch(() => {
        toast.error(t('saveFailed'), {
          id: toastId,
        });
      });
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 p-4">
        {processedOptions.map((option) => {
          const checkboxId = `checkbox-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={checkboxId}
              className="bg-muted/60 flex w-fit cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all duration-200 select-none"
            >
              <Checkbox
                id={checkboxId}
                checked={checkedList.includes(option.value)}
                disabled={option.disabled}
                onCheckedChange={() => onChange(option.value, option.disabled)}
                className="accent-primary scale-110"
              />
              <span className="text-foreground text-sm">
                {option.label}
                {option.disabled && (
                  <span className="text-muted-foreground ml-1">{t('permissionUnavailable')}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-4 p-4">
        <Checkbox
          ref={checkboxRef}
          onCheckedChange={onCheckAllChange}
          checked={checkAll}
          disabled={enabledOptionValues.length === 0}
          className="accent-primary ml-auto"
        />
        <span className="text-muted-foreground text-sm select-none">{t('selectAll')}</span>
        <Button variant="default" onClick={save} type="button">
          <Save className="size-4" />
          {t('save')}
        </Button>
      </div>
    </>
  );
}

export default OpenKeyEditModel;
